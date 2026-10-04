const $ = selector => document.querySelector(selector);
const format = units => (units / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
let state, busy = false;
function notice(message, error = false) { $("#notice").textContent = message; $("#notice").classList.toggle("is-error", error); }
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.reason || "Request failed. Refresh and try again.");
  return result;
}
function text(tag, content, className) {
  const element = document.createElement(tag); element.textContent = content;
  if (className) element.className = className;
  return element;
}
function record(parent, title, detail, action) {
  const row = document.createElement("div"); row.className = "account-record";
  const copy = document.createElement("div"); copy.append(text("strong", title), text("p", detail)); row.append(copy);
  if (action) { const button = text("button", action.label, "button ghost"); button.type = "button"; button.addEventListener("click", () => run(action.run)); row.append(button); }
  parent.append(row);
}
function render() {
  $("#identity").textContent = `@${state.account.username} · VERIFIED X ACCOUNT`;
  $("#balance").replaceChildren(document.createTextNode(format(state.availableUnits) + " "), text("small", "test USDC"));
  $("#accountStatus").textContent = `${state.account.paused ? "Tipping paused" : "Tipping active"} · ${format(state.account.spentUnits)} USDC tipped today`;
  $("#devnetBalance").textContent = `${format(state.devnetAvailableUnits || 0)} devnet USDC · separate test-network balance`;
  $("#fund").hidden = state.account.funded;
  $("#perTip").value = String(state.account.policy.perTipUnits / 1_000_000);
  $("#perDay").value = String(state.account.policy.perDayUnits / 1_000_000);
  $("#paused").checked = state.account.paused;
  $("#wallet").value = state.account.verifiedWallet || "";
  $("#walletStatus").textContent = state.account.verifiedWallet ? "Wallet ownership verified. Withdrawals remain simulated." : "Sign an ownership message. No transaction or spending approval.";
  const tips = $("#tips"); tips.replaceChildren();
  for (const tip of state.tips.slice().reverse()) {
    const incoming = tip.recipientId === state.account.id;
    record(tips, `${format(tip.amountUnits)} test USDC ${incoming ? "from @" + tip.senderHandle : "to @" + tip.recipientHandle}`,
      `${tip.status} · fee ${format(tip.feeUnits)} · ${new Date(tip.createdAt).toLocaleDateString()}`,
      incoming && tip.status === "pending" ? { label: "Claim to balance", run: () => mutate(`/api/account/tips/${tip.id}/claim`, {}, "Tip credited to your test balance.") } : null);
  }
  if (!state.tips.length) tips.append(text("p", "No tips yet. Create a command or ask another signed-in tester to tip you.", "account-help"));
  const withdrawals = $("#withdrawals"); withdrawals.replaceChildren();
  for (const item of state.withdrawals.slice().reverse()) {
    record(withdrawals, `${format(item.amountUnits)} test USDC · ${item.status.replaceAll("_", " ")}`,
      `${item.wallet.slice(0, 6)}…${item.wallet.slice(-6)} · no transaction sent`, item.status === "sandbox_reserved" ? {
        label: "Cancel", run: () => mutate(`/api/account/withdrawals/${item.id}/cancel`, {}, "Reservation cancelled. Balance restored.") } : null);
  }
  const journal = $("#journal"); journal.replaceChildren();
  for (const item of state.journal.slice(-10).reverse()) {
    const movement = item.entries.find(entry => entry.account === `user:${state.account.id}`);
    record(journal, `${movement.units > 0 ? "+" : "−"}${format(Math.abs(movement.units))} test USDC`, `${item.reason.replaceAll("_", " ")} · ${new Date(item.at).toLocaleString()}`);
  }
  if (!state.journal.length) journal.append(text("p", "No balance movements yet.", "account-help"));
  $("#devnetDepositPanel").hidden = !state.devnetDepositEnabled;
  const deposits = $("#devnetDeposits"); deposits.replaceChildren();
  for (const item of (state.devnetDeposits || []).slice().reverse()) {
    record(deposits, `+${format(item.amountUnits)} devnet USDC`, `${item.status.replaceAll("_", " ")} · signature ${item.signature.slice(0, 8)}…${item.signature.slice(-8)}`);
  }
}
async function mutate(path, body, message) {
  const result = await api(path, body); state = result.state; render(); notice(message);
}
async function run(action) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll("#workspace button, #logout")];
  buttons.forEach(button => { button.disabled = true; });
  notice("Working…");
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { busy = false; document.querySelectorAll("#workspace button, #logout").forEach(button => { button.disabled = false; }); }
}
// Preserve intent keys through network errors and reloads, preventing repeat debits.
function intent(kind, payload) {
  const key = `tagtip-intent:${state.account.id}:${kind}:${JSON.stringify(payload)}`;
  let id = sessionStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
  return { id, complete: () => sessionStorage.removeItem(key) };
}
$("#fund").addEventListener("click", () => run(() => mutate("/api/account/fund", {}, "25 test USDC added. No wallet charged.")));
$("#verifyWallet").addEventListener("click", () => run(async () => {
  const provider = window.phantom?.solana || window.solana;
  if (!provider?.isPhantom) throw new Error("Open this page in a browser with Phantom installed. Never enter your seed phrase here.");
  const connected = await provider.connect();
  const wallet = connected.publicKey.toString();
  const result = await api("/api/account/wallet/challenge", { wallet });
  notice("Check the ownership message in Phantom, then approve it yourself. No transaction will be sent.");
  const signed = await provider.signMessage(new TextEncoder().encode(result.challenge.message), "utf8");
  const signature = btoa(Array.from(signed.signature, byte => String.fromCharCode(byte)).join(""));
  await mutate("/api/account/wallet/verify", { signature }, "Wallet verified. No spending access granted.");
}));
$("#refresh").addEventListener("click", () => run(async () => { state = (await api("/api/account")).state; render(); notice("Account refreshed."); }));
$("#policyForm").addEventListener("submit", event => { event.preventDefault(); run(() => mutate("/api/account/policy", {
  perTip: $("#perTip").value.trim(), perDay: $("#perDay").value.trim(), paused: $("#paused").checked }, "Spending controls saved.")); });
$("#tipForm").addEventListener("submit", event => { event.preventDefault(); run(async () => {
  const payload = { command: $("#command").value.trim() }; const key = intent("tip", payload);
  await mutate("/api/account/tips", { ...payload, requestId: key.id }, "Test tip pending. The recipient can claim it from their account."); key.complete();
}); });
$("#withdrawForm").addEventListener("submit", event => { event.preventDefault(); run(async () => {
  const payload = { amount: $("#withdrawAmount").value.trim(), wallet: $("#wallet").value.trim() }; const key = intent("withdrawal", payload);
  await mutate("/api/account/withdrawals", { ...payload, requestId: key.id }, "Test withdrawal reserved. No blockchain transaction was sent."); key.complete();
}); });
$("#devnetDepositForm").addEventListener("submit", event => { event.preventDefault(); run(async () => {
  const signature = $("#depositSignature").value.trim();
  await mutate("/api/account/devnet/deposits", { signature }, "Finalized devnet deposit credited to your separate devnet balance.");
  $("#depositSignature").value = "";
}); });
$("#logout").addEventListener("click", () => run(async () => { await api("/api/auth/logout", {}); location.replace("account.html"); }));
try {
  const session = await api("/api/auth/me");
  if (session.account) {
    state = (await api("/api/account")).state; $("#workspace").hidden = false; $("#logout").hidden = false; render();
    notice("Signed in. All balances and withdrawals on this page are simulated.");
  } else {
    $("#loginPanel").hidden = false; $("#loginLink").hidden = !session.configured; $("#loginUnavailable").hidden = session.configured;
    notice(session.configured ? "Sign in to open your personal sandbox." : "Waiting for TagTip’s X app configuration.");
  }
} catch (error) { notice(`Could not load your account: ${error.message}`, true); }

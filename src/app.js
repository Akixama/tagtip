import { money } from "./core.js";

let state;
const $ = (selector) => document.querySelector(selector);
const elements = {
  setupButton: $("#setupButton"), setupAction: $("#setupAction"), setupTitle: $(".setup-title"), setupDescription: $(".setup-description"),
  commandPanel: $("#commandPanel"), lockedCompose: $("#lockedCompose"), commandInput: $("#commandInput"), runButton: $("#runButton"),
  receipt: $("#receipt"), receiptIcon: $("#receiptIcon"), receiptLabel: $("#receiptLabel"), receiptTitle: $("#receiptTitle"),
  receiptReason: $("#receiptReason"), receiptDetails: $("#receiptDetails"), tipAmount: $("#tipAmount"), feeAmount: $("#feeAmount"),
  budgetLeft: $("#budgetLeft"), identityState: $("#identityState"), budgetState: $("#budgetState"), commandState: $("#commandState"),
  stepIdentity: $("#stepIdentity"), stepBudget: $("#stepBudget"), stepCommand: $("#stepCommand"), budgetReadout: $("#budgetReadout"),
  spentReadout: $("#spentReadout"), botStatus: $("#botStatus"), pauseButton: $("#pauseButton"), revokeButton: $("#revokeButton"),
  resetButton: $("#resetButton"), activityList: $("#activityList"), revokeDialog: $("#revokeDialog"), confirmRevoke: $("#confirmRevoke"),
  claimLink: $("#claimLink"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok && !payload.state) throw new Error(payload.reason || "Request failed.");
  return payload;
}

function setStep(element, mode) {
  element.classList.remove("active", "complete");
  if (mode) element.classList.add(mode);
}

function renderActivities() {
  if (!state.activities.length) {
    elements.activityList.innerHTML = '<li class="empty-activity">Complete setup and run your first test command.</li>';
    return;
  }
  elements.activityList.replaceChildren(...state.activities.map(item => {
    const row = document.createElement("li"), icon = document.createElement("span"), copy = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("small"), time = document.createElement("time");
    icon.className = `activity-icon ${item.ok ? "success" : "blocked"}`; icon.textContent = item.ok ? "✓" : "!";
    title.textContent = item.title; detail.textContent = item.detail; time.textContent = item.time;
    copy.append(title, detail); row.append(icon, copy, time); return row;
  }));
}

function render() {
  const sender = state.sender;
  elements.identityState.textContent = sender.identityLinked ? `${sender.handle} linked` : "Not linked";
  elements.budgetState.textContent = sender.budgetApproved ? `${money(sender.budget)} available` : "Not approved";
  elements.commandState.textContent = state.tips.length ? `${state.tips.length} created` : "Waiting";
  setStep(elements.stepIdentity, sender.identityLinked ? "complete" : "active");
  setStep(elements.stepBudget, sender.identityLinked ? (sender.budgetApproved ? "complete" : "active") : null);
  setStep(elements.stepCommand, sender.budgetApproved ? "active" : null);
  elements.budgetReadout.textContent = money(sender.budget);
  elements.spentReadout.textContent = money(sender.spentToday);
  elements.botStatus.textContent = !sender.budgetApproved ? "Not ready" : sender.active ? "Active" : "Paused";
  elements.botStatus.className = `status-badge ${sender.active ? "ready" : ""}`;
  elements.pauseButton.disabled = !sender.budgetApproved;
  elements.revokeButton.disabled = !sender.budgetApproved;
  elements.pauseButton.textContent = sender.active ? "Pause bot" : "Resume bot";
  elements.commandPanel.classList.toggle("is-hidden", !sender.budgetApproved);
  elements.lockedCompose.classList.toggle("is-hidden", sender.budgetApproved);

  if (sender.setupStage === "identity") {
    elements.setupAction.classList.remove("is-complete");
    elements.setupButton.disabled = false;
    elements.setupTitle.textContent = "Link your demo identity";
    elements.setupDescription.textContent = "Simulates connecting an X account. No API request is made.";
    elements.setupButton.textContent = `Link ${sender.handle}`;
  } else if (sender.setupStage === "budget") {
    elements.setupAction.classList.remove("is-complete");
    elements.setupButton.disabled = false;
    elements.setupTitle.textContent = "Fund a $25 test balance";
    elements.setupDescription.textContent = "Creates a server-side demo balance. No wallet is charged.";
    elements.setupButton.textContent = "Fund test balance";
  } else {
    elements.setupAction.classList.add("is-complete");
    elements.setupTitle.textContent = "TipBot is ready";
    elements.setupDescription.textContent = "Tips created here now appear on the recipient claim page.";
    elements.setupButton.textContent = "Ready";
    elements.setupButton.disabled = true;
  }
  renderActivities();
}

function showReceipt({ ok, title, reason, amount = 0, fee = 0, id = "" }) {
  elements.receipt.classList.remove("is-hidden", "blocked");
  elements.receipt.classList.toggle("blocked", !ok);
  elements.receiptIcon.textContent = ok ? "✓" : "!";
  elements.receiptLabel.textContent = ok ? `PENDING CLAIM · ${id}` : "COMMAND BLOCKED";
  elements.receiptTitle.textContent = title;
  elements.receiptReason.textContent = reason;
  elements.receiptDetails.hidden = !ok;
  elements.tipAmount.textContent = money(amount);
  elements.feeAmount.textContent = money(fee);
  elements.budgetLeft.textContent = money(state.sender.budget);
  if (ok && id) elements.claimLink.href = `claim.html?tip=${encodeURIComponent(id)}`;
}

async function updateDemo(button, path, hideReceipt = false) {
  button.disabled = true;
  try { state = await api(path, { method: "POST" }); if (hideReceipt) elements.receipt.classList.add("is-hidden"); render(); }
  catch (error) { showReceipt({ ok: false, title: "Could not update the demo", reason: error.message }); }
  finally { button.disabled = false; if (state) render(); }
}
elements.setupButton.addEventListener("click", () => updateDemo(elements.setupButton, "/api/demo/setup"));
elements.runButton.addEventListener("click", async () => {
  elements.runButton.disabled = true;
  elements.runButton.textContent = "Checking…";
  try {
    const result = await api("/api/demo/tips", { method: "POST", body: { command: elements.commandInput.value } });
    state = result.state;
    if (!result.ok) showReceipt({ ok: false, title: result.recipient ? `${money(result.amount)} to ${result.recipient}` : "Command not recognized", reason: result.reason });
    else showReceipt({ ok: true, title: `${money(result.tip.amount)} reserved for ${result.tip.recipient}`, reason: "The tip is now waiting on the recipient claim page.", amount: result.tip.amount, fee: result.tip.fee, id: result.tip.id });
    render();
  } catch (error) {
    showReceipt({ ok: false, title: "Request could not be confirmed", reason: error.message + " Refresh before trying again." });
  } finally {
    elements.runButton.disabled = false;
    elements.runButton.textContent = "Reply";
  }
});
elements.pauseButton.addEventListener("click", () => updateDemo(elements.pauseButton, "/api/demo/pause"));
elements.revokeButton.addEventListener("click", () => elements.revokeDialog.showModal());
elements.confirmRevoke.addEventListener("click", () => updateDemo(elements.confirmRevoke, "/api/demo/revoke", true));
elements.resetButton.addEventListener("click", () => updateDemo(elements.resetButton, "/api/demo/reset", true));

try { state = await api("/api/demo"); render(); }
catch (error) {
  elements.setupButton.disabled = true;
  showReceipt({ ok: false, title: "Demo unavailable", reason: error.message + " Reload to try again." });
}

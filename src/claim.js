import { money } from "./core.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  sender: $("#claimSender"), recipient: $("#claimRecipient"), amount: $("#claimAmount"), reference: $("#claimReference"), state: $("#claimState"),
  verifyStep: $("#verifyStep"), walletStep: $("#walletStep"), claimStep: $("#claimStep"), verifyButton: $("#verifyButton"),
  walletButton: $("#walletButton"), claimButton: $("#claimButton"), result: $("#claimResult"), resultCopy: $("#claimResultCopy"),
  empty: $("#claimEmpty"), steps: $("#claimSteps"),
};
let tip;
const requestedTipId = new URLSearchParams(location.search).get("tip");

async function api(path, method = "GET") {
  const response = await fetch(path, { method });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.reason || "Request failed.");
  return payload;
}

function complete(step) { step.classList.remove("active"); step.classList.add("complete"); }

function renderTip(state) {
  tip = requestedTipId ? state.tips.find((item) => item.id === requestedTipId) : state.tips.find((item) => !["claimed", "expired"].includes(item.status)) || state.tips[0];
  const hasTip = Boolean(tip);
  elements.empty.classList.toggle("is-hidden", hasTip);
  elements.steps.classList.toggle("is-hidden", !hasTip);
  if (!hasTip) {
    elements.empty.querySelector("p").textContent = requestedTipId ? "This claim link could not be found." : "No pending tip yet.";
    elements.state.textContent = "Waiting";
    elements.amount.innerHTML = '$0.00 <small>USDC</small>';
    return;
  }
  elements.sender.textContent = tip.sender;
  elements.recipient.textContent = `Verify ${tip.recipient}`;
  elements.amount.innerHTML = `${money(tip.amount)} <small>USDC</small>`;
  elements.reference.textContent = tip.id;
  elements.state.textContent = tip.status === "claimed" ? "Claimed" : tip.status === "expired" ? "Expired" : "Ready";
  elements.verifyButton.disabled = tip.status !== "ready";
  elements.walletButton.disabled = tip.status !== "verified";
  elements.claimButton.disabled = tip.status !== "wallet_connected";
  elements.claimButton.textContent = `Claim ${money(tip.amount)}`;
  elements.result.classList.add("is-hidden");
  for (const step of [elements.verifyStep, elements.walletStep, elements.claimStep]) step.classList.remove("active", "complete");
  if (tip.status === "ready") elements.verifyStep.classList.add("active");
  if (["verified", "wallet_connected", "claimed"].includes(tip.status)) complete(elements.verifyStep);
  if (["wallet_connected", "claimed"].includes(tip.status)) complete(elements.walletStep);
  if (tip.status === "expired") {
    elements.steps.classList.add("is-hidden");
    elements.empty.classList.remove("is-hidden");
    elements.empty.querySelector("p").textContent = "This tip expired and was returned to the sender’s balance.";
  } else if (tip.status === "claimed") {
    complete(elements.claimStep);
    elements.result.classList.remove("is-hidden");
    elements.resultCopy.textContent = `${money(tip.amount)} USDC would be sent to ${tip.wallet}.`;
  } else if (tip.status === "wallet_connected") elements.claimStep.classList.add("active");
  else if (tip.status === "verified") elements.walletStep.classList.add("active");
}

elements.verifyButton.addEventListener("click", async () => renderTip(await api(`/api/demo/tips/${tip.id}/verify`, "POST")));
elements.walletButton.addEventListener("click", async () => renderTip(await api(`/api/demo/tips/${tip.id}/wallet`, "POST")));
elements.claimButton.addEventListener("click", async () => renderTip(await api(`/api/demo/tips/${tip.id}/claim`, "POST")));

renderTip(await api("/api/demo"));

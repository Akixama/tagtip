import { evaluateTip, money, parseTipCommand } from "./core.js";

const initialState = () => ({
  identityLinked: false,
  budgetApproved: false,
  budget: 0,
  spentToday: 0,
  active: false,
  setupStage: "identity",
  activities: [],
});

let state = initialState();

const $ = (selector) => document.querySelector(selector);
const elements = {
  setupButton: $("#setupButton"),
  setupAction: $("#setupAction"),
  setupTitle: $(".setup-title"),
  setupDescription: $(".setup-description"),
  commandPanel: $("#commandPanel"),
  commandInput: $("#commandInput"),
  runButton: $("#runButton"),
  receipt: $("#receipt"),
  receiptIcon: $("#receiptIcon"),
  receiptLabel: $("#receiptLabel"),
  receiptTitle: $("#receiptTitle"),
  receiptReason: $("#receiptReason"),
  receiptDetails: $("#receiptDetails"),
  tipAmount: $("#tipAmount"),
  feeAmount: $("#feeAmount"),
  budgetLeft: $("#budgetLeft"),
  identityState: $("#identityState"),
  budgetState: $("#budgetState"),
  commandState: $("#commandState"),
  stepIdentity: $("#stepIdentity"),
  stepBudget: $("#stepBudget"),
  stepCommand: $("#stepCommand"),
  budgetReadout: $("#budgetReadout"),
  spentReadout: $("#spentReadout"),
  botStatus: $("#botStatus"),
  pauseButton: $("#pauseButton"),
  revokeButton: $("#revokeButton"),
  resetButton: $("#resetButton"),
  activityList: $("#activityList"),
  revokeDialog: $("#revokeDialog"),
  confirmRevoke: $("#confirmRevoke"),
};

function setStep(element, mode) {
  element.classList.remove("active", "complete");
  if (mode) element.classList.add(mode);
}

function render() {
  elements.identityState.textContent = state.identityLinked ? "@you linked" : "Not linked";
  elements.budgetState.textContent = state.budgetApproved ? `${money(state.budget)} approved` : "Not approved";
  elements.commandState.textContent = state.activities.length ? "Tested" : "Waiting";

  setStep(elements.stepIdentity, state.identityLinked ? "complete" : "active");
  setStep(elements.stepBudget, state.identityLinked ? (state.budgetApproved ? "complete" : "active") : null);
  setStep(elements.stepCommand, state.budgetApproved ? "active" : null);

  elements.budgetReadout.textContent = money(state.budget);
  elements.spentReadout.textContent = money(state.spentToday);
  elements.botStatus.textContent = !state.budgetApproved ? "Not ready" : state.active ? "Active" : "Paused";
  elements.botStatus.className = `status-badge ${state.active ? "ready" : ""}`;
  elements.pauseButton.disabled = !state.budgetApproved;
  elements.revokeButton.disabled = !state.budgetApproved;
  elements.pauseButton.textContent = state.active ? "Pause bot" : "Resume bot";

  elements.commandPanel.classList.toggle("is-hidden", !state.budgetApproved);

  if (state.setupStage === "identity") {
    elements.setupTitle.textContent = "Link your demo identity";
    elements.setupDescription.textContent = "Simulates connecting an X account. No API request is made.";
    elements.setupButton.textContent = "Link @you";
  } else if (state.setupStage === "budget") {
    elements.setupTitle.textContent = "Approve a $25 test budget";
    elements.setupDescription.textContent = "Simulates a capped token allowance. No wallet permission is requested.";
    elements.setupButton.textContent = "Approve test budget";
  } else {
    elements.setupAction.classList.add("is-complete");
    elements.setupTitle.textContent = "TipBot is ready";
    elements.setupDescription.textContent = "Run a sample command or test a policy block.";
    elements.setupButton.textContent = "Ready";
    elements.setupButton.disabled = true;
  }

  renderActivities();
}

function renderActivities() {
  if (!state.activities.length) {
    elements.activityList.innerHTML = '<li class="empty-activity">Complete setup and run your first test command.</li>';
    return;
  }

  elements.activityList.innerHTML = state.activities
    .map(
      (activity) => `
        <li>
          <span class="activity-icon ${activity.ok ? "success" : "blocked"}">${activity.ok ? "✓" : "!"}</span>
          <div><strong>${activity.title}</strong><small>${activity.detail}</small></div>
          <time>${activity.time}</time>
        </li>`,
    )
    .join("");
}

function showReceipt({ ok, title, reason, amount = 0, fee = 0 }) {
  elements.receipt.classList.remove("is-hidden", "blocked");
  elements.receipt.classList.toggle("blocked", !ok);
  elements.receiptIcon.textContent = ok ? "✓" : "!";
  elements.receiptLabel.textContent = ok ? "TEST PAYMENT APPROVED" : "COMMAND BLOCKED";
  elements.receiptTitle.textContent = title;
  elements.receiptReason.textContent = reason;
  elements.receiptDetails.hidden = !ok;
  elements.tipAmount.textContent = money(amount);
  elements.feeAmount.textContent = money(fee);
  elements.budgetLeft.textContent = money(state.budget);
}

elements.setupButton.addEventListener("click", () => {
  if (state.setupStage === "identity") {
    state.identityLinked = true;
    state.setupStage = "budget";
  } else if (state.setupStage === "budget") {
    state.budgetApproved = true;
    state.budget = 25;
    state.active = true;
    state.setupStage = "ready";
  }
  render();
});

elements.runButton.addEventListener("click", () => {
  const parsed = parseTipCommand(elements.commandInput.value);
  const time = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date());

  if (!parsed.ok) {
    showReceipt({ ok: false, title: "Command not recognized", reason: parsed.reason });
    state.activities.unshift({ ok: false, title: "Command not recognized", detail: parsed.reason, time });
    render();
    return;
  }

  const result = evaluateTip({
    amount: parsed.amount,
    spentToday: state.spentToday,
    budget: state.budget,
    active: state.active,
  });

  if (!result.ok) {
    showReceipt({ ok: false, title: `${money(parsed.amount)} to ${parsed.recipient}`, reason: result.reason });
    state.activities.unshift({ ok: false, title: `Blocked ${money(parsed.amount)} tip`, detail: result.reason, time });
    render();
    return;
  }

  state.budget = Number((state.budget - result.total).toFixed(2));
  state.spentToday = Number((state.spentToday + parsed.amount).toFixed(2));
  state.activities.unshift({
    ok: true,
    title: `${money(parsed.amount)} sent to ${parsed.recipient}`,
    detail: `${money(result.fee)} service fee · sample receipt`,
    time,
  });
  showReceipt({
    ok: true,
    title: `${money(parsed.amount)} sent to ${parsed.recipient}`,
    reason: "Within your approved test budget and policy.",
    amount: parsed.amount,
    fee: result.fee,
  });
  render();
});

elements.pauseButton.addEventListener("click", () => {
  state.active = !state.active;
  render();
});

elements.revokeButton.addEventListener("click", () => elements.revokeDialog.showModal());

elements.confirmRevoke.addEventListener("click", () => {
  state.budgetApproved = false;
  state.budget = 0;
  state.active = false;
  state.setupStage = "budget";
  elements.setupAction.classList.remove("is-complete");
  elements.setupButton.disabled = false;
  elements.receipt.classList.add("is-hidden");
  render();
});

elements.resetButton.addEventListener("click", () => {
  state = initialState();
  elements.setupAction.classList.remove("is-complete");
  elements.setupButton.disabled = false;
  elements.receipt.classList.add("is-hidden");
  render();
});

render();

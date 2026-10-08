export function readinessReport(env = process.env, { botConnected = false } = {}) {
  const present = key => Boolean(env[key] && !/^(replace-|postgresql:\/\/user:password)/.test(env[key]) && (key !== "X_PROCESSOR_SECRET" || env[key].length >= 32));
  const groups = {
    identity: ["APP_ORIGIN", "X_CLIENT_ID", "X_CLIENT_SECRET"],
    persistence: ["DATABASE_URL"],
    processor: ["X_PROCESSOR_SECRET", "X_BEARER_TOKEN", "X_BOT_USER_ID"],
    replySender: ["X_PROCESSOR_SECRET"],
    devnetEvidence: ["SOLANA_RPC_URL", "DEVNET_TREASURY_OWNER", "DEVNET_TREASURY_TOKEN_ACCOUNT"],
  };
  const configuration = Object.fromEntries(Object.entries(groups).map(([name, keys]) => [name, {
    configured: keys.every(present), missing: keys.filter(key => !present(key)), liveVerified: false,
  }]));
  if (!botConnected && !present("X_BOT_USER_ACCESS_TOKEN")) {
    configuration.replySender.configured = false;
    configuration.replySender.missing.push("connected bot OAuth or X_BOT_USER_ACCESS_TOKEN");
  }
  const hasStartId = /^\d{1,30}$/.test(env.X_START_SINCE_ID || "");
  const hasStartTime = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(env.X_START_TIME || "")
    && Number.isFinite(Date.parse(env.X_START_TIME));
  if (!hasStartId && !hasStartTime) {
    configuration.processor.configured = false;
    configuration.processor.missing.push("X_START_SINCE_ID or X_START_TIME");
  }
  return { mode: "sandbox", realFundsEnabled: false, configuration, processorEnabled: env.X_PROCESSOR_ENABLED === "true",
    replySenderEnabled: env.X_REPLY_ENABLED === "true",
    launchBlockers: ["Live X mention-processor and reply verification", "Live Postgres conflict/restart tests",
      "Production transactional custody ledger", "Dedicated treasury signer and withdrawal reconciliation",
      "Deposit attribution and unique chain receipt accounting", "Distributed abuse limits and security review"],
  };
}

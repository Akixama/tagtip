export function readinessReport(env = process.env) {
  const present = key => Boolean(env[key] && !/^(replace-|postgresql:\/\/user:password)/.test(env[key]) && (key !== "X_PROCESSOR_SECRET" || env[key].length >= 32));
  const groups = {
    identity: ["APP_ORIGIN", "X_CLIENT_ID", "X_CLIENT_SECRET"],
    persistence: ["DATABASE_URL"],
    processor: ["X_PROCESSOR_SECRET", "X_BEARER_TOKEN", "X_BOT_USER_ID", "X_START_SINCE_ID"],
    devnetEvidence: ["SOLANA_RPC_URL", "DEVNET_TREASURY_OWNER", "DEVNET_TREASURY_TOKEN_ACCOUNT"],
  };
  const configuration = Object.fromEntries(Object.entries(groups).map(([name, keys]) => [name, {
    configured: keys.every(present), missing: keys.filter(key => !present(key)), liveVerified: false,
  }]));
  return { mode: "sandbox", realFundsEnabled: false, configuration, processorEnabled: env.X_PROCESSOR_ENABLED === "true",
    launchBlockers: ["Live X OAuth and mention-processor verification", "Live Postgres conflict/restart tests",
      "Production transactional custody ledger", "Dedicated treasury signer and withdrawal reconciliation",
      "Deposit attribution and unique chain receipt accounting", "Distributed abuse limits and security review"],
  };
}

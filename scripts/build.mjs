import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Only these browser assets are deployed as public files. Never copy src wholesale.
const assets = ["index.html", "send.html", "claim.html", "account.html", "style.css",
  "src/core.js", "src/app.js", "src/claim.js", "src/account-ui.js"];
for (const asset of assets) {
  const destination = resolve("public", asset);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(asset), destination);
}
console.log(`Built ${assets.length} allowlisted public assets.`);

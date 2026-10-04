import { readinessReport } from "../src/readiness.js";
const report = readinessReport();
console.log("TagTip configuration check — values and credentials are never printed.");
for (const [name, group] of Object.entries(report.configuration)) {
  console.log(`${name}: ${group.configured ? "configured (live verification still required)" : `missing ${group.missing.join(", ")}`}`);
}
console.log(`Processor enabled: ${report.processorEnabled}. Real funds enabled: false.`);
console.log("Remaining launch gates:");
for (const gate of report.launchBlockers) console.log(`- ${gate}`);

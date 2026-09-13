import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validateTranscriptionSummary(summary) {
  const counts = ["total", "transcribed", "reused", "failed"].map((key) => Number(summary?.[key] || 0));
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("Invalid transcription counts");
  }
  const [total, transcribed, reused, failed] = counts;
  const successful = transcribed + reused;
  if (successful + failed !== total) {
    throw new Error("Transcription counts do not match total; Feishu write must be skipped");
  }
  if (total > 0 && successful === 0) {
    throw new Error("All ranked video transcriptions failed; Feishu write must be skipped");
  }
  return { status: "valid", total, successful, failed };
}

function main() {
  const summaryPath = process.argv[2];
  if (!summaryPath) throw new Error("Usage: node validate-transcription-summary.mjs <transcription-summary.json>");
  const summary = JSON.parse(fs.readFileSync(path.resolve(summaryPath), "utf8"));
  process.stdout.write(`${JSON.stringify(validateTranscriptionSummary(summary), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

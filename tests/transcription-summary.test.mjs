import assert from "node:assert/strict";
import test from "node:test";
import { validateTranscriptionSummary } from "../scripts/validate-transcription-summary.mjs";

test("allows complete and partially successful transcription batches", () => {
  assert.deepEqual(validateTranscriptionSummary({ total: 3, transcribed: 3, reused: 0, failed: 0 }), {
    status: "valid", total: 3, successful: 3, failed: 0,
  });
  assert.deepEqual(validateTranscriptionSummary({ total: 3, transcribed: 1, reused: 0, failed: 2 }), {
    status: "valid", total: 3, successful: 1, failed: 2,
  });
});

test("blocks Feishu writes when every ranked video transcription fails", () => {
  assert.throws(
    () => validateTranscriptionSummary({ total: 3, transcribed: 0, reused: 0, failed: 3 }),
    /Feishu write must be skipped/,
  );
});

test("blocks Feishu writes when transcription counts are inconsistent", () => {
  assert.throws(
    () => validateTranscriptionSummary({ total: 3, transcribed: 1, reused: 0, failed: 0 }),
    /counts do not match total/,
  );
});

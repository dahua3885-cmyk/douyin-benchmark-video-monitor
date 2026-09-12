import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.dirname(testDir);

test("Feishu QR helper generates a PNG and returns the original opaque URL", { skip: process.platform !== "win32" }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-monitor-qr-"));
  const mockCli = path.join(tempDir, "lark-cli.ps1");
  fs.writeFileSync(mockCli, [
    "param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)",
    "$outputIndex = [Array]::IndexOf($CliArgs, '--output')",
    "if ($outputIndex -lt 0) { exit 2 }",
    "$outputPath = $CliArgs[$outputIndex + 1]",
    "[System.IO.File]::WriteAllBytes((Join-Path (Get-Location) $outputPath), [byte[]]@(137,80,78,71))",
    "exit 0",
  ].join("\n"));

  const relativeOutput = `work/test-${Date.now()}-authorization.png`;
  const absoluteOutput = path.join(repoDir, relativeOutput);
  const verificationUrl = "https://example.invalid/verify?token=a%2Bb&state=x-y";
  try {
    const stdout = execFileSync("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(repoDir, "scripts", "show-auth-qr.ps1"),
      "-VerificationUrl", verificationUrl, "-OutputRelativePath", relativeOutput, "-NoOpen",
    ], { encoding: "utf8", env: { ...process.env, PATH: `${tempDir}${path.delimiter}${process.env.PATH}` }, windowsHide: true });
    const result = JSON.parse(stdout);
    assert.equal(result.verification_url, verificationUrl);
    assert.equal(result.opened, false);
    assert.equal(fs.existsSync(absoluteOutput), true);
  } finally {
    fs.rmSync(absoluteOutput, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

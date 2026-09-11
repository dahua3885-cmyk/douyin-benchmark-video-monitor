# Douyin Benchmark Video Monitor

A Codex Skill for collecting user-supplied Douyin benchmark accounts and keywords in Codex's in-app browser, ranking account videos over 30 days and keyword videos over 7 days, and optionally writing deduplicated results to the user's own Feishu Base.

The repository contains no production account list, keyword strategy, browser session, Feishu resource identifier, credential, or collected platform data.

## Workflow

1. Benchmark accounts are collected sequentially, one account at a time.
2. Keywords start only after accounts finish. Two keyword tabs run by default, with a hard maximum of three in the same Codex browser session.
3. Risk control pauses all workers and changes the rest of that run to one keyword at a time.
4. Each keyword inspects at most 10 candidates and retains at most 5 qualified videos.
5. Videos are deduplicated by platform and video ID; all matched keywords are preserved on one row.
6. Account videos use a 30-day window. Keyword videos use a 7-day window.
7. Results are written to local artifacts and, when configured, to Feishu Base using bot identity.

## Install

Clone the repository into the Codex skills directory:

```powershell
git clone https://github.com/dahua3885-cmyk/douyin-benchmark-video-monitor.git `
  "$env:USERPROFILE\.codex\skills\douyin-benchmark-video-monitor"
```

Install runtime dependencies:

```powershell
python -m pip install -r requirements.txt
```

The workflow also requires Node.js, PowerShell, FFmpeg for transcription, `lark-cli` for Feishu, and a Codex environment with in-app browser control.

## Configure

```powershell
Copy-Item config\project.example.json config\project.local.json
node scripts\validate-config.mjs config\project.local.json
```

Edit only `config/project.local.json`. Add your own benchmark account links and keywords. The file is ignored by Git.

Invoke the Skill in Codex:

```text
使用 $douyin-benchmark-video-monitor 初始化我的对标视频监控。
```

Codex will guide the one-time Douyin login in its in-app browser and the user's own Feishu setup. Feishu application scopes can be requested together, but the target Base may still require one explicit resource-access grant. Unattended runs use bot identity and do not repeatedly scan a QR code.

## Validate And Test

```powershell
node scripts\validate-config.mjs config\project.example.json
node --test tests\ranking.test.mjs
```

Run the included local fixture through the pipeline:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\run-monitor.ps1 `
  -ConfigPath tests\fixtures\project.json `
  -CodexBrowserCandidates tests\fixtures\candidates.json `
  -CodexBrowserSummary tests\fixtures\summary.json `
  -LocalOnly -SkipEnrichment -Now "2026-01-31T12:00:00+08:00"
```

## Privacy And Platform Rules

- Never commit local configuration, credentials, browser state, raw responses, or collected output.
- Do not automate passwords, bypass CAPTCHA, evade risk controls, or replace the in-app browser with an undisclosed browser profile.
- Collect only data the operator is authorized to access and follow applicable platform terms and laws.
- Transcripts, covers, and videos remain third-party content and are not licensed by this repository.

Licensed under Apache-2.0.

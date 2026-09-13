---
name: douyin-benchmark-video-monitor
description: Configure and run a private daily Douyin benchmark-video monitor from user-supplied account URLs and keywords. Use Codex's in-app browser to collect account videos sequentially, search keywords with bounded concurrency and risk fallback, rank 30-day account videos and 7-day keyword videos, and optionally write deduplicated results to the user's own Feishu Base.
metadata:
  version: "0.3.1"
---

# Douyin Benchmark Video Monitor

Keep each user's accounts, keywords, browser session, Feishu identifiers, credentials, state, and collected data local. The repository contains only the reusable workflow and example configuration.

## Start Here

1. If `config/project.local.json` is missing, read [references/setup.md](references/setup.md), help the user create it from `config/project.example.json`, and validate it with `node scripts/validate-config.mjs`.
2. Create or select the Douyin tab in Codex's in-app browser with `visible: true` for login. Navigate to the login QR screen and keep it visible until the user scans it. Confirm the logged-in identity, then reuse that in-app browser session. Never start Chrome, Edge, Playwright persistent profiles, or a second browser identity.
3. If Feishu output or commands are enabled, read [references/feishu-setup.md](references/feishu-setup.md). Every Feishu verification URL must be shown unchanged as a clickable link and as a generated PNG QR code opened in Codex. Runtime writes and replies use bot identity. Do not ask for a notification recipient or group.
4. Before collection, read [references/collection-contract.md](references/collection-contract.md). Its artifact schema and sequencing rules are mandatory.
5. Before the first OCR or transcription run, execute `scripts/install-dependencies.ps1`. `run-monitor.ps1` does this automatically when the verified local runtime is absent. Do not ask the user to install Python packages, FFmpeg, yt-dlp, or the configured Whisper model one by one.

## Collection Order

Always collect in two phases:

1. Collect benchmark accounts one at a time, in configuration order. Retain at most 60 public posts per account.
2. After all accounts finish, search keywords. Default concurrency is 2 and the hard maximum is 3, using tabs in the same Codex in-app browser session. Inspect at most 10 video candidates per keyword.

If any keyword tab shows a visible verification challenge, login challenge, rate-limit response, or other risk-control state, pause all keyword workers. Show the in-app browser only when the user must act. After verification, continue the rest of that run with keyword concurrency fixed at 1. Never bypass a CAPTCHA or misreport a technical failure as an empty market result.

One account or keyword failure must not discard successful sources. Record the failure and continue where safe.

## Ranking Rules

- Benchmark-account videos use a rolling 30-day publication window.
- Keyword videos use a rolling 7-day publication window.
- Apply the configured follower-tier like floor to both sources. Never treat missing follower counts as a small account; unresolved follower counts are ineligible.
- For benchmark accounts with at least 20 valid non-pinned history posts, use the higher of the tier floor and the account's recent like P70. Use up to 30 recent non-pinned posts for that baseline.
- For each keyword, retain at most 5 qualifying videos from its 10 inspected candidates. Fewer than 5 is valid; never lower thresholds to fill a quota.
- Deduplicate globally by `platform + video_id`. Merge all matched keywords and source types into the single video row. A duplicate never receives extra ranking weight.
- Sort by likes descending; use score descending only to break equal-like ties.
- Weighted interaction is `likes + comments*3 + collects*6 + shares*4`.

The public default follower tiers are bootstrap heuristics, not an industry research standard. Account P70 is the preferred calibration once enough history exists.

## Artifacts And Execution

The in-app browser collection must produce `codex-browser-candidates.json` and `codex-browser-summary.json` that satisfy the collection contract. Then run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-monitor.ps1 `
  -CodexBrowserCandidates <candidates.json> `
  -CodexBrowserSummary <summary.json>
```

Use `-LocalOnly` for validation and ranking without a Feishu write. Each run writes an isolated directory under the configured local output root, including account, keyword, combined, snapshot, state, summary, and run-log artifacts.

Before the first Feishu write, preview and create the four required `视频数据` views with `scripts/ensure-feishu-views.mjs`. `write-feishu.ps1` runs the same idempotent view maintenance automatically before every write so rolling date filters remain current:

- `最近7天榜单`: all qualifying benchmark-account and keyword videos published in the last 7 days.
- `对标账号视频`: benchmark-account videos published in the last 30 days.
- `关键词爆款`: keyword videos published in the last 7 days.
- `历史记录`: all retained records without a date filter.

These are four views of the same deduplicated `视频数据` table, not four separate tables. Never delete old rows merely because they leave a rolling view.

Each view must use its exact field order from [references/feishu-schema.md](references/feishu-schema.md). The setup script creates the supplemental text fields `来源`, `内容方向`, and `关键词` when missing, then applies view-specific visible fields. Feishu may keep its primary field pinned first even when the requested visible-field order starts with `账号昵称`; do not rebuild or destructively migrate an existing table merely to override that platform constraint.

## Transcription

For every ranked video, prefer a fresh `media_url` captured from the in-app browser. If it is missing or expired, `transcribe-ranking.py` must try the public `视频链接` through yt-dlp, extract audio with the bundled `imageio-ffmpeg` runtime, and transcribe with faster-whisper. Run transcription before the Feishu write so `视频文案` contains the result.

Normalize successful Chinese transcripts to Simplified Chinese locally before caching and writing them to Feishu.

The repository ships installation and runtime-resolution scripts, not platform-specific binaries or model weights. On first run, the scripts automatically create `.venv`, install pinned dependency ranges, resolve FFmpeg, and download the configured Whisper model to the local cache. If both direct-media and public-page downloads fail, mark the run partial and write the exact stable failure reason to `transcription-summary.json` and `数据备注`; never silently present an empty transcript as success.

When transcription is enabled and every ranked video fails transcription, stop before the Feishu write. A partially successful batch may be written with per-row failure notes, but an all-empty `视频文案` batch must never replace or create the daily Feishu result.

## Feishu Commands

When the user asks to listen for Feishu commands, use `lark-cli event consume im.message.receive_v1 --as bot` and follow the installed `lark-event` instructions. Accept only these exact text commands:

- `开始今日采集`
- `查看采集状态`
- `查看今日榜单`
- `查看失败记录`

Reply to the originating message or chat. Do not store a separate notification recipient. A collection command must still run through the Codex in-app browser workflow; a standalone listener cannot silently substitute another browser.

## Safety And Completion

- Never commit `config/project.local.json`, `.env`, browser state, run output, caches, tokens, raw platform responses, or local absolute paths.
- Use Feishu bot identity for unattended runs. User OAuth, when required during setup, should request all necessary scopes in one Feishu consent flow; Base resource access may still require one explicit collaborator grant. Douyin and Feishu are separate services and cannot share one QR code.
- Upsert Feishu video records by the real business key. Check for an existing record and update by its returned `record_id`; do not assume a command automatically deduplicates by field.
- Do not claim a run succeeded unless collection validation, ranking, enabled enrichment, Feishu write, and write verification all pass. Report partial results and exact failed sources otherwise.

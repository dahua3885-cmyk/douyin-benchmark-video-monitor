---
name: douyin-benchmark-video-monitor
description: Configure and run a private daily Douyin benchmark-video monitor from user-supplied account URLs and keywords. Use Codex's in-app browser to collect account videos sequentially, search keywords with bounded concurrency and risk fallback, rank 30-day account videos and 7-day keyword videos, and optionally write deduplicated results to the user's own Feishu Base.
metadata:
  version: "0.1.0"
---

# Douyin Benchmark Video Monitor

Keep each user's accounts, keywords, browser session, Feishu identifiers, credentials, state, and collected data local. The repository contains only the reusable workflow and example configuration.

## Start Here

1. If `config/project.local.json` is missing, read [references/setup.md](references/setup.md), help the user create it from `config/project.example.json`, and validate it with `node scripts/validate-config.mjs`.
2. Bind a Douyin tab in the Codex in-app browser and let the user scan the Douyin QR code once. Reuse that in-app browser session. Never start Chrome, Edge, Playwright persistent profiles, or a second browser identity.
3. If Feishu output or commands are enabled, read [references/feishu-setup.md](references/feishu-setup.md). Runtime writes and replies use bot identity. Do not ask for a notification recipient or group.
4. Before collection, read [references/collection-contract.md](references/collection-contract.md). Its artifact schema and sequencing rules are mandatory.

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

## Feishu Commands

When the user asks to listen for Feishu commands, use `lark-cli event consume im.message.receive_v1 --as bot` and follow the installed `lark-event` instructions. Accept only these exact text commands:

- `开始今日采集`
- `查看采集状态`
- `查看今日榜单`
- `查看失败记录`

Reply to the originating message or chat. Do not store a separate notification recipient. A collection command must still run through the Codex in-app browser workflow; a standalone listener cannot silently substitute another browser.

## Safety And Completion

- Never commit `config/project.local.json`, `.env`, browser state, run output, caches, tokens, raw platform responses, or local absolute paths.
- Use Feishu bot identity for unattended runs. User OAuth, when required during setup, should request all necessary scopes in one consent flow; Base resource access may still require one explicit collaborator grant.
- Upsert Feishu video records by the real business key. Check for an existing record and update by its returned `record_id`; do not assume a command automatically deduplicates by field.
- Do not claim a run succeeded unless collection validation, ranking, enabled enrichment, Feishu write, and write verification all pass. Report partial results and exact failed sources otherwise.

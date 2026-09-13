# Douyin Benchmark Video Monitor

A Codex Skill for collecting user-supplied Douyin benchmark accounts and keywords in Codex's in-app browser, ranking account videos over 30 days and keyword videos over 7 days, transcribing ranked videos, and writing deduplicated results to the user's own Feishu Base. Version 0.3.1 gives each Feishu view its own field order, automatically installs the local enrichment runtime, and normalizes Chinese transcripts to Simplified Chinese.

The repository contains no production account list, keyword strategy, browser session, Feishu resource identifier, credential, or collected platform data.

## Workflow

1. Benchmark accounts are collected sequentially, one account at a time.
2. Keywords start only after accounts finish. Two keyword tabs run by default, with a hard maximum of three in the same Codex browser session.
3. Risk control pauses all workers and changes the rest of that run to one keyword at a time.
4. Each keyword inspects at most 10 candidates and retains at most 5 qualified videos.
5. Videos are deduplicated by platform and video ID; all matched keywords are preserved on one row.
6. Account videos use a 30-day window. Keyword videos use a 7-day window.
7. Results are written to local artifacts and, when configured, to Feishu Base using bot identity.
8. The single `视频数据` table exposes `最近7天榜单`, `对标账号视频`, `关键词爆款`, and `历史记录` views.

## Install

Clone the repository into the Codex skills directory:

```powershell
git clone https://github.com/dahua3885-cmyk/douyin-benchmark-video-monitor.git `
  "$env:USERPROFILE\.codex\skills\douyin-benchmark-video-monitor"
```

The Skill automatically installs its private Python runtime on the first enriched run. To prepare it immediately:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-dependencies.ps1
```

This creates `.venv`, installs OCR, yt-dlp and faster-whisper, resolves a private FFmpeg binary through `imageio-ffmpeg`, and downloads the configured Whisper model. Large third-party binaries and model weights are not committed to GitHub; they are downloaded automatically because they are platform-specific and substantially larger than the Skill. The workflow also requires Node.js, PowerShell, Python, `lark-cli` for Feishu, and a Codex environment with in-app browser control.

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

Codex will show the Douyin login in a visible in-app browser tab. For Feishu, every verification URL is shown both as a clickable link and an opened PNG QR code. Feishu application scopes can be requested together, but the target Base may still require one explicit resource-access grant. Douyin and Feishu use separate QR codes. Unattended runs use the saved Douyin session and Feishu bot identity, so daily collection does not repeatedly ask for a scan.

After the Base tables and fields exist, preview and create the required views:

```powershell
node scripts\ensure-feishu-views.mjs --config=config\project.local.json --dry-run
node scripts\ensure-feishu-views.mjs --config=config\project.local.json
```

The write pipeline also runs this view maintenance automatically before every Feishu write, refreshing the rolling 7-day and 30-day boundaries and applying the view-specific field order documented in `references/feishu-schema.md`.

## Transcription behavior

Collection should capture a fresh playable `media_url` when Douyin exposes one. When that field is unavailable or the signed URL expires, the transcription step automatically tries the public `视频链接` through yt-dlp. Empty transcripts are never counted as success: `transcription-summary.json` records whether the video source was missing, both download methods failed, audio extraction failed, or no speech was detected.

## Validate And Test

```powershell
node scripts\validate-config.mjs config\project.example.json
npm test
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

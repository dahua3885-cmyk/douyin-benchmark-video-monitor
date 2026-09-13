# v0.3.1 Acceptance Checklist

Checked on Windows for the public, reusable Skill package. Private account lists, keywords, Feishu identifiers, credentials, browser state, and collected production data are intentionally absent.

| Check | Result | Evidence |
|---|---|---|
| Windows single installation and run entry | Pass | `README.md`, `scripts/install-dependencies.ps1`, `scripts/run-monitor.ps1` |
| Codex in-app browser contract | Pass | Account concurrency 1; keyword concurrency 2, max 3, risk fallback 1 |
| Ranking windows | Pass | Account 30 days; keyword 7 days; combined 7-day view includes both sources |
| Keyword candidate and result limits | Pass | Inspect at most 10; retain at most 5 qualified videos |
| Global video deduplication | Pass | `platform + video_id`; matched keywords and source types are merged |
| Four Feishu views and field order | Pass | Automated view-plan tests cover all four required views |
| Dependency bootstrap | Pass | Creates `.venv`, installs pinned packages, resolves FFmpeg, downloads the configured Whisper model |
| Dependency change detection | Pass | Runtime marker records and compares the SHA-256 of `requirements.txt` |
| Local video transcription | Pass | A Chinese MP4 was downloaded or read locally, audio was extracted with local FFmpeg, and local faster-whisper produced Simplified Chinese text |
| Transcript cache reuse | Pass | Three ranked videos reused local transcript cache successfully |
| Transcript writeback | Pass | Three ranked rows contained a non-empty `视频文案` in `combined-ranking.json` |
| Partial failure notes | Pass | Each failed row records a stable reason in `数据备注` and `transcription-summary.json` |
| All-failure Feishu guard | Pass | Integration run stopped at `validate_transcription_output`; no `write_feishu` step was reached |
| Node tests | Pass | 11/11 |
| Python tests | Pass | 4/4 |
| PowerShell syntax | Pass | Three entry scripts parsed successfully |
| Python compile | Pass | Runtime, transcription, and test modules compiled successfully |
| Skill structure validation | Pass | `quick_validate.py` reported `Skill is valid!` |
| Live Douyin collection | Not run | Requires the installer's private Douyin login and `config/project.local.json` |
| Live Feishu write verification | Not run | Requires the installer's private Feishu app and Base configuration |

The last two checks are installation-specific integration checks. Their private inputs must never be committed to this repository.

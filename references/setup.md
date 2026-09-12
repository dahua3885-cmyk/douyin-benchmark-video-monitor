# Setup

## Private project configuration

Copy `config/project.example.json` to `config/project.local.json`, then replace every example account and keyword. The local file is ignored by Git and is the only source of truth for that installation.

Required user inputs are the project name and timezone, benchmark account names and Douyin profile URLs, keyword groups and keywords, daily run time, the user's own Douyin login in Codex's in-app browser, and the user's own Feishu app and Base when Feishu output is enabled.

There is no account/content exclusion list and no notification recipient/group setting.

Validate the local configuration:

```powershell
node scripts/validate-config.mjs config/project.local.json
```

## Douyin login

Create or select the Douyin tab in the Codex in-app browser with `visible: true`, navigate to the login QR screen, keep the QR visible while the user scans it, and confirm the visible account identity if the local configuration specifies one. Reuse this browser session for later runs. Do not merely print a login URL in the terminal. Douyin authentication is separate from Feishu authorization and cannot be combined with it.

Keep the browser hidden during unattended work. Make it visible only for login, QR scanning, CAPTCHA, explicit authorization, or another interaction that requires the user.

## Daily automation

After one successful local dry-run and one successful Feishu write verification, create the daily Codex automation at `schedule.daily_time`. The automation must run the account phase first, then the keyword phase, and must not silently fall back to a standalone browser.

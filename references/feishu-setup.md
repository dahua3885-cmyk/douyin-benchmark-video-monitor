# Feishu Setup

## Authorization model

Use a user-owned Feishu application and bot. Configure all required API scopes before the first authorization so user OAuth, if needed for setup, is granted in one Feishu consent flow. Daily runtime uses bot identity and must not call `auth login`.

Feishu separates two permission layers:

1. Application API scopes, approved in the developer console.
2. Resource access to the specific Base, granted once by adding the app/bot as a collaborator or using a Base created for the bot.

These cannot always be collapsed into one QR action. Douyin login is a separate authorization. Never promise one QR for both services.

## QR presentation contract

Never leave a verification URL only in terminal output. For `config init` or the optional user OAuth flow:

1. Extract `verification_url` exactly as returned; do not edit, encode, decode, or rebuild it.
2. Run `scripts/show-auth-qr.ps1 -VerificationUrl <exact-url>`. It creates a local PNG and opens it visibly for scanning by default.
3. Open the returned `qr_path` in a Codex file panel with `open_in_codex` when that tool is available, and show the unchanged URL as a clickable link in the same response.
4. End the turn so the user can scan. For user OAuth split-flow, continue later with `lark-cli auth login --device-code <device_code>` only after the user confirms authorization.

For user OAuth, initiate with all already-approved scopes in one command using `lark-cli auth login --scope "<complete scope list>" --no-wait --json`. Do not issue one login per scope. Do not run `auth login` for bot identity.

The minimum feature set needs Base record read/write, bot message receive, and bot reply permissions. At the time of this release, `im.message.receive_v1` reports `im:message.p2p_msg:readonly`, and bot replies use `im:message`; group command use can require the corresponding group-message permission. Use current `lark-cli` help and permission errors to assemble the full Base and IM scope list before presenting the single consent screen.

Store app credentials in the local lark-cli credential store or environment variables, never in `project.local.json` or Git.

## Base preparation

Create three tables using [feishu-schema.md](feishu-schema.md):

- `视频数据`
- `每日互动趋势`
- `运行日志`

Resolve the real `base_token` and `table_id` values and save them only in `config/project.local.json`. Before the first write, list the actual fields and run a local dry-run. Runtime writes use `--as bot`.

After the three tables and fields exist, initialize the four views in `视频数据`:

```powershell
node scripts\ensure-feishu-views.mjs --config=config\project.local.json --dry-run
node scripts\ensure-feishu-views.mjs --config=config\project.local.json
```

The script is idempotent. It creates missing `来源`, `内容方向`, and `关键词` text fields. On a new Base it renames the lone default `表格`/`Grid` view to `最近7天榜单`, creates the other three views, and configures their filters, sort order, and view-specific visible-field order. On later runs it reuses named views and refreshes the rolling date boundaries. `write-feishu.ps1` calls it automatically before records are written.

## Command mode

Consume `im.message.receive_v1` as bot after reading the current `lark-event` instructions. Accept only exact supported text commands. Reply to the originating `message_id` or `chat_id`; do not configure a separate notification recipient.

An always-on Feishu listener requires an active local process or hosted dispatcher. The Skill can handle commands while its listener is running, but a GitHub repository by itself is not a continuously running service.

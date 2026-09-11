# Feishu Setup

## Authorization model

Use a user-owned Feishu application and bot. Configure all required API scopes before the first authorization so user OAuth, if needed for setup, can be granted in one consent flow. Daily runtime uses bot identity and must not call `auth login`.

Feishu separates two permission layers:

1. Application API scopes, approved in the developer console.
2. Resource access to the specific Base, granted once by adding the app/bot as a collaborator or using a Base created for the bot.

These cannot always be collapsed into one QR action. Douyin login is a separate authorization. Never promise one QR for both services.

The minimum feature set needs Base record read/write, bot message receive, and bot reply permissions. At the time of this release, `im.message.receive_v1` reports `im:message.p2p_msg:readonly`, and bot replies use `im:message`; group command use can require the corresponding group-message permission. Use current `lark-cli` help and permission errors to assemble the full Base and IM scope list before presenting the single consent screen.

Store app credentials in the local lark-cli credential store or environment variables, never in `project.local.json` or Git.

## Base preparation

Create three tables using [feishu-schema.md](feishu-schema.md):

- `视频数据`
- `每日互动趋势`
- `运行日志`

Resolve the real `base_token` and `table_id` values and save them only in `config/project.local.json`. Before the first write, list the actual fields and run a local dry-run. Runtime writes use `--as bot`.

## Command mode

Consume `im.message.receive_v1` as bot after reading the current `lark-event` instructions. Accept only exact supported text commands. Reply to the originating `message_id` or `chat_id`; do not configure a separate notification recipient.

An always-on Feishu listener requires an active local process or hosted dispatcher. The Skill can handle commands while its listener is running, but a GitHub repository by itself is not a continuously running service.

# Feishu Base Schema

## 视频数据

Use one record per `平台 + 视频ID`.

| Field | Type | Notes |
|---|---|---|
| 视频标题 | Text, primary | Human-readable title |
| 唯一键 | Text | `平台:视频ID`; business unique key |
| 平台 | Select | `抖音` |
| 视频ID | Text | Platform video ID |
| 账号昵称 | Text | Author nickname |
| 账号主页 | URL | Author profile |
| 粉丝数 | Number | Required for eligibility |
| 来源类型 | Multi-select | `对标账号`, `关键词` |
| 命中关键词 | Multi-select | All matching keywords; never duplicate the row |
| 入榜关键词 | Multi-select | Keywords for which the video is in that keyword's Top 5 |
| 来源窗口 | Multi-select | `近30天账号`, `近7天关键词` |
| 发布时间 | DateTime | Actual publication time |
| 点赞 | Number | Latest observed value |
| 评论 | Number | Latest observed value |
| 收藏 | Number | Latest observed value |
| 分享 | Number | Latest observed value |
| 评分 | Number | Tie-break score |
| 加权互动值 | Number | Like/comment/collect/share weighted sum |
| 入榜点赞门槛 | Number | Effective tier or P70 threshold |
| 账号P70 | Number | Empty when insufficient history or keyword-only |
| 视频链接 | URL | Public video link |
| 封面标题 | Text | OCR result |
| 视频文案 | Text | Audio transcript only |
| 发布文案 | Text | Kept separate from transcript |
| 首次发现时间 | DateTime | Local state-derived timestamp |
| 最近更新时间 | DateTime | Latest snapshot time |
| 预计下榜时间 | DateTime | Source-window-derived exit time |
| 在榜状态 | Text | New/current/history status |
| 数据备注 | Text | Partial failures and missing enrichment |

The Skill must create and maintain these four grid views in this one table:

| View | Filter | Sort |
|---|---|---|
| `最近7天榜单` | `发布时间` is within the rolling last 7 days; includes both benchmark-account and keyword sources | `点赞` descending, then `评分` descending |
| `对标账号视频` | `来源类型` contains `对标账号`; `发布时间` is within the rolling last 30 days | `点赞` descending, then `评分` descending |
| `关键词爆款` | `来源类型` contains `关键词`; `发布时间` is within the rolling last 7 days | `点赞` descending, then `评分` descending |
| `历史记录` | No filter; retains all historical rows | `点赞` descending, then `评分` descending |

The first view intentionally includes 7-day benchmark-account rows even though the dedicated account view covers 30 days. One video matched by multiple keywords or by both source types remains one row because the table business key is `平台 + 视频ID`.

## 每日互动趋势

Fields: `快照ID` (primary text), `快照时间`, `唯一键`, `账号昵称`, `粉丝数`, `点赞`, `评论`, `收藏`, `分享`, `加权互动值`, `是否当期入榜`.

## 运行日志

Fields: `运行ID` (primary text), `开始时间`, `结束时间`, `状态`, `账号采集`, `关键词采集`, `账号榜视频`, `关键词榜视频`, `综合唯一视频`, `失败说明`.

# Codex In-App Browser Collection Contract

This workflow uses only the Codex in-app browser. Browser identifiers and login state remain local and must not be stored in the repository.

## Required sequence

1. Verify that the fixed in-app browser session is logged into Douyin.
2. Collect benchmark accounts sequentially in configuration order. Never overlap two account collections.
3. Only after the account phase completes, create a keyword queue.
4. Run 2 keyword workers by default and never more than 3. Workers may use separate tabs in the same in-app browser session.
5. Inspect at most 10 video candidates per keyword.
6. On visible verification, login challenge, rate limiting, or risk control, pause every keyword worker. After the user resolves the challenge, use one worker for the rest of that run.
7. Preserve the fixed browser session for the next run.

## Candidate artifact

`codex-browser-candidates.json` is a JSON array. The collector must already deduplicate by `platform + video_id`, merging `sources` and `matched_keywords`.

```json
[
  {
    "platform": "抖音",
    "video_id": "7000000000000000001",
    "account_name": "示例作者",
    "account_url": "https://www.douyin.com/user/EXAMPLE",
    "follower_count": 80000,
    "title": "示例视频标题",
    "copy": "示例发布文案",
    "transcript": "",
    "published_at": "2026-01-30T04:00:00.000Z",
    "likes": 3200,
    "comments": 80,
    "collects": 420,
    "shares": 110,
    "video_url": "https://www.douyin.com/video/7000000000000000001",
    "cover_url": "",
    "media_url": "",
    "duration_ms": 60000,
    "is_pinned": false,
    "sources": ["benchmark_account:示例账号", "keyword:示例关键词"],
    "matched_keywords": ["示例关键词"],
    "collection_status": "success"
  }
]
```

## Summary artifact

`codex-browser-summary.json` records how the run was performed:

```json
{
  "status": "complete",
  "captured_at": "2026-01-31T12:00:00.000Z",
  "browser": {"provider": "codex_in_app_browser", "login_verified": true},
  "phases": ["accounts", "keywords"],
  "account_max_observed_concurrency": 1,
  "keyword_concurrency": {"initial": 2, "max_observed": 2, "risk_triggered": false, "after_risk": null},
  "accounts": [
    {"account": "示例账号", "sequence": 1, "status": "success", "examined_count": 20, "error": ""}
  ],
  "keywords": [
    {"keyword": "示例关键词", "status": "success_with_results", "examined_count": 10, "error": ""}
  ],
  "candidate_count": 1
}
```

Allowed source statuses are `success`, `success_with_results`, `success_empty`, `login_required`, `verification_required`, `rate_limited`, and `failed`. A technical failure is never `success_empty`.

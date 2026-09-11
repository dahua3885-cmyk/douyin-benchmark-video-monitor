import argparse
import json
import re
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from rapidocr_onnxruntime import RapidOCR


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_date(value, timezone):
    if isinstance(value, (int, float)) or str(value or "").isdigit():
        return datetime.fromtimestamp(float(value), timezone)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--now")
    args = parser.parse_args()

    rows = json.loads(Path(args.input).read_text(encoding="utf-8"))
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    timezone = ZoneInfo(config["project"]["timezone"])
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(timezone)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone)
    cutoff = now - timedelta(days=int(config["collection"]["account_window_days"]))

    output = Path(args.output)
    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    engine = RapidOCR()
    result = {}
    failures = []

    for row in rows:
        video_id = str(row.get("video_id") or "")
        try:
            in_window = cutoff <= parse_date(row.get("published_at"), timezone) <= now
        except (TypeError, ValueError):
            in_window = False
        if not video_id or not in_window or int(row.get("likes") or 0) < int(config["ranking"]["absolute_minimum_likes"]):
            continue
        cover_url = row.get("cover_url") or ""
        if not cover_url:
            result[video_id] = "待识别"
            failures.append({"video_id": video_id, "reason": "missing_cover_url"})
            continue
        image_path = cache_dir / f"{video_id}.jpg"
        try:
            if not image_path.exists():
                request = urllib.request.Request(cover_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    image_path.write_bytes(response.read())
            items, _ = engine(str(image_path))
            text = clean(" ".join(str(item[1]) for item in (items or []) if len(item) >= 2))
            result[video_id] = text or "无文字封面"
        except Exception as error:  # noqa: BLE001 - failures are reported per video
            result[video_id] = "待识别"
            failures.append({"video_id": video_id, "reason": clean(error)})

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "count": len(result), "failures": failures}, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(2)


if __name__ == "__main__":
    main()

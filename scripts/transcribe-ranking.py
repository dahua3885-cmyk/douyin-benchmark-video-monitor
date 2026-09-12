import argparse
import csv
import json
import os
import subprocess
import urllib.request
import wave
from pathlib import Path

CSV_HEADERS = [
    "视频标题", "账号昵称", "粉丝数", "来源类型", "命中关键词", "入榜关键词",
    "来源窗口", "发布时间", "点赞", "评论", "收藏", "分享", "评分", "视频链接", "视频文案",
]


def clean(value):
    return " ".join(str(value or "").split())


def hidden_flags():
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def download_direct(url, target):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.douyin.com/"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            target.write_bytes(response.read())
        return target.exists() and target.stat().st_size > 0
    except Exception:  # noqa: BLE001 - caller records a stable per-video failure
        return False


def download_page(url, target):
    from yt_dlp import YoutubeDL

    options = {
        "format": "best[ext=mp4]/best",
        "outtmpl": str(target),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 2,
        "socket_timeout": 60,
    }
    try:
        with YoutubeDL(options) as downloader:
            result = downloader.download([url])
        return result == 0 and target.exists() and target.stat().st_size > 0
    except Exception:  # noqa: BLE001 - do not leak signed URLs or cookies into logs
        return False


def download_candidate(candidate, target):
    media_url = clean(candidate.get("media_url"))
    video_url = clean(candidate.get("video_url") or candidate.get("link"))
    if media_url and download_direct(media_url, target):
        return True, "media_url"
    target.unlink(missing_ok=True)
    if video_url and download_page(video_url, target):
        return True, "video_page"
    return False, "media_and_page_download_failed" if media_url and video_url else "missing_downloadable_video_source"


def extract_audio(video_path, audio_path):
    from imageio_ffmpeg import get_ffmpeg_exe

    process = subprocess.run(
        [get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(video_path), "-vn", "-ac", "1", "-ar", "16000", str(audio_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        creationflags=hidden_flags(),
        check=False,
    )
    return process.returncode == 0 and audio_path.exists()


def wav_duration(audio_path):
    with wave.open(str(audio_path), "rb") as stream:
        return stream.getnframes() / max(1, stream.getframerate())


def write_csv(rows, path):
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_HEADERS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--cache-dir")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    config = json.loads(Path(args.config).resolve().read_text(encoding="utf-8"))
    candidates = {str(row.get("video_id") or ""): row for row in json.loads(Path(args.candidates).resolve().read_text(encoding="utf-8"))}
    ranking_names = ["account-ranking.json", "keyword-ranking.json", "combined-ranking.json", "ranking.json"]
    ranking_files = [output_dir / name for name in ranking_names if (output_dir / name).exists()]
    rankings = {path: json.loads(path.read_text(encoding="utf-8")) for path in ranking_files}

    unique_rows = {}
    for rows in rankings.values():
        for row in rows:
            video_id = str(row.get("视频ID") or "")
            if video_id:
                unique_rows[video_id] = row

    cache_dir = Path(args.cache_dir).resolve() if args.cache_dir else output_dir / "transcript-cache"
    video_dir = cache_dir / "videos"
    audio_dir = cache_dir / "audio"
    text_dir = cache_dir / "texts"
    for directory in (video_dir, audio_dir, text_dir):
        directory.mkdir(parents=True, exist_ok=True)

    enrichment = config["enrichment"]
    device = enrichment.get("device", "auto")
    compute_type = enrichment.get("compute_type", "auto")
    if device == "auto":
        device = "cpu"
    if compute_type == "auto":
        compute_type = "int8" if device == "cpu" else "float16"
    max_seconds = int(enrichment.get("max_video_minutes", 30)) * 60
    model = None
    transcripts = {}
    failures = []
    reused = 0
    transcribed = 0

    for index, (video_id, row) in enumerate(unique_rows.items(), start=1):
        text_path = text_dir / f"{video_id}.txt"
        transcript = clean(text_path.read_text(encoding="utf-8")) if text_path.exists() else ""
        if transcript:
            reused += 1
        else:
            candidate = candidates.get(video_id, {})
            duration_ms = int(candidate.get("duration_ms") or row.get("视频时长") or 0)
            if duration_ms > max_seconds * 1000:
                failures.append({"video_id": video_id, "reason": "video_too_long"})
                transcripts[video_id] = ""
                continue
            video_path = video_dir / f"{video_id}.mp4"
            audio_path = audio_dir / f"{video_id}.wav"
            print(f"[{index}/{len(unique_rows)}] {video_id}", flush=True)
            if not video_path.exists():
                downloaded, download_method = download_candidate(candidate, video_path)
                if not downloaded:
                    failures.append({"video_id": video_id, "reason": download_method})
                    transcripts[video_id] = ""
                    continue
            if not audio_path.exists() and not extract_audio(video_path, audio_path):
                failures.append({"video_id": video_id, "reason": "audio_extract_failed"})
                transcripts[video_id] = ""
                continue
            if wav_duration(audio_path) > max_seconds:
                failures.append({"video_id": video_id, "reason": "audio_too_long"})
                transcripts[video_id] = ""
                continue
            if model is None:
                from faster_whisper import WhisperModel
                model = WhisperModel(enrichment.get("whisper_model", "base"), device=device, compute_type=compute_type)
            segments, _ = model.transcribe(str(audio_path), language="zh", vad_filter=True, beam_size=1)
            transcript = clean(" ".join(segment.text for segment in segments))
            if transcript:
                text_path.write_text(transcript, encoding="utf-8")
                transcribed += 1
            else:
                failures.append({"video_id": video_id, "reason": "no_speech_detected"})
        transcripts[video_id] = transcript

    for path, rows in rankings.items():
        for row in rows:
            video_id = str(row.get("视频ID") or "")
            transcript = transcripts.get(video_id, "")
            row["视频文案"] = transcript
            notes = [item for item in clean(row.get("数据备注")).split("；") if item and item != "视频转录待补"]
            if not transcript:
                notes.append("视频转录待补")
            row["数据备注"] = "；".join(dict.fromkeys(notes))
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        if path.name != "ranking.json":
            write_csv(rows, path.with_suffix(".csv"))

    (output_dir / "transcripts.json").write_text(json.dumps(transcripts, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {"total": len(unique_rows), "reused": reused, "transcribed": transcribed, "failed": len(failures), "failures": failures}
    (output_dir / "transcription-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(2)


if __name__ == "__main__":
    main()

import argparse
import json

from faster_whisper import WhisperModel
from imageio_ffmpeg import get_ffmpeg_exe
from opencc import OpenCC
from rapidocr_onnxruntime import RapidOCR
from yt_dlp import YoutubeDL


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="base")
    parser.add_argument("--skip-model-download", action="store_true")
    args = parser.parse_args()

    ffmpeg_path = get_ffmpeg_exe()
    OpenCC("t2s")
    RapidOCR()
    YoutubeDL({"quiet": True})
    if not args.skip_model_download:
        WhisperModel(args.model, device="cpu", compute_type="int8")

    print(json.dumps({
        "status": "ready",
        "ffmpeg": ffmpeg_path,
        "whisper_model": args.model,
        "model_downloaded": not args.skip_model_download,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

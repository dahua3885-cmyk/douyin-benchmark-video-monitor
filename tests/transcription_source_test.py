import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "transcribe-ranking.py"
SPEC = importlib.util.spec_from_file_location("transcribe_ranking", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DownloadCandidateTests(unittest.TestCase):
    def test_falls_back_to_video_page_when_media_url_is_missing(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "video.mp4"

            def fake_page_download(url, path):
                self.assertEqual(url, "https://www.douyin.com/video/example")
                path.write_bytes(b"video")
                return True

            with patch.object(MODULE, "download_page", side_effect=fake_page_download):
                success, method = MODULE.download_candidate(
                    {"media_url": "", "video_url": "https://www.douyin.com/video/example"}, target,
                )
            self.assertTrue(success)
            self.assertEqual(method, "video_page")

    def test_falls_back_to_page_when_direct_media_download_expires(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "video.mp4"
            with patch.object(MODULE, "download_direct", return_value=False), patch.object(
                MODULE, "download_page", return_value=True,
            ):
                success, method = MODULE.download_candidate(
                    {"media_url": "https://signed.invalid/video", "video_url": "https://www.douyin.com/video/example"}, target,
                )
            self.assertTrue(success)
            self.assertEqual(method, "video_page")


if __name__ == "__main__":
    unittest.main()

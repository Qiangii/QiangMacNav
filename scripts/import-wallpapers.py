"""Import user-supplied default wallpapers; Pillow and FFmpeg are import-only tools."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "壁纸"
DEST = ROOT / "public/assets/wallpapers"
FILES = [
    ("春至.mp4", "spring.mp4"),
    ("咖啡.jpg", "coffee.jpg"),
    ("卡通.jpg", "cartoon.jpg"),
    ("蜡笔小新.png", "shin-chan.jpg"),
    ("海边.jpg", "seaside.jpg"),
    ("霞光.jpg", "sunset-glow.jpg"),
    ("雪山.jpg", "snow-mountain.jpg"),
]


def describe(path):
    data = path.read_bytes()
    result = {"file": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if path.suffix != ".mp4":
        with Image.open(path) as image:
            result.update(width=image.width, height=image.height, format=image.format)
            image.verify()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify bundled files against the import report")
    parser.add_argument("--inspect", action="store_true", help="Describe available sources without importing")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"), help="FFmpeg executable for poster extraction")
    args = parser.parse_args()
    report_path = DEST / "import-report.json"
    if args.inspect:
        print(json.dumps([describe(SOURCE / source) for source, _ in FILES if (SOURCE / source).is_file()], ensure_ascii=False, indent=2))
        return
    if args.check:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        assert {item["file"] for item in report} == {target for _, target in FILES} | {"spring-poster.jpg"}, "Incomplete import report"
        for item in report:
            actual = describe(DEST / item["file"])
            assert all(actual[key] == value for key, value in item.items() if key in actual), item["file"]
            source = SOURCE / item.get("source", "")
            if source.is_file():
                assert describe(source)["sha256"] == actual["sha256"], str(source)
        print(f"Verified {len(report)} bundled files ({len(FILES)} wallpapers and 1 poster).")
        return
    previous = {item["file"]: item for item in json.loads(report_path.read_text(encoding="utf-8"))} if report_path.is_file() else {}
    report = []
    for source, target in FILES:
        available = SOURCE / source if (SOURCE / source).is_file() else DEST / target
        if not available.is_file():
            parser.error(f"Missing source and bundled file: {source}")
        item = {"source": source, **describe(available), "file": target}
        if available == DEST / target and previous.get(target) != item:
            parser.error(f"Bundled file does not match the previous report: {target}")
        report.append(item)
    poster = DEST / "spring-poster.jpg"
    regenerate_poster = not poster.is_file() or previous.get("spring.mp4", {}).get("sha256") != report[0]["sha256"]
    if regenerate_poster and not args.ffmpeg:
        parser.error("FFmpeg is required to extract spring-poster.jpg; pass --ffmpeg PATH")
    if not regenerate_poster and previous.get(poster.name) != {"derivedFrom": "spring.mp4", **describe(poster)}:
        parser.error("Existing poster does not match the previous report")
    DEST.mkdir(parents=True, exist_ok=True)
    for source, target in FILES:
        if (SOURCE / source).is_file():
            shutil.copyfile(SOURCE / source, DEST / target)
    if regenerate_poster:
        subprocess.run([
            args.ffmpeg, "-hide_banner", "-y", "-i", str(DEST / "spring.mp4"),
            "-frames:v", "1", "-vf", "scale='min(1920,iw)':-2", "-q:v", "2",
            "-update", "1", str(poster),
        ], check=True)
    report.append({"derivedFrom": "spring.mp4", **describe(DEST / "spring-poster.jpg")})
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

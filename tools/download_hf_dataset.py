# -*- coding: utf-8 -*-
import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

DATASET_URLS = {
    "texts": "https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/texts.json",
    "urls": "https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/urls.json",
    "webs": "https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/webs.json",
    "combined_reduced": "https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/combined_reduced.json",
    "combined_full": "https://huggingface.co/datasets/ealvaradob/phishing-dataset/resolve/main/combined_full.json",
}


def main():
    parser = argparse.ArgumentParser(
        description="Download ealvaradob/phishing-dataset JSON files locally."
    )
    parser.add_argument(
        "dataset",
        nargs="?",
        default="texts",
        choices=sorted(DATASET_URLS),
        help="Dataset file to download.",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output JSON path. Defaults to data/<dataset>.json.",
    )
    args = parser.parse_args()

    output_path = Path(args.out) if args.out else DATA_DIR / f"{args.dataset}.json"
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    download(DATASET_URLS[args.dataset], output_path)
    print(f"\nsaved to {output_path}")


def download(url, output_path):
    request = urllib.request.Request(url, headers={"User-Agent": "phishguard-eval/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            total = int(response.headers.get("Content-Length") or 0)
            received = 0
            last_percent = -1

            with output_path.open("wb") as out:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break

                    out.write(chunk)
                    received += len(chunk)

                    if total:
                        percent = min(100, int(received * 100 / total))
                        if percent == 100 or percent >= last_percent + 5:
                            last_percent = percent
                            print(
                                f"\rdownload: {percent:3d}% "
                                f"({format_bytes(received)} / {format_bytes(total)})",
                                end="",
                                flush=True,
                            )
                    else:
                        print(f"\rdownloaded: {format_bytes(received)}", end="", flush=True)

    except urllib.error.HTTPError as error:
        raise SystemExit(f"download failed: HTTP {error.code} {error.reason}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"download failed: {error.reason}") from error
    except KeyboardInterrupt:
        print("\ninterrupted")
        try:
            output_path.unlink(missing_ok=True)
        finally:
            sys.exit(130)


def format_bytes(value):
    value = int(value or 0)
    if value >= 1024 * 1024:
        return f"{value / 1024 / 1024:.1f}MB"
    if value >= 1024:
        return f"{value / 1024:.1f}KB"
    return f"{value}B"


if __name__ == "__main__":
    main()

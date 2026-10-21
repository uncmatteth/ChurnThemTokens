#!/usr/bin/env python3
"""Build the Chrome Web Store ZIP from reviewed browser-only source."""

import argparse
import json
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "browser-relay"
FILES = (
    "manifest.json", "worker.js", "content.js", "protocol.js",
    "popup.html", "popup.js", "popup.css", "icon128.png", "bob128.png",
)


def build(output: Path) -> None:
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    # Chrome uses the key only for a stable unpacked development ID. The store
    # issues its own ID and refuses a submitted manifest containing this field.
    if not manifest.pop("key", None):
        raise ValueError("Development manifest key is missing")
    if manifest.get("icons", {}).get("128") != "icon128.png":
        raise ValueError("Store icon is missing from the manifest")

    output = output.resolve()
    if output.is_relative_to(ROOT):
        raise ValueError("Build output must be outside the source tree")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in (*FILES, "LICENSE"):
            source = ROOT / "LICENSE" if name == "LICENSE" else SOURCE / name
            if not source.is_file() or source.is_symlink():
                raise ValueError(f"Unsafe or missing package source: {name}")
            data = (json.dumps(manifest, indent=2) + "\n").encode() if name == "manifest.json" else source.read_bytes()
            if len(data) > 1_000_000:
                raise ValueError(f"Oversize package source: {name}")
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    build(parser.parse_args().output)

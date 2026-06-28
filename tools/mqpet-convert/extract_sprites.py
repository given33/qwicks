# tools/mqpet-convert/extract_sprites.py
"""Bake every Unity Sprite (.asset under Assets/Sprite/) into a standalone PNG.
Each Sprite YAML has m_Rect (x,y,width,height in pixels) and, under m_RD:,
a `texture:` reference to a Texture2D by guid. We crop that rect from the
source PNG and write sp_<own_guid8>.png so filenames are stable and unique.

Unity texture origin is bottom-left; PIL is top-left, so we flip the y axis."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guid_index import build, EXTRACTED
from PIL import Image

# Resolve to project root (two levels up from this script dir).
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(PROJECT_ROOT, "src", "asset", "img", "mqpet", "sprites")
SPRITE_DIR = os.path.join(EXTRACTED, "Sprite")


def parse_sprite(asset_path):
    text = open(asset_path, encoding="utf-8", errors="ignore").read()
    rect = re.search(
        r"m_Rect:\s*(?:serializedVersion:\s*\d+\s*\n\s*)?x:\s*(-?[\d.]+)\s*\n\s*y:\s*(-?[\d.]+)\s*\n\s*width:\s*(-?[\d.]+)\s*\n\s*height:\s*(-?[\d.]+)",
        text)
    tex = re.search(r"texture:\s*\{fileID:.*?guid:\s*([0-9a-f]{32})", text)
    own_guid = re.search(r"guid:\s*([0-9a-f]{32})",
                         open(asset_path + ".meta", encoding="utf-8", errors="ignore").read())
    if not rect or not tex or not own_guid:
        return None
    return dict(
        tex=tex.group(1),
        own=own_guid.group(1),
        rect=(float(rect.group(1)), float(rect.group(2)),
              float(rect.group(3)), float(rect.group(4))),
    )


def main():
    index = build()
    os.makedirs(OUT_DIR, exist_ok=True)
    baked = 0
    skipped = 0
    manifest = {}
    for fn in sorted(os.listdir(SPRITE_DIR)):
        if not fn.endswith(".asset"):
            continue
        sp = parse_sprite(os.path.join(SPRITE_DIR, fn))
        if not sp:
            skipped += 1
            continue
        src_png = index.get(sp["tex"])
        if not src_png or not src_png.endswith(".png") or not os.path.exists(src_png):
            skipped += 1
            continue
        try:
            img = Image.open(src_png).convert("RGBA")
        except Exception:
            skipped += 1
            continue
        x, y, w, h = sp["rect"]
        iw, ih = img.size
        # Unity origin bottom-left -> PIL top-left.
        left = max(0, int(round(x)))
        upper = max(0, int(round(ih - y - h)))
        right = min(iw, int(round(x + w)))
        lower = min(ih, int(round(ih - y)))
        crop = img.crop((left, upper, right, lower))
        out_name = f"sp_{sp['own'][:8]}.png"
        crop.save(os.path.join(OUT_DIR, out_name))
        manifest[sp["own"]] = out_name
        baked += 1
    open(os.path.join(OUT_DIR, "..", "sprite_manifest.json"), "w", encoding="utf-8").write(
        json.dumps(manifest, ensure_ascii=False))
    print(f"Baked {baked} sprites -> {OUT_DIR} (skipped {skipped})")


if __name__ == "__main__":
    main()

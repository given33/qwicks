# tools/mqpet-convert/convert_anims.py
"""Convert every .anim PPtrCurve timeline into a JSON timeline of sprite refs.
Each .anim has a PPtrCurve block with paired `- time:` / `value: {fileID, guid}`
entries. We resolve each guid to a baked sprite filename via sprite_manifest.json.
Output: src/asset/img/mqpet/anims/<name>.json {name, fps, loop, frames:[{sprite, duration_ms}]}."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guid_index import EXTRACTED

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ANIM_DIR = os.path.join(EXTRACTED, "AnimationClip")
OUT_DIR = os.path.join(PROJECT_ROOT, "src", "asset", "img", "mqpet", "anims")
MANIFEST = os.path.join(PROJECT_ROOT, "src", "asset", "img", "mqpet", "sprite_manifest.json")

# Animations that loop (idle/walk). Everything else is one-shot.
LOOP_ANIMS = {"Pet_Idle", "Stand"} | {
    f"Walk_{d}" for d in
    ["Down", "Left", "LeftDown", "LeftUP", "Right", "RightDown", "RightUP", "UP"]
}


def parse_anim(path):
    text = open(path, encoding="utf-8", errors="ignore").read()
    # Pairs: "- time: <float>\n      value: {fileID: ..., guid: <32hex>, type: N}"
    pairs = re.findall(
        r"- time:\s*([\d.]+)\s*\n\s*value:\s*\{fileID:.*?guid:\s*([0-9a-f]{32})",
        text, re.S)
    if not pairs:
        return None
    times = [float(t) for t, _ in pairs]
    guids = [g for _, g in pairs]
    if len(times) > 1 and times[1] > times[0]:
        fps = round(1.0 / (times[1] - times[0]))
        interval_ms = round(1000.0 / fps)
    else:
        fps, interval_ms = 12, 83
    frames = [{"sprite": g, "duration_ms": interval_ms} for g in guids]
    name = os.path.basename(path)[:-5]
    return dict(name=name, fps=fps, loop=name in LOOP_ANIMS, frames=frames)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    count = 0
    unresolved = 0
    for fn in sorted(os.listdir(ANIM_DIR)):
        if not fn.endswith(".anim"):
            continue
        anim = parse_anim(os.path.join(ANIM_DIR, fn))
        if not anim:
            continue
        resolved = []
        for fr in anim["frames"]:
            png = manifest.get(fr["sprite"])
            if png:
                resolved.append({"sprite": png, "duration_ms": fr["duration_ms"]})
            else:
                unresolved += 1
        if not resolved:
            continue
        anim["frames"] = resolved
        with open(os.path.join(OUT_DIR, anim["name"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(anim, f, ensure_ascii=False)
        count += 1
    print(f"Converted {count} animations -> {OUT_DIR} ({unresolved} unresolved frames dropped)")


if __name__ == "__main__":
    main()

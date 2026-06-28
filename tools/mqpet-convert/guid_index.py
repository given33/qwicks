# tools/mqpet-convert/guid_index.py
"""Build a guid -> absolute asset path map from all .meta files under the
extracted Unity project. Used by both convert_anims and extract_sprites."""
import os
import re

EXTRACTED = r"C:\Users\given\Desktop\QQpet_extracted\ExportedProject\Assets"


def build():
    index = {}
    for dirpath, _dirs, files in os.walk(EXTRACTED):
        for fn in files:
            if not fn.endswith(".meta"):
                continue
            meta_path = os.path.join(dirpath, fn)
            try:
                text = open(meta_path, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            m = re.search(r"guid:\s*([0-9a-f]{32})", text)
            if m:
                index[m.group(1)] = os.path.join(dirpath, fn[:-5])  # strip .meta
    return index


if __name__ == "__main__":
    idx = build()
    print(f"Indexed {len(idx)} guids")

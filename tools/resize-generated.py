"""Resize a raw ComfyUI PNG render into the site's thumb (500w) and full
(1280w) JPEG tiers, matching the widths build-photos.mjs uses for real
photos. Usage: python resize-generated.py <src.png> <thumb-out.jpg> <full-out.jpg>
"""
import sys
import os
from PIL import Image

THUMB_W = 500
FULL_W = 1280

src, thumb_out, full_out = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert("RGB")
w, h = im.size

os.makedirs(os.path.dirname(thumb_out), exist_ok=True)
os.makedirs(os.path.dirname(full_out), exist_ok=True)

thumb = im.resize((THUMB_W, round(h * THUMB_W / w)), Image.LANCZOS)
thumb.save(thumb_out, "JPEG", quality=80, optimize=True, progressive=True)

full = im.resize((FULL_W, round(h * FULL_W / w)), Image.LANCZOS) if w > FULL_W else im
full.save(full_out, "JPEG", quality=88, optimize=True, progressive=True)

print(f"{src} -> {thumb_out}, {full_out}")

"""Finalise a captured PNG for the Chrome Web Store: flatten alpha, resize, save 24-bit PNG.

  python3 scripts/store/postprocess.py in.png [--size 1280x800] [--out out.png] [--bg #0d1017]
"""
import argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('path')
ap.add_argument('--size', help='WxH to resize to (Lanczos)')
ap.add_argument('--out')
ap.add_argument('--bg', default='#0d1017', help='colour behind transparent pixels')
a = ap.parse_args()

img = Image.open(a.path)
if img.mode != 'RGB':
    rgba = img.convert('RGBA')
    flat = Image.new('RGBA', rgba.size, a.bg)
    flat.alpha_composite(rgba)
    img = flat.convert('RGB')
if a.size:
    w, h = (int(v) for v in a.size.lower().split('x'))
    if img.size != (w, h):
        img = img.resize((w, h), Image.LANCZOS)
out = a.out or a.path
img.save(out, 'PNG', optimize=True)
print(f'{out}: {img.size[0]}x{img.size[1]} {img.mode}')

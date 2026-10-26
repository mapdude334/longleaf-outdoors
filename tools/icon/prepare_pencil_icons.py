"""Resize the generated botanical artwork into app icons; does not redraw it.

Usage: python tools/icon/prepare_pencil_icons.py
The source is public/icons/longleaf-pencil-master.png.
"""
from pathlib import Path
from PIL import Image
import sys

root = Path(__file__).resolve().parents[2]
folder = root / 'public' / 'icons'
source = Image.open(folder / (sys.argv[1] if len(sys.argv) > 1 else 'longleaf-pencil-master.png')).convert('RGB')
prefix = sys.argv[2] if len(sys.argv) > 2 else 'pine'
for name, size in [(f'{prefix}-192.png', 192), (f'{prefix}-512.png', 512),
                   (f'{prefix}-touch-180.png', 180), (f'{prefix}-favicon-64.png', 64)]:
    source.resize((size, size), Image.Resampling.LANCZOS).save(folder / name, optimize=True)

# Keep the entire tree within the central safe circle of a maskable icon.
maskable = Image.new('RGB', (512, 512), source.getpixel((0, 0)))
small = source.resize((320, 320), Image.Resampling.LANCZOS)
maskable.paste(small, (96, 96))
maskable.save(folder / f'{prefix}-maskable-512.png', optimize=True)

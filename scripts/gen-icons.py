#!/usr/bin/env python3
"""Generate Mirage PWA icons: a dusk horizon gradient with a bright horizon
line, rounded for maskable use. Requires Pillow: pip3 install Pillow."""

from PIL import Image, ImageDraw


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(size, path):
    # Dusk stops from the app palette.
    top = (0x2E, 0x2A, 0x4F)
    mid = (0xB4, 0x66, 0x7E)
    bottom = (0xE8, 0xA8, 0x7C)
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    horizon_y = int(size * 0.72)
    for y in range(size):
        if y < horizon_y:
            t = y / horizon_y
            c = lerp(top, mid, t)
        else:
            t = (y - horizon_y) / (size - horizon_y)
            c = lerp(mid, bottom, t)
        d.line([(0, y), (size, y)], fill=c)
    # Bright horizon line.
    lw = max(2, size // 96)
    d.rectangle([0, horizon_y - lw // 2, size, horizon_y + lw // 2],
                fill=(255, 245, 235))
    img.save(path)
    print(f'wrote {path}')


if __name__ == '__main__':
    import os
    out = os.path.join(os.path.dirname(__file__), '..', 'icons')
    os.makedirs(out, exist_ok=True)
    make(192, os.path.join(out, 'icon-192.png'))
    make(512, os.path.join(out, 'icon-512.png'))

"""
Generates the Play Console graphics from GameClaw's own brand mark.

The claw is not an image file anywhere in this project - it is drawn, parametrically, by
`gameclaw_app/lib/ui/brand/gc_claw.dart`. The constants below are that painter's, so these assets
are the same mark the app draws rather than a traced or re-imagined copy, and they can be
regenerated at any size if Play changes its requirements.

    python3 -I scripts/play-graphics.py

Outputs into play-assets/. Supersampled 4x and downscaled, because the outline is sampled as a
polygon and PIL will not antialias a filled polygon on its own.
"""
import math
from PIL import Image, ImageDraw, ImageFont

INK = (0x09, 0x09, 0x0B)
ACCENT = (0xCC, 0xFF, 0x2E)
ORIGIN = (-0.35, 1.35)
SLASHES = [
    dict(radius=1.032, frm=-1.181, to=-0.463, weight=0.070),
    dict(radius=1.202, frm=-1.245, to=-0.390, weight=0.086),
    dict(radius=1.372, frm=-1.181, to=-0.463, weight=0.070),
]
STEPS = 28
SS = 4  # supersample factor


def slash_polygon(ox, oy, s, sl):
    """One tapered crescent, sampled along its arc - the Dart painter's _slashPath at t = 1."""
    radius, half = sl["radius"] * s, sl["weight"] * s * 0.5
    span = abs(sl["to"] - sl["frm"])
    outer, inner = [], []
    for i in range(STEPS + 1):
        f = i / STEPS
        angle = sl["frm"] + (sl["to"] - sl["frm"]) * f
        along = min(max((angle - sl["frm"]) / span, 0.0), 1.0)
        w = half * math.sin(math.pi * along)
        dx, dy = math.cos(angle), math.sin(angle)
        outer.append((ox + dx * (radius + w), oy + dy * (radius + w)))
        inner.append((ox + dx * (radius - w), oy + dy * (radius - w)))
    return outer + inner[::-1]


def draw_mark(img, cx, cy, size, colour=ACCENT):
    """Draws the mark with its bounding box centred on (cx, cy), at `size` across."""
    d = ImageDraw.Draw(img)
    ox, oy = ORIGIN[0] * size, ORIGIN[1] * size
    polys = [slash_polygon(ox, oy, size, sl) for sl in SLASHES]
    xs = [p[0] for poly in polys for p in poly]
    ys = [p[1] for poly in polys for p in poly]
    # Centre on the mark's own extent rather than on the nominal square: the origin sits well
    # outside the canvas, so the drawn shape is nowhere near the middle of it.
    dx = cx - (min(xs) + max(xs)) / 2
    dy = cy - (min(ys) + max(ys)) / 2
    for poly in polys:
        d.polygon([(x + dx, y + dy) for x, y in poly], fill=colour)


def icon(path, px=512):
    img = Image.new("RGB", (px * SS, px * SS), INK)
    draw_mark(img, px * SS / 2, px * SS / 2, px * SS * 0.62)
    img.resize((px, px), Image.LANCZOS).save(path)
    return path


def font(size):
    for p in ("/System/Library/Fonts/Helvetica.ttc",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def feature(path, w=1024, h=500):
    img = Image.new("RGB", (w * SS, h * SS), INK)
    draw_mark(img, w * SS * 0.26, h * SS * 0.5, h * SS * 0.60)
    out = img.resize((w, h), Image.LANCZOS)
    d = ImageDraw.Draw(out)
    name, tag = font(86), font(31)
    d.text((int(w * 0.44), int(h * 0.36)), "GameClaw", font=name, fill=ACCENT, anchor="lm")
    d.text((int(w * 0.44), int(h * 0.56)), "Live football scores and stats", font=tag, fill=(0xE4, 0xE4, 0xE7), anchor="lm")
    d.text((int(w * 0.44), int(h * 0.68)), "Move a slip between bookmakers", font=tag, fill=(0xA1, 0xA1, 0xAA), anchor="lm")
    out.save(path)
    return path


if __name__ == "__main__":
    print(icon("play-assets/icon-512.png"))
    print(feature("play-assets/feature-graphic-1024x500.png"))

"""Draws the GameClaw launcher icon.

    python3 tool/make_icon.py android/app/src/main/res out/icon-512.png

Needs Pillow. Run it after changing the brand colours in lib/theme/tokens.dart - the values at the
top of this file are the same three.

Three tapered slashes on the brand accent. Drawn rather than drafted by hand so every size comes
out of the same geometry: an icon redrawn per density is an icon that drifts.

Everything is generated at 4x and downsampled, which is cheaper than antialiasing a polygon by
hand and gives cleaner tapered points than any stroke would.
"""
import math, os, sys
from PIL import Image, ImageDraw

ACCENT = (76, 125, 240, 255)      # GcColors.accent
CANVAS = (11, 11, 13, 255)        # GcColors.canvas
INK = (245, 245, 247, 255)        # GcColors.ink

SS = 4  # supersample


def bezier(p0, p1, p2, t):
    u = 1 - t
    return (u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1])


def slash(draw, p0, p1, p2, width, colour, steps=140):
    """A claw mark: a curve that swells in the middle and comes to a point at both ends."""
    left, right = [], []
    for i in range(steps + 1):
        t = i / steps
        x, y = bezier(p0, p1, p2, t)
        nx, ny = bezier(p0, p1, p2, min(t + 1e-3, 1.0))
        dx, dy = nx - x, ny - y
        length = math.hypot(dx, dy) or 1.0
        # Normal to the direction of travel.
        px, py = -dy / length, dx / length
        # Pointed at both ends, fullest just past the middle - which is how a rake actually tears.
        w = width * (math.sin(math.pi * t) ** 0.62)
        left.append((x + px * w / 2, y + py * w / 2))
        right.append((x - px * w / 2, y - py * w / 2))
    draw.polygon(left + right[::-1], fill=colour)


# Three marks, raked from upper-left to lower-right, the middle one longest.
MARKS = [
    ((0.26, 0.17), (0.60, 0.40), (0.63, 0.80), 0.105),
    ((0.44, 0.13), (0.78, 0.38), (0.80, 0.79), 0.120),
    ((0.62, 0.17), (0.93, 0.44), (0.92, 0.76), 0.098),
]


def claw(size, bg, fg, inset=0.0):
    """`inset` shrinks the mark, for an adaptive icon whose corners may be masked away.

    The mark is drawn on its own layer and then centred on the ink it actually put down, rather
    than on the coordinates it was given. Curves bow, so the drawn mass sits nowhere near the
    middle of its own control points - by eye the first version leaned hard to the right with the
    bottom-left corner empty.
    """
    s = size * SS
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    scale = 1 - inset
    cx = cy = s / 2

    def pt(x, y):
        return (cx + (x - 0.5) * s * scale, cy + (y - 0.5) * s * scale)

    for p0, p1, p2, w in MARKS:
        slash(draw, pt(*p0), pt(*p1), pt(*p2), w * s * scale, fg)

    box = layer.getbbox()
    if box:
        mark = layer.crop(box)
        img = Image.new("RGBA", (s, s), bg)
        img.alpha_composite(mark, ((s - mark.width) // 2, (s - mark.height) // 2))
    else:
        img = Image.new("RGBA", (s, s), bg)

    return img.resize((size, size), Image.LANCZOS)


def rounded(img, radius_ratio=0.22):
    """Legacy launchers get a rounded square; the system does not round it for us."""
    size = img.size[0]
    mask = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1], radius=int(size * SS * radius_ratio), fill=255
    )
    out = img.copy()
    out.putalpha(mask.resize((size, size), Image.LANCZOS))
    return out


res = sys.argv[1]
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# An adaptive foreground is 108dp, of which only the middle 72dp is reliably unmasked.
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

for density, size in LEGACY.items():
    d = f"{res}/mipmap-{density}"
    os.makedirs(d, exist_ok=True)
    rounded(claw(size, ACCENT, INK, inset=0.10)).save(f"{d}/ic_launcher.png")

for density, size in ADAPTIVE.items():
    d = f"{res}/mipmap-{density}"
    os.makedirs(d, exist_ok=True)
    # Transparent background: the background layer is a flat colour the system animates against.
    # Inset hard, so nothing is lost to a circular or squircle mask.
    claw(size, (0, 0, 0, 0), INK, inset=0.34).save(f"{d}/ic_launcher_foreground.png")

# A large round one for the Play listing and anywhere a big icon is wanted.
os.makedirs(f"{res}/../../../../", exist_ok=True)
rounded(claw(512, ACCENT, INK, inset=0.10)).save(sys.argv[2])
print("icons written")

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

# Kept in step with lib/theme/tokens.dart by hand, which is why they drifted: these three were
# left on the old blue long after the theme moved to lime, so the icons on disk were right and
# the script that claims to produce them was not. Re-running it would have put the blue back.
ACCENT = (204, 255, 46, 255)      # GcColors.accent  0xFFCCFF2E
CANVAS = (9, 9, 11, 255)          # GcColors.canvas  0xFF09090B
INK = (244, 244, 245, 255)        # GcColors.ink     0xFFF4F4F5

SS = 4  # supersample


# The same geometry as lib/ui/brand/gc_claw.dart, which is the mark everywhere inside the app.
#
# It used to be a different one - three quadratic beziers - and the icons on disk had moved on
# without it, so this script produced neither the shipped icon's colours nor its shape. An icon
# generator that does not reproduce the icon is worse than no generator, because it looks like
# the source of truth. These numbers are now the Dart ones, and changing either file without the
# other will show up the moment this is run.
ORIGIN = (-0.35, 1.35)

# (radius, from, to, weight) - a circular arc swept between two radii, tapering to a point at
# both ends. The middle slash is longest and heaviest.
SLASHES = [
    (1.032, -1.181, -0.463, 0.070),
    (1.202, -1.245, -0.390, 0.086),
    (1.372, -1.181, -0.463, 0.070),
]


def slash(draw, s, radius, a0, a1, weight, colour, steps=160):
    """One tapered crescent, sampled along its arc."""
    ox, oy = ORIGIN[0] * s, ORIGIN[1] * s
    r = radius * s
    half = weight * s * 0.5
    span = abs(a1 - a0)
    outer, inner = [], []
    for i in range(steps + 1):
        f = i / steps
        angle = a0 + (a1 - a0) * f
        along = min(max((angle - a0) / span, 0.0), 1.0)
        w = half * math.sin(math.pi * along)
        dx, dy = math.cos(angle), math.sin(angle)
        outer.append((ox + dx * (r + w), oy + dy * (r + w)))
        inner.append((ox + dx * (r - w), oy + dy * (r - w)))
    draw.polygon(outer + inner[::-1], fill=colour)


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

    for radius, a0, a1, weight in SLASHES:
        slash(draw, s * scale, radius, a0, a1, weight, fg)

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
    rounded(claw(size, CANVAS, ACCENT, inset=0.10)).save(f"{d}/ic_launcher.png")

for density, size in ADAPTIVE.items():
    d = f"{res}/mipmap-{density}"
    os.makedirs(d, exist_ok=True)
    # Transparent background: the background layer is a flat colour the system animates against.
    # Inset hard, so nothing is lost to a circular or squircle mask.
    claw(size, (0, 0, 0, 0), ACCENT, inset=0.34).save(f"{d}/ic_launcher_foreground.png")

# A large round one for the Play listing and anywhere a big icon is wanted.
os.makedirs(f"{res}/../../../../", exist_ok=True)
rounded(claw(512, CANVAS, ACCENT, inset=0.10)).save(sys.argv[2])
print("icons written")

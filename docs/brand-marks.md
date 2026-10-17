# There are two GameClaw marks

Checked 2026-10-17. This is a decision for you, not a bug to fix, and nothing was changed on
either side because changing either one unilaterally would be picking the answer.

| | Marketing site | Android app |
|---|---|---|
| Where | `components/logo.tsx`, and the generated icons in `app/icon.tsx` | `gameclaw_app/lib/ui/brand/gc_claw.dart`, and `tool/make_icon.py` |
| Shape | three straight round-capped bars | three tapered swept arcs |
| Colour | blue `#2454B3` on white | lime `#CCFF2E` on near-black `#09090B` |
| Reads as | a sound-level or equaliser glyph | a claw |

They share an idea — three strokes — and nothing else. Side by side they do not look like one
brand with two expressions; they look like two products.

## How this happened

The app's mark was deliberately redrawn: the Dart file records that it replaced a sparkle, and
that the launcher icon had been "in somebody else's blue". That blue is the site's `--primary`,
and `tool/make_icon.py` was still carrying `(76, 125, 240)` — near enough the site's
`oklch(0.47 0.16 262)` — long after the app moved to lime. The app changed; the site did not; the
generator was left behind by both.

## What was not done, and why

- **The marketing site was not touched.** `gameclaw.win` and `www.gameclaw.win` are out of scope
  by instruction, and this is a brand decision rather than a defect.
- **The app's mark was not reverted to match the site.** The arc version is the more developed
  drawing, it is what the launcher icon, the tab bar, the Claw screen and the launch animation all
  share, and replacing it with three straight bars would be a downgrade made to settle an
  inconsistency the wrong way round.
- **No third mark was invented.** There is no raster or vector master anywhere in the repository
  for either: both are drawn in code. If a designed logo exists somewhere outside it, it is not
  here, and it should be, because right now the "real" GameClaw logo is whichever file you opened.

## The decision

Pick one shape and one accent, then make the other side follow. The app side costs almost nothing
to change — `_slashes` in `gc_claw.dart`, the three constants in `make_icon.py`, re-run the
generator. The site side is a `LogoMark` component and a CSS variable. Neither is more than an
hour. What cannot keep happening is both drifting on their own.

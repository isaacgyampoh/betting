# GameClaw advertisement

Finished, publishable files are in `deliverables/`. Everything was produced on this Mac with what
ships on macOS — **there is no ffmpeg here** — so the pipeline is Swift against AVFoundation for the
timeline and export, Core Animation and Core Text for the motion graphics, `say` for narration, and
`adb screenrecord` for the footage.

## Deliverables

| File | Spec |
|---|---|
| `gameclaw-master-9x16.mp4` | 1080×1920, 30.70s, H.264 + narration — Reels, TikTok, Shorts |
| `gameclaw-landscape-16x9.mp4` | 1920×1080, 30.70s, H.264 + narration — YouTube, website |
| `gameclaw-teaser-9x16.mp4` | 1080×1920, 13.00s, H.264 + narration |
| `gameclaw-master-9x16.srt` | 7 cues, timed from the narration itself |
| `gameclaw-landscape-16x9.srt` | same cues |
| `gameclaw-cover-16x9.png` | 1280×720 thumbnail |
| `gameclaw-cover-9x16.png` | 1080×1920 cover |
| `voice-over-script.txt` | final narration |

## What is shown

Only implemented, demonstrable features, recorded off a real Pixel running the real release build
against production:

- **Results** — a genuine Champions League card (Como 4-1 Manchester United, Bayern 2-2 Arsenal,
  Real Madrid 4-1 RB Leipzig), plus Liga MX, J1 League, CAF and CONMEBOL fixtures.
- **Match Centre** — Vasco da Gama 1-3 Boca Juniors: full time, half time, the six tabs, recent
  form, and the both-teams-scored and over-2.5 comparisons with their sample sizes.
- **Convert** — the real screen, including its own honest statement that only Football.com and
  SportyBet are connected.

Nothing is simulated or mocked up. No stadium stock footage is used, because none is licensed —
the opening is typographic instead.

## Music

The bed is **original and synthesised** — `build/music.py`, Python standard library only, no
samples and no loops. A D-minor progression at 128 BPM: kick, sub, hats, a plucked arpeggio and a
pad, arranged to the cut rather than looped under it — pad and sub alone under the opening card,
drums in on the logo clear, a riser into the closing card, then drums out so the end can breathe.
Nothing is licensed from anyone, so there is nothing to clear.

It reads the same narration manifest the compositor uses, so the bed ducks to 34% under each
spoken line with 140ms ramps, and the captions, the voice and the ducking all come from one set of
numbers.

Mixed for handsets: an early version put 94% of its energy below 120Hz, which measures fine and
disappears on a phone speaker. The arpeggio and pad sit two octaves up, the kick carries a 1.4kHz
click, and the sub is held back.

Regenerate with:

```
python3 build/music.py build/mix-master.wav 30.70 build/vo/master.tsv
python3 build/music.py build/mix-teaser.wav 13.00 build/vo/teaser.tsv
```

## Rebuilding

```
swiftc -O build/compose.swift -o build/compose
./build/compose deliverables/gameclaw-master-9x16.mp4 1080 1920 master build/vo/master.tsv
./build/compose deliverables/gameclaw-landscape-16x9.mp4 1920 1080 master build/vo/master.tsv
./build/compose deliverables/gameclaw-teaser-9x16.mp4 1080 1920 teaser build/vo/teaser.tsv
./build/cover deliverables/gameclaw-cover-16x9.png 1280 720 raw/results2-check.png
```

The edit — clips, in/out points and captions — is declared in `plan()` at the top of
`compose.swift`. Recordings live in `raw/` and are not tracked; re-record with
`adb shell screenrecord`.

## Two things worth knowing if you change the code

- **CATextLayer draws nothing inside `AVVideoCompositionCoreAnimationTool`** on this system, while
  `CAShapeLayer` in the same tree renders fine. Text is therefore pre-rendered to a `CGImage` and
  set as a layer's `contents`. The first export came out with the claw mark present and every word
  missing.
- **A closing card must hold, not fade.** With a symmetric fade the final frame is the brand card
  dissolving back into app footage. `fade(..., fadeOut: false)` is what holds it.

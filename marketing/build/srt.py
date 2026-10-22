#!/usr/bin/env python3
"""Captions generated from the narration manifest, so they cannot drift from the voice.

    python3 srt.py <manifest.tsv> <out.srt>
"""
import sys, wave
from pathlib import Path

TEXT = [
    "Every match has a story.",
    "GameClaw helps you follow every moment.",
    "Every result, from every competition\nthat matters.",
    "Open a match for form, statistics,\nand the full picture.",
    "And when you want to move a slip between bookmakers,\nGameClaw reads the code and rebuilds it.",
    "Follow the game. Own your matchday.",
]

def ts(s):
    h, r = divmod(s, 3600); m, r = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(r):02d},{int(round((r%1)*1000)):03d}"

rows = [r for r in Path(sys.argv[1]).read_text().splitlines() if r.strip()]
out, n = [], 0
for row in rows:
    at, path = row.split("\t")
    idx = int(Path(path).stem.lstrip("l")) - 1
    with wave.open(path, "rb") as w:
        dur = w.getnframes() / w.getframerate()
    start = float(at)
    body = TEXT[idx]
    # A long line is split into two cues at its own line break, so nothing sits on screen too long.
    parts = body.split("\n") if dur > 4.5 and "\n" in body else [body]
    step = dur / len(parts)
    for k, p in enumerate(parts):
        n += 1
        out.append(f"{n}\n{ts(start + k*step)} --> {ts(start + (k+1)*step)}\n{p}\n")
Path(sys.argv[2]).write_text("\n".join(out))
print(f"  {sys.argv[2]}: {n} cues, last ends {ts(start+dur)}")

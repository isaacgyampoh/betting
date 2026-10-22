#!/usr/bin/env python3
"""Original instrumental bed for the GameClaw advertisement, plus the narration mix.

Written from scratch with the Python standard library — no samples, no loops, no third-party
audio. Nothing on this machine can licence a track and an unlicensed one is not an option, so the
music here is synthesised: kick, sub, hats, a plucked arpeggio and a pad over a D-minor
progression at 128 BPM, arranged to the cut rather than looped blindly under it.

    python3 music.py <out.wav> <duration> <vo-manifest.tsv>

The manifest is the same "start<TAB>file" list the compositor uses, so the music ducks under
exactly the lines the film plays, and the captions, narration and ducking all derive from one set
of numbers.
"""
import array, math, random, struct, subprocess, sys, tempfile, wave
from pathlib import Path

SR = 44100
BPM = 128.0
BEAT = 60.0 / BPM
BAR = BEAT * 4

# D natural minor. Roots low enough to feel like sub, chord tones for the arpeggio.
PROG = [
    ("Dm", 73.42, [73.42, 87.31, 110.00]),   # D  F  A
    ("Bb", 58.27, [58.27, 73.42, 87.31]),    # Bb D  F
    ("F",  87.31, [87.31, 110.00, 130.81]),  # F  A  C
    ("C",  65.41, [65.41, 82.41, 98.00]),    # C  E  G
]

INTRO_END = 3.20      # logo card clears
RISER_FROM = 25.00
OUTRO_FROM = 26.70    # closing card appears


def env(n, attack, decay, sr=SR):
    """Simple AD envelope as a list of gains."""
    a = max(1, int(attack * sr))
    out = []
    for i in range(n):
        if i < a:
            out.append(i / a)
        else:
            out.append(math.exp(-(i - a) / (decay * sr)))
    return out


def add(buf, start, samples, gain=1.0):
    i = int(start * SR)
    n = len(buf)
    for k, v in enumerate(samples):
        j = i + k
        if 0 <= j < n:
            buf[j] += v * gain


def kick(dur=0.30):
    n = int(dur * SR)
    e = env(n, 0.001, 0.075)
    out = []
    ph = 0.0
    for i in range(n):
        t = i / SR
        f = 48 + 72 * math.exp(-t / 0.022)       # pitch drop, the thump
        ph += 2 * math.pi * f / SR
        s = math.sin(ph)
        click = math.sin(2 * math.pi * 1400 * t) * math.exp(-t / 0.004) * 0.5
        s = math.tanh(s * 1.8) * 0.30 + click    # weight plus a click that survives a phone speaker
        out.append(s * e[i])
    return out


def hat(dur=0.045, bright=1.0):
    n = int(dur * SR)
    e = env(n, 0.0005, 0.010)
    prev = 0.0
    out = []
    for i in range(n):
        w = random.uniform(-1, 1)
        hp = w - prev                            # crude high-pass: emphasises the top
        prev = w
        out.append(hp * e[i] * 0.34 * bright)
    return out


def sub(freq, dur):
    n = int(dur * SR)
    e = env(n, 0.006, dur * 0.55)
    out = []
    ph = 0.0
    for i in range(n):
        ph += 2 * math.pi * freq / SR
        s = math.sin(ph) + 0.18 * math.sin(2 * ph)
        out.append(math.tanh(s * 1.2) * 0.085 * e[i])
    return out


def pluck(freq, dur=0.34):
    """Bright decaying tone — carries the melody without sounding like a preset."""
    n = int(dur * SR)
    e = env(n, 0.002, 0.085)
    out = []
    for i in range(n):
        t = i / SR
        s = 0.0
        for h, amp in ((1, 1.0), (2, 0.45), (3, 0.22), (4, 0.10), (6, 0.05)):
            s += amp * math.sin(2 * math.pi * freq * h * t) * math.exp(-t * h * 2.2)
        out.append(s * 0.34 * e[i])
    return out


def pad(freqs, dur):
    """Detuned saws, slow attack. Sits under everything and glues the bars together."""
    n = int(dur * SR)
    a = int(0.55 * SR)
    out = [0.0] * n
    for f in freqs:
        for det in (-0.4, 0.0, 0.5):
            ph = 0.0
            ff = f * 4 * (1 + det / 100.0)       # two octaves up: where a phone can reproduce it
            for i in range(n):
                ph += ff / SR
                ph -= int(ph)
                saw = 2 * ph - 1
                out[i] += saw
    g = 0.034 / max(1, len(freqs))
    for i in range(n):
        if i < a:
            amp = i / a
        elif i > n - a:
            amp = max(0.0, (n - i) / a)
        else:
            amp = 1.0
        out[i] *= g * amp
    return out


def riser(dur):
    n = int(dur * SR)
    out = []
    prev = 0.0
    ph = 0.0
    for i in range(n):
        t = i / SR
        k = t / dur
        w = random.uniform(-1, 1)
        lp = prev + (w - prev) * (0.04 + 0.55 * k)   # opens up as it rises
        prev = lp
        ph += 2 * math.pi * (220 + 900 * k * k) / SR
        tone = math.sin(ph) * 0.25 * k
        out.append((lp * 0.5 + tone) * 0.30 * (k ** 1.6))
    return out


def impact(dur=1.2):
    n = int(dur * SR)
    e = env(n, 0.001, 0.26)
    out = []
    ph = 0.0
    prev = 0.0
    for i in range(n):
        t = i / SR
        f = 55 + 120 * math.exp(-t / 0.05)
        ph += 2 * math.pi * f / SR
        w = random.uniform(-1, 1)
        lp = prev + (w - prev) * 0.25
        prev = lp
        out.append((math.sin(ph) * 0.8 + lp * 0.35) * e[i] * 0.5)
    return out


def build_music(total):
    random.seed(7)                               # deterministic: same render every time
    n = int(total * SR)
    buf = array.array("d", [0.0]) * 0 or [0.0] * n

    bar_i = 0
    t = 0.0
    while t < total:
        name, root, tones = PROG[bar_i % len(PROG)]
        drums = INTRO_END <= t < OUTRO_FROM

        add(buf, t, pad(tones, min(BAR, total - t)))
        add(buf, t, sub(root, min(BAR * 0.98, total - t)), 1.0 if drums else 0.7)

        if drums:
            for b in range(4):
                bt = t + b * BEAT
                if bt < total:
                    add(buf, bt, kick())
                for half in (0.0, 0.5):
                    ht = bt + half * BEAT
                    if ht < total:
                        add(buf, ht, hat(bright=1.0 if half == 0.0 else 0.6))
            # Arpeggio: eighth notes walking the chord, an octave up.
            for s in range(8):
                at = t + s * BEAT / 2
                if at < total:
                    f = tones[s % len(tones)] * 4
                    if s % 4 == 3:
                        f *= 1.5                 # a fifth above, keeps it moving
                    add(buf, at, pluck(f))
        t += BAR
        bar_i += 1

    add(buf, INTRO_END - 0.02, impact(), 0.9)
    add(buf, RISER_FROM, riser(OUTRO_FROM - RISER_FROM))
    add(buf, OUTRO_FROM - 0.02, impact(1.6), 1.0)
    return buf


def read_wav_mono(path):
    with wave.open(str(path), "rb") as w:
        assert w.getsampwidth() == 2
        ch, sr, n = w.getnchannels(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw)
    if ch == 2:
        a = array.array("h", a[0::2])
    data = [v / 32768.0 for v in a]
    if sr != SR:                                  # linear resample; narration is 22.05k
        ratio = SR / sr
        out = [0.0] * int(len(data) * ratio)
        for i in range(len(out)):
            x = i / ratio
            i0 = int(x)
            i1 = min(i0 + 1, len(data) - 1)
            f = x - i0
            out[i] = data[i0] * (1 - f) + data[i1] * f
        data = out
    return data


def main():
    out_path, total, manifest = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    music = build_music(total)
    n = len(music)
    voice = [0.0] * n
    windows = []

    tmp = Path(tempfile.mkdtemp())
    for row in Path(manifest).read_text().splitlines():
        if not row.strip():
            continue
        at_s, src = row.split("\t")
        at = float(at_s)
        wav = tmp / (Path(src).stem + ".wav")
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@44100", "-c", "1", src, str(wav)],
                       check=True, capture_output=True)
        v = read_wav_mono(wav)
        start = int(at * SR)
        for k, s in enumerate(v):
            j = start + k
            if 0 <= j < n:
                voice[j] += s
        windows.append((at, at + len(v) / SR))

    # Duck the bed under each line, with short ramps so it breathes rather than pumps.
    ramp = int(0.14 * SR)
    duck = [1.0] * n
    for a, b in windows:
        i0, i1 = int(a * SR), int(b * SR)
        for j in range(max(0, i0 - ramp), min(n, i1 + ramp)):
            if j < i0:
                k = (i0 - j) / ramp
                duck[j] = min(duck[j], 0.34 + 0.66 * (1 - k) * 0 + 0.66 * k)
            elif j > i1:
                k = (j - i1) / ramp
                duck[j] = min(duck[j], 0.34 + 0.66 * k)
            else:
                duck[j] = 0.34

    peak = max(1e-9, max(abs(v) for v in voice))
    vgain = 0.78 / peak                           # narration sits clearly on top
    mix = [0.0] * n
    for i in range(n):
        mix[i] = math.tanh(music[i] * 0.95 * duck[i] + voice[i] * vgain)

    # Fade the last 0.5s so the file does not stop abruptly.
    tail = int(0.5 * SR)
    for i in range(tail):
        mix[n - tail + i] *= (tail - i) / tail

    frames = array.array("h", [int(max(-1.0, min(1.0, v)) * 32000) for v in mix])
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames.tobytes())
    print(f"wrote {out_path}  {n/SR:.2f}s  peak {max(abs(v) for v in mix):.3f}")


if __name__ == "__main__":
    main()

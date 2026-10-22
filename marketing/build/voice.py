#!/usr/bin/env python3
"""Narration: synthesis plus a broadcast processing chain.

`say` produces a flat, unprocessed 22kHz signal. On its own it sounds like a computer reading a
list. Most of what makes a voice-over sound produced is not the synthesiser — it is the chain
after it, and that is all implementable here with the standard library:

    high-pass -> de-ess -> compressor -> presence EQ -> exciter -> normalise

The exciter matters more than usual: 22kHz sampling means nothing exists above 11kHz, so the top
end is genuinely missing rather than merely dull. Generating harmonics from the upper band puts
some of that air back.

    python3 voice.py <voice> <outdir>          # writes l1..l6.wav processed, prints durations
"""
import array, math, subprocess, sys, tempfile, wave
from pathlib import Path

SR = 44100

LINES = [
    "Every match has a story.",
    "GameClaw helps you follow every moment.",
    "Every result, from every competition that matters.",
    "Open a match for form, statistics, and the full picture.",
    "And when you want to move a slip between bookmakers, "
    "GameClaw reads the code and rebuilds it.",
    "Follow the game. Own your matchday.",
]

# Rate is deliberately below the default. An advertisement read fast sounds like a disclaimer.
RATE = 152


# ---------- biquads (RBJ cookbook) ----------

def biquad(data, b0, b1, b2, a0, a1, a2):
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    x1 = x2 = y1 = y2 = 0.0
    out = [0.0] * len(data)
    for i, x0 in enumerate(data):
        y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out[i] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def highpass(data, f, q=0.707):
    w = 2 * math.pi * f / SR
    c, s = math.cos(w), math.sin(w)
    al = s / (2 * q)
    return biquad(data, (1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al)


def peaking(data, f, gain_db, q=1.0):
    A = 10 ** (gain_db / 40)
    w = 2 * math.pi * f / SR
    c, s = math.cos(w), math.sin(w)
    al = s / (2 * q)
    return biquad(data, 1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A)


def bandpass(data, f, q=2.0):
    w = 2 * math.pi * f / SR
    c, s = math.cos(w), math.sin(w)
    al = s / (2 * q)
    return biquad(data, al, 0.0, -al, 1 + al, -2 * c, 1 - al)


# ---------- dynamics ----------

def compress(data, thresh=0.22, ratio=3.2, attack=0.004, release=0.13, makeup=1.9):
    at = math.exp(-1.0 / (attack * SR))
    rl = math.exp(-1.0 / (release * SR))
    envv = 0.0
    out = [0.0] * len(data)
    for i, x in enumerate(data):
        a = abs(x)
        envv = a + (at if a > envv else rl) * (envv - a)
        if envv > thresh:
            over = envv - thresh
            target = thresh + over / ratio
            g = target / max(envv, 1e-9)
        else:
            g = 1.0
        out[i] = x * g * makeup
    return out


def deess(data, amount=0.55):
    """Duck the sibilant band only when it spikes, rather than dulling the whole take."""
    sib = bandpass(data, 6200, q=1.4)
    at = math.exp(-1.0 / (0.002 * SR))
    rl = math.exp(-1.0 / (0.050 * SR))
    envv = 0.0
    out = [0.0] * len(data)
    for i, x in enumerate(data):
        a = abs(sib[i])
        envv = a + (at if a > envv else rl) * (envv - a)
        red = 1.0 - amount * min(1.0, max(0.0, (envv - 0.06) / 0.14))
        out[i] = x - sib[i] * (1.0 - red)
    return out


def excite(data, amount=0.22):
    """Harmonics from the upper band. 22kHz synthesis has no air of its own to lift."""
    hi = highpass(data, 3500)
    gen = [math.tanh(v * 3.0) * 0.5 for v in hi]
    gen = highpass(gen, 4500)
    return [d + g * amount for d, g in zip(data, gen)]


# ---------- io ----------

def read_wav(path):
    with wave.open(str(path), "rb") as w:
        ch, sr, n = w.getnchannels(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw)
    if ch == 2:
        a = array.array("h", a[0::2])
    d = [v / 32768.0 for v in a]
    if sr != SR:
        ratio = SR / sr
        out = [0.0] * int(len(d) * ratio)
        for i in range(len(out)):
            x = i / ratio
            i0 = int(x)
            i1 = min(i0 + 1, len(d) - 1)
            f = x - i0
            out[i] = d[i0] * (1 - f) + d[i1] * f
        d = out
    return d


def write_wav(path, data):
    frames = array.array("h", [int(max(-1.0, min(1.0, v)) * 32000) for v in data])
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(frames.tobytes())


def process(d):
    d = highpass(d, 95)                 # rumble and plosive thump
    d = deess(d)
    d = peaking(d, 220, -2.2, q=1.0)    # unbox the low-mid
    d = peaking(d, 3100, 3.4, q=0.9)    # presence: where intelligibility lives
    d = compress(d)
    d = excite(d, 0.15)
    d = highpass(d, 80)
    # Soft-limit, then set the level by RMS rather than by peak. Normalising to peak was undoing
    # the compression: the exciter adds a few high transients, the whole take is then scaled down
    # to fit them, and the result measured LESS dense than the raw synthesiser output.
    d = [math.tanh(v * 1.7) * 0.60 for v in d]
    rms = math.sqrt(sum(v * v for v in d) / max(1, len(d)))
    d = [v * (0.17 / max(rms, 1e-9)) for v in d]
    peak = max(abs(v) for v in d)
    if peak > 0.95:
        d = [v * (0.95 / peak) for v in d]
    return d


def main():
    voice, outdir = sys.argv[1], Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    for i, line in enumerate(LINES, start=1):
        aiff = tmp / f"l{i}.aiff"
        wav = tmp / f"l{i}.wav"
        # A short lead-in silence stops the first consonant being clipped by the synthesiser.
        subprocess.run(["say", "-v", voice, "-r", str(RATE), "-o", str(aiff),
                        "[[slnc 120]] " + line], check=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@44100", "-c", "1",
                        str(aiff), str(wav)], check=True, capture_output=True)
        d = process(read_wav(wav))
        out = outdir / f"l{i}.wav"
        write_wav(out, d)
        print(f"{len(d)/SR:.3f}\t{out}")


if __name__ == "__main__":
    main()

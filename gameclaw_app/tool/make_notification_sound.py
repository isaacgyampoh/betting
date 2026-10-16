"""Generates GameClaw's notification tone.

    python3 tool/make_notification_sound.py android/app/src/main/res/raw/gameclaw_alert.wav

Synthesised from scratch rather than sampled, so there is no licence question: every sample is
computed here. Nothing is taken from a club anthem, a stadium recording or any commercial sound.

The shape is two short notes a perfect fifth apart - a rising call, which is what a whistle or a
terrace chant does and what the ear reads as "something has happened" rather than "something is
wrong". Kept under a second: a notification that outlasts the glance at the screen is a
notification people turn off.
"""
import math
import struct
import sys
import wave

RATE = 48_000


def tone(freq, seconds, *, attack=0.006, release=0.18, harmonic=0.22):
    """One note, with a soft attack and a long tail.

    A pure sine reads as an alarm clock. A touch of second harmonic gives it a little body, and
    the slow release is what makes it sound like a chime rather than a beep.
    """
    out = []
    total = int(RATE * seconds)
    for i in range(total):
        t = i / RATE
        # Exponential decay, so it fades the way a struck object does.
        env = math.exp(-t / release)
        if t < attack:
            env *= t / attack
        sample = math.sin(2 * math.pi * freq * t)
        sample += harmonic * math.sin(4 * math.pi * freq * t)
        out.append(env * sample / (1 + harmonic))
    return out


def main(path):
    # C6 then G6: a rising fifth. Bright enough to carry out of a pocket without being shrill.
    first = tone(1046.50, 0.34)
    second = tone(1567.98, 0.46)

    # The second note starts before the first has died, so they overlap rather than stutter.
    overlap = int(RATE * 0.13)
    length = len(first) + len(second) - overlap
    mixed = [0.0] * length
    for i, v in enumerate(first):
        mixed[i] += v
    for i, v in enumerate(second):
        mixed[len(first) - overlap + i] += v * 0.92

    peak = max(abs(v) for v in mixed) or 1.0
    # -3 dBFS: loud enough to hear, with room so no device clips it.
    gain = 0.707 / peak

    with wave.open(path, "w") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, v * gain)) * 32767)) for v in mixed))

    print(f"wrote {path}: {length / RATE:.2f}s, {length} frames at {RATE} Hz")


if __name__ == "__main__":
    main(sys.argv[1])

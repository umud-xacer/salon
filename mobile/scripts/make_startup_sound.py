"""Chronix ochilish ovozi (assets/sounds/startup.wav) — sintez, tashqi fayl ishlatilmaydi.

Vaqt AnimatedSplash bilan mos:
  0.00–0.90 s  soat strelkalari aylanadi  -> 4 ta ko'tariluvchi qo'ng'iroqcha (E5, G#5, B5, E6)
  0.90 s       belgi o'z joyiga, yozuv chiqadi -> iliq akkord (E4 B4 E5 G#5) va yengil "yaltirash"
  ~2.4 s       ovoz so'nadi (splash 2.7 s da yopiladi)
Qayta yaratish: python scripts/make_startup_sound.py
"""
import math
import struct
import wave
from pathlib import Path

SR = 44100
DURATION = 2.4
N = int(SR * DURATION)
OUT = Path(__file__).resolve().parents[1] / "assets" / "sounds" / "startup.wav"

buf = [0.0] * N


def bell(start: float, freq: float, amp: float, decay: float) -> None:
    """Qo'ng'iroqsimon nota: bir nechta obertonlar, tez hujum, eksponensial so'nish."""
    partials = [(1.0, 1.0, 1.0), (2.0, 0.35, 1.6), (3.01, 0.18, 2.4), (4.2, 0.08, 3.5)]
    s0 = int(start * SR)
    length = min(N - s0, int(decay * 6 * SR))
    for i in range(length):
        tt = i / SR
        attack = min(1.0, tt / 0.006)
        v = 0.0
        for mult, a, d in partials:
            v += a * math.sin(2 * math.pi * freq * mult * tt) * math.exp(-tt * d / decay)
        buf[s0 + i] += amp * attack * v


# 1) Strelkalar aylanayotganda: ko'tariluvchi arpedjio
for k, f in enumerate([659.25, 830.61, 987.77, 1318.51]):
    bell(0.10 + k * 0.18, f, 0.20 + k * 0.02, 0.32)

# 2) Belgi joyiga tushganda: iliq akkord + yuqori "yaltirash"
for f, a in [(329.63, 0.30), (493.88, 0.22), (659.25, 0.22), (830.61, 0.14)]:
    bell(0.90, f, a, 1.1)
bell(0.93, 2637.02, 0.05, 0.6)

# Yengil xona aksi (bir nechta qaytuvchi kechikish)
for delay, gain in [(0.047, 0.22), (0.083, 0.16), (0.131, 0.11)]:
    d = int(delay * SR)
    for i in range(N - 1, d - 1, -1):
        buf[i] += buf[i - d] * gain

# Oxirida silliq so'nish, -3 dBFS ga normallash
fade = int(0.35 * SR)
for i in range(fade):
    buf[N - fade + i] *= 1 - i / fade
peak = max(abs(x) for x in buf) or 1.0
scale = 0.707 / peak

OUT.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(OUT), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, x * scale)) * 32767)) for x in buf))
print(f"{OUT} — {DURATION}s, {OUT.stat().st_size // 1024} KB")

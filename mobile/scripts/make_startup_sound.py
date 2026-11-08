"""Chronix ochilish ovozlari — sintez (tashqi fayl ishlatilmaydi). Uch xil:

  startup_warm.wav     "Iliq"     — yumshoq elektro-pianino (asosiy)
  startup_soft.wav     "Yengil"   — yog'och marimba
  startup_crystal.wav  "Kristall" — qo'ng'iroqchalar

Vaqt AnimatedSplash bilan mos: 0–0.9 s strelkalar aylanadi (ko'tariluvchi 3 nota),
0.9 s belgi joyiga tushadi (akkord), ~2.6 s ovoz so'nadi (splash 2.7 s da yopiladi).

2026-11-09: oldingi versiyada alohida aks-sado (47/83/131 ms) bor edi — telefonda "tutilib" eshitilardi.
Endi silliq xona akustikasi (Freeverb: 8 ta parallel comb + 4 ta allpass), keskin baland obertonlar yo'q.
Qayta yaratish: python scripts/make_startup_sound.py
"""
import math
import struct
import wave
from pathlib import Path

SR = 32000
DURATION = 2.6
N = int(SR * DURATION)
OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "sounds"


def note(buf, start, freq, amp, decay, partials, attack=0.008, detune=0.0):
    """Bitta nota: obertonlar (karra, nisbiy balandlik, so'nish tezligi), yumshoq hujum."""
    s0 = int(start * SR)
    length = min(N - s0, int(decay * 7 * SR))
    for i in range(length):
        tt = i / SR
        env = min(1.0, tt / attack) if attack > 0 else 1.0
        env *= env * (3 - 2 * env)                       # smoothstep: hujumda "chiq" yo'q
        v = 0.0
        for mult, a, d in partials:
            f = freq * mult
            v += a * math.exp(-tt * d / decay) * (
                math.sin(2 * math.pi * f * tt) + (0.6 * math.sin(2 * math.pi * f * (1 + detune) * tt) if detune else 0.0))
        buf[s0 + i] += amp * env * v


def freeverb(dry, room=0.78, damp=0.35, wet=0.22):
    """Silliq xona akustikasi. Alohida qaytariqlar emas — zich, bir tekis so'nuvchi dum."""
    k = SR / 44100
    combs = [int(x * k) for x in (1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)]
    allpasses = [int(x * k) for x in (556, 441, 341, 225)]
    out = [0.0] * N
    for d in combs:
        line = [0.0] * d
        idx = 0
        store = 0.0
        for i in range(N):
            y = line[idx]
            store = y * (1 - damp) + store * damp
            line[idx] = dry[i] * 0.015 + store * room
            idx = (idx + 1) % d
            out[i] += y
    for d in allpasses:
        line = [0.0] * d
        idx = 0
        for i in range(N):
            b = line[idx]
            x = out[i]
            out[i] = -x + b
            line[idx] = x + b * 0.5
            idx = (idx + 1) % d
    return [dry[i] + out[i] * wet * 3 for i in range(N)]


def finish(buf, name):
    buf = freeverb(buf)
    fade_in = int(0.004 * SR)
    for i in range(fade_in):
        buf[i] *= i / fade_in
    fade = int(0.45 * SR)
    for i in range(fade):
        x = 1 - i / fade
        buf[N - fade + i] *= x * x
    peak = max(abs(x) for x in buf) or 1.0
    scale = 0.70 / peak
    path = OUT_DIR / name
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, x * scale)) * 32767)) for x in buf))
    print(f"{path.name}: {DURATION}s, {path.stat().st_size // 1024} KB")


# ─── Iliq: elektro-pianino, F major add9 ────────────────────────────────────
EPIANO = [(1.0, 1.0, 1.0), (2.0, 0.22, 1.9), (3.0, 0.06, 3.2), (7.0, 0.025, 25.0)]   # 7x — qisqa "tin" hujumi
warm = [0.0] * N
for k, f in enumerate([349.23, 440.00, 523.25]):                 # F4 A4 C5
    note(warm, 0.06 + k * 0.22, f, 0.30, 0.85, EPIANO, attack=0.012, detune=0.0012)
for f, a in [(174.61, 0.30), (261.63, 0.24), (440.00, 0.20), (659.25, 0.13), (783.99, 0.09)]:   # F3 C4 A4 E5 G5
    note(warm, 0.90, f, a, 1.6, EPIANO, attack=0.03, detune=0.0012)
note(warm, 0.90, 174.61, 0.10, 1.4, [(1.0, 1.0, 1.0), (2.0, 0.3, 1.0)], attack=0.35)   # yumshoq "pad"
finish(warm, "startup_warm.wav")

# ─── Yengil: marimba, G major pentatonika ───────────────────────────────────
MARIMBA = [(1.0, 1.0, 1.0), (3.93, 0.22, 3.5), (9.2, 0.04, 9.0)]
soft = [0.0] * N
for k, f in enumerate([587.33, 659.25, 783.99]):                 # D5 E5 G5
    note(soft, 0.06 + k * 0.22, f, 0.32, 0.45, MARIMBA, attack=0.003)
for f, a in [(196.00, 0.30), (392.00, 0.24), (493.88, 0.20), (587.33, 0.16), (987.77, 0.06)]:  # G3 G4 B4 D5 B5
    note(soft, 0.90, f, a, 0.75, MARIMBA, attack=0.003)
note(soft, 1.25, 783.99, 0.10, 0.6, MARIMBA, attack=0.003)       # yengil javob notasi
finish(soft, "startup_soft.wav")

# ─── Kristall: qo'ng'iroqchalar (E major), endi aks-sadosiz ─────────────────
BELL = [(1.0, 1.0, 1.0), (2.0, 0.30, 1.6), (3.01, 0.12, 2.4)]
crystal = [0.0] * N
for k, f in enumerate([659.25, 830.61, 987.77]):                 # E5 G#5 B5
    note(crystal, 0.06 + k * 0.22, f, 0.22, 0.4, BELL, attack=0.004)
for f, a in [(329.63, 0.28), (493.88, 0.20), (659.25, 0.18), (830.61, 0.11)]:
    note(crystal, 0.90, f, a, 1.1, BELL, attack=0.006)
finish(crystal, "startup_crystal.wav")

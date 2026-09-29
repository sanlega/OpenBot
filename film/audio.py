#!/usr/bin/env python3
"""OpenBot film: synthesize the 120 BPM track + UI transients, then measure them.

Outputs (next to this file, in ./build):
  track.wav   48 kHz stereo master, exactly 32.0 s, loop-safe (tail folded onto head)
  cues.json   beat grid + every UI cue with intended and *measured* peak time
"""
import json, os
import numpy as np
from scipy import signal
from scipy.io import wavfile
import librosa

SR = 48000
K = float(os.environ.get('FILM_SLOW', '1.5'))   # global slow-down vs the 120 BPM design grid
BPM = 120.0 / K
BEAT = 60.0 / BPM          # 0.5 s
BAR = 4 * BEAT             # 2.0 s
DUR = 16 * BAR             # 32.0 s
TAIL = 3.0                 # rendered past the end, folded onto the start for a seamless loop
N = int((DUR + TAIL) * SR)
rng = np.random.default_rng(7)
OUT = os.path.join(os.path.dirname(__file__), "build")
os.makedirs(OUT, exist_ok=True)


def B(bar, beat=1.0):
    """Time in seconds of bar.beat (1-indexed, fractional beats allowed)."""
    return (bar - 1) * BAR + (beat - 1) * BEAT


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def t_arr(n):
    return np.arange(n) / SR


def env_exp(n, attack=0.002, decay=0.2):
    t = t_arr(n)
    a = np.minimum(t / max(attack, 1e-4), 1.0)
    return a * np.exp(-t / decay)


def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i < 0:
        sig = sig[-i:]
        i = 0
    if i >= N:
        return
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    l = np.cos((pan + 1) * np.pi / 4)
    r = np.sin((pan + 1) * np.pi / 4)
    buf[0, i:j] += s * l
    buf[1, i:j] += s * r


# ---------------------------------------------------------------- voices
def kick(vel=1.0):
    n = int(0.42 * SR)
    t = t_arr(n)
    f = 45 + 95 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * env_exp(n, 0.001, 0.13)
    click = rng.standard_normal(n) * np.exp(-t / 0.004) * 0.15
    return (s + click) * vel


def hat(vel=1.0, open_=False):
    n = int((0.22 if open_ else 0.06) * SR)
    x = rng.standard_normal(n)
    b, a = signal.butter(2, 7000 / (SR / 2), "high")
    x = signal.lfilter(b, a, x)
    return x * env_exp(n, 0.0005, 0.09 if open_ else 0.017) * vel * 0.5


def rim(vel=1.0):
    n = int(0.12 * SR)
    t = t_arr(n)
    s = np.sin(2 * np.pi * 1700 * t) * np.exp(-t / 0.012) + 0.5 * np.sin(2 * np.pi * 950 * t) * np.exp(-t / 0.02)
    x = rng.standard_normal(n) * np.exp(-t / 0.01) * 0.3
    return (s + x) * vel * 0.5


def sub(freq, dur, vel=1.0):
    n = int(dur * SR)
    t = t_arr(n)
    s = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(4 * np.pi * freq * t)
    e = np.minimum(t / 0.01, 1) * np.minimum((dur - t) / 0.05, 1) * np.exp(-t / (dur * 0.9))
    return s * e * vel * 0.6


def pluck(freq, dur=0.35, bright=0.5, vel=1.0):
    n = int(dur * SR)
    t = t_arr(n)
    s = signal.sawtooth(2 * np.pi * freq * t) * 0.6 + np.sin(2 * np.pi * freq * t) * 0.6
    cutoff = np.clip(freq * (2 + 10 * bright), 200, 12000)
    b, a = signal.butter(2, cutoff / (SR / 2))
    s = signal.lfilter(b, a, s)
    return s * env_exp(n, 0.0015, dur * 0.3) * vel * 0.5


def bell(freq, dur=0.5, vel=1.0):
    n = int(dur * SR)
    t = t_arr(n)
    s = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.76 * t) + 0.2 * np.sin(2 * np.pi * freq * 5.4 * t)
    return s * env_exp(n, 0.001, dur * 0.28) * vel * 0.4


def noise_sweep(dur, f0, f1, vel=1.0, rising=True):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    out = np.zeros(n)
    blk = 512
    zi = None
    for i in range(0, n, blk):
        p = i / n
        fc = f0 * (f1 / f0) ** p
        b, a = signal.butter(2, min(fc, 20000) / (SR / 2), "low")
        seg = x[i : i + blk]
        if zi is None:
            zi = signal.lfilter_zi(b, a) * 0
        seg, zi = signal.lfilter(b, a, seg, zi=zi)
        out[i : i + blk] = seg
    t = t_arr(n)
    shape = (t / dur) ** 1.5 if rising else (1 - t / dur) ** 1.5
    return out * shape * vel * 0.9


def pad(chord, dur, vel=1.0):
    n = int(dur * SR)
    t = t_arr(n)
    s = np.zeros(n)
    for m in chord:
        for det in (-0.07, 0.0, 0.08):
            f = midi(m) * 2 ** (det / 12)
            s += signal.sawtooth(2 * np.pi * f * t)
    b, a = signal.butter(2, 1400 / (SR / 2))
    s = signal.lfilter(b, a, s) / (len(chord) * 3)
    e = np.minimum(t / 0.6, 1) * np.minimum((dur - t) / 0.6, 1)
    return s * e * vel * 0.5


def reverb(x, wet=0.25, length=1.6):
    n = int(length * SR)
    t = t_arr(n)
    ir = rng.standard_normal((2, n)) * np.exp(-t / (length * 0.22))
    b, a = signal.butter(1, 5000 / (SR / 2))
    ir = signal.lfilter(b, a, ir, axis=1)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True)) + 1e-9
    out = np.zeros_like(x)
    for c in range(2):
        out[c] = signal.fftconvolve(x[c], ir[c])[: x.shape[1]]
    return out * wet


# ---------------------------------------------------------------- cues (single source of truth)
# name -> (time, kind).  The film reads the *measured* time of each from cues.json.
CUES = [
    ("open", B(1, 1), "thump"), ("wordmark", B(1, 2), "tick"), ("tagline", B(1, 3), "tick"), ("stretch", B(1, 4), "whoosh"),
    ("window", B(2, 1), "pluck"), ("focus", B(2, 2), "click"),
    ("key1", B(2, 3), "key"), ("key2", B(2, 4), "key"), ("key3", B(2, 4.5), "key"),
    ("send", B(3, 1), "send"), ("think", B(3, 2), "blip"), ("plan", B(3, 3), "blip"), ("delegating", B(3, 4), "tick"),
    ("spawn", B(4, 1), "spawn"), ("chip1", B(4, 2), "chip"), ("chip2", B(4, 3), "chip"), ("chip3", B(4, 4), "chip"),
    ("team", B(5, 1), "swell"), ("lane1", B(5, 2), "tick"), ("lane2", B(5, 3), "tick"), ("lane3", B(5, 4), "tick"),
    ("expand", B(6, 1), "swell"), ("tray", B(6, 2), "tick"), ("tool", B(6, 3), "ping"), ("toComputer", B(6, 4), "whoosh"),
    ("computer", B(7, 1), "pluck"), ("bclick1", B(7, 2), "click"), ("bclick2", B(7, 3), "click"),
    ("bclick3", B(7, 4), "click"), ("bclick4", B(7, 4.5), "click"),
    ("halt", B(8, 1), "drop"), ("approvalCard", B(8, 2), "alert"), ("approve", B(8, 4), "approve"),
    ("resume", B(9, 1), "swell"), ("done1", B(9, 2), "done"), ("done2", B(9, 3), "done"), ("done3", B(9, 4), "done"),
    ("converge", B(10, 1), "whoosh"), ("stack", B(10, 2), "pluck"), ("result", B(10, 3), "done"),
    ("row1", B(10, 4), "key"), ("row2", B(10, 4.25), "key"), ("row3", B(10, 4.5), "key"), ("row4", B(10, 4.75), "key"),
    ("activity", B(11, 1), "whoosh"), ("waiting", B(11, 2), "tick"),
    ("res1", B(11, 3), "tick"), ("res2", B(11, 3.5), "tick"), ("res3", B(11, 4), "tick"), ("held", B(11, 4.5), "thud"),
    ("routines", B(12, 1), "whoosh"), ("dryclick", B(12, 2), "click"),
    ("step1", B(12, 2.5), "tick"), ("step2", B(12, 3), "tick"), ("step3", B(12, 3.5), "tick"), ("dryDone", B(12, 4), "done"),
    ("live", B(13, 1), "toggle"), ("shrink", B(13, 2), "whoosh"), ("notify", B(13, 3), "notify"), ("tap", B(13, 4), "click"),
    ("lock", B(14, 1), "lock"), ("layers", B(14, 2), "tick"), ("w2", B(14, 3), "tick"), ("w3", B(14, 4), "tick"),
    ("w4", B(15, 1), "lock"), ("collapse", B(15, 3), "whoosh"), ("iconIn", B(15, 4), "thump"),
    ("headline", B(16, 1), "chord"), ("sub", B(16, 2), "tick"), ("url", B(16, 3), "tick"), ("close", B(16, 4), "thump"),
]


def padsum(a, b):
    n = max(len(a), len(b))
    o = np.zeros(n)
    o[: len(a)] += a
    o[: len(b)] += b
    return o


def voice(kind, t):
    """Return list of (signal, gain, pan) for a UI cue of `kind`, tuned to D minor."""
    D5, F5, A5, C6, D6, A4, E5 = midi(74), midi(77), midi(81), midi(84), midi(86), midi(69), midi(76)
    if kind == "thump":
        return [(kick(0.9), 0.9, 0)]
    if kind == "tick":
        return [(pluck(midi(86), 0.09, 0.9, 0.7), 0.5, 0.2)]
    if kind == "key":
        return [(padsum(hat(1.2), rim(0.5)), 0.5, rng.uniform(-0.3, 0.3))]
    if kind == "click":
        return [(rim(1.1), 0.7, 0), (pluck(midi(93), 0.05, 1.0, 0.5), 0.3, 0)]
    if kind == "send":
        return [(pluck(D5, 0.4, 0.8, 1.0), 0.8, 0), (pluck(A5, 0.5, 0.7, 0.8), 0.5, 0), (kick(0.5), 0.5, 0)]
    if kind == "blip":
        return [(pluck(A4, 0.22, 0.4, 0.8), 0.6, -0.2)]
    if kind == "spawn":
        return [(pluck(D5, 0.3, 0.9, 1.0), 0.6, -0.4), (pluck(F5, 0.3, 0.9, 1.0), 0.6, 0), (pluck(A5, 0.3, 0.9, 1.0), 0.6, 0.4), (kick(0.7), 0.6, 0)]
    if kind == "chip":
        return [(pluck(A5, 0.16, 0.8, 0.8), 0.5, 0.1), (hat(0.8), 0.3, 0)]
    if kind == "swell":
        return [(noise_sweep(0.5, 300, 6000, 0.5, True), 0.35, 0)]
    if kind == "ping":
        return [(bell(midi(88), 0.7, 0.9), 0.6, 0.2)]
    if kind == "whoosh":
        return [(noise_sweep(0.45, 500, 9000, 0.5, True), 0.3, 0)]
    if kind == "pluck":
        return [(pluck(D5, 0.45, 0.7, 1.0), 0.7, 0), (pluck(A4, 0.45, 0.5, 0.7), 0.5, 0)]
    if kind == "drop":
        return [(noise_sweep(0.5, 8000, 300, 0.6, False), 0.4, 0), (sub(midi(38), 1.4, 0.8), 0.6, 0)]
    if kind == "alert":
        return [(bell(midi(79), 0.9, 0.9), 0.55, 0), (bell(midi(82), 0.9, 0.6), 0.35, 0.1)]
    if kind == "approve":
        return [(pluck(D5, 0.3, 0.9, 1.0), 0.75, 0), (pluck(A5, 0.4, 0.9, 1.0), 0.75, 0), (kick(0.9), 0.8, 0)]
    if kind == "done":
        return [(bell(midi(81), 0.6, 0.9), 0.55, 0), (bell(midi(88), 0.6, 0.5), 0.3, 0.2)]
    if kind == "thud":
        return [(sub(midi(43), 0.35, 0.8), 0.6, 0)]
    if kind == "toggle":
        return [(rim(1.0), 0.6, 0), (pluck(midi(91), 0.16, 0.9, 0.9), 0.6, 0), (kick(0.6), 0.5, 0)]
    if kind == "notify":
        return [(bell(midi(88), 0.7, 0.9), 0.6, 0.3), (bell(midi(93), 0.7, 0.7), 0.4, 0.3)]
    if kind == "lock":
        return [(rim(0.9), 0.6, 0), (sub(midi(38), 0.25, 0.7), 0.5, 0)]
    if kind == "chord":
        return [(pad([50, 57, 62, 65], 2.0, 1.0), 0.6, 0), (kick(0.8), 0.7, 0)]
    return []


# ---------------------------------------------------------------- arrangement
def build():
    music = np.zeros((2, N))
    ui = np.zeros((2, N))
    # chord per bar (D minor world): Dm | Bb | Gm | A  repeating; roots for the sub bass
    roots = [38, 34, 43, 45]
    chords = [[50, 57, 62, 65], [46, 53, 58, 62], [43, 50, 55, 58], [45, 52, 57, 61]]

    for bar in range(1, 17):
        r, ch = roots[(bar - 1) % 4], chords[(bar - 1) % 4]
        # -- which layers are on?  (drum-machine style arrangement map)
        kick_on = True
        vel_k = 0.55 if bar <= 2 else 0.85
        if bar == 8:
            vel_k = 0.7
        hats = bar >= 2 and bar not in (8, 16)
        ghost = bar in (5, 6, 9, 10, 13)
        rims = bar in (5, 6, 7, 9, 10, 12, 13) or (bar in (3, 4))
        bass = bar >= 3 and bar not in (8, 14, 15, 16)
        arp = bar in (7, 9, 10)
        padon = bar in (1, 2, 8, 13, 14, 15, 16) or bar in (11,)
        if bar == 15:
            kick_on = False   # breath before the collapse; thump at 15.4 comes from a cue
        if bar == 16:
            kick_on = False
        for beat in range(4):
            t = B(bar, beat + 1)
            if kick_on:
                place(music, kick(), t, vel_k)
            if bar == 15 and beat < 2:
                place(music, kick(), t, 0.5)
        if hats:
            for e in range(8):
                t = B(bar, 1) + e * BEAT / 2
                if e % 2 == 1:
                    place(music, hat(1.0, open_=(e == 7 and bar in (4, 6, 12))), t, 0.4, 0.25)
                elif ghost:
                    place(music, hat(0.5), t, 0.18, -0.25)
            if ghost:
                for e in range(16):
                    if e % 2 == 1 and rng.random() < 0.6:
                        place(music, hat(0.4), B(bar, 1) + e * BEAT / 4, 0.14, 0.1)
        if rims:
            for beat in (1, 3):
                place(music, rim(), B(bar, 1) + beat * BEAT, 0.28, 0.15)
        if bass:
            pat = [0, 0.5, 1.5, 2.0, 3.0, 3.5]
            for p in pat:
                place(music, sub(midi(r), 0.22 if p % 1 else 0.4), B(bar, 1) + p * BEAT, 0.55)
        if arp:
            notes = [ch[1], ch[2], ch[3], ch[2] + 12]
            for s in range(16):
                m = notes[s % 4] + (12 if (s // 4) % 2 else 0)
                place(music, pluck(midi(m + 12), 0.14, 0.55 + 0.3 * (s % 4 == 0), 0.8), B(bar, 1) + s * BEAT / 4, 0.16, -0.3 + 0.6 * ((s % 4) / 3))
        if padon:
            v = {1: 0.45, 2: 0.55, 8: 0.35, 11: 0.35, 13: 0.5, 14: 0.7, 15: 0.6, 16: 0.7}.get(bar, 0.4)
            place(music, pad(ch, BAR + 0.3), B(bar, 1) - 0.05, v * 0.55, 0)
        if bar == 8:   # tension: only kick + sub drone + thin high pad
            place(music, sub(midi(26), BAR, 0.8), B(8, 1), 0.5)
    # slight low-pass "ducking" feel in bar 8 is done by simply removing layers (above)

    for name, t, kind in CUES:
        for sig, g, pan in voice(kind, t):
            # risers are placed so their *peak* (the end of the sweep) lands on the cue
            start = t - len(sig) / SR + 0.004 if kind in ("swell", "whoosh") else t
            place(ui, sig, start, g * 0.9, pan)

    mix = music + ui * 1.0
    mix = mix + reverb(ui, 0.35) + reverb(music * 0.4, 0.18, 2.2)
    # fold the tail onto the head -> seamless loop
    head = int(DUR * SR)
    tail = mix[:, head:]
    mix = mix[:, :head]
    mix[:, : tail.shape[1]] += tail
    # gentle master: DC high-pass, soft clip, normalize to -1 dBFS peak
    b, a = signal.butter(2, 25 / (SR / 2), "high")
    mix = signal.lfilter(b, a, mix, axis=1)
    mix = np.tanh(mix * 1.3) / np.tanh(1.3)
    mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))
    return mix, ui


def measure(mix, ui):
    """Measure the real transient peak of every cue in the *mix* (not the intended time)."""
    mono = mix.mean(axis=0)
    hop = 64
    onset = librosa.onset.onset_strength(y=mono, sr=SR, hop_length=hop, aggregate=np.median)
    tframes = librosa.frames_to_time(np.arange(len(onset)), sr=SR, hop_length=hop)
    res = []
    for name, t, kind in CUES:
        # peak of |ui stem| in the first 60 ms after the intended time = the audible transient
        i0, i1 = int(t * SR), int((t + 0.06) * SR)
        seg = np.abs(ui[:, i0:i1]).max(axis=0) if i1 <= ui.shape[1] else np.zeros(1)
        peak_t = t + float(np.argmax(seg)) / SR if seg.max() > 0 else t
        w = (tframes > t - 0.03) & (tframes < t + 0.06)
        onset_t = float(tframes[w][np.argmax(onset[w])]) if w.any() else t
        res.append({"name": name, "kind": kind, "intended": round(t, 5), "peak": round(peak_t, 5), "onset": round(onset_t, 5)})
    return res


def main():
    mix, ui = build()
    pcm = (mix.T * 32767).astype(np.int16)
    wavfile.write(os.path.join(OUT, "track.wav"), SR, pcm)
    mono = mix.mean(axis=0)
    tempo, beats = librosa.beat.beat_track(y=mono, sr=SR, start_bpm=120, tightness=400, units="time")
    cues = measure(mix, ui)
    drift = [abs(c["peak"] - c["intended"]) * 1000 for c in cues]
    out = {
        "bpm": BPM, "beat": BEAT, "bar": BAR, "duration": DUR, "sr": SR,
        "beats": [round(i * BEAT, 4) for i in range(int(DUR / BEAT))],
        "downbeats": [round(i * BAR, 4) for i in range(16)],
        "librosa_tempo": float(np.atleast_1d(tempo)[0]),
        "librosa_beats_first8": [round(float(b), 3) for b in beats[:8]],
        "cues": cues,
    }
    with open(os.path.join(OUT, "cues.json"), "w") as f:
        json.dump(out, f, indent=1)
    for c in cues:
        d = abs(c["peak"] - c["intended"]) * 1000
        if d > 6:
            print("  drift", c["name"], c["kind"], round(d, 1), "ms")
    print(f"track: {DUR}s, {len(cues)} cues, librosa tempo {out['librosa_tempo']:.2f}, "
          f"max peak drift {max(drift):.1f} ms, mean {np.mean(drift):.1f} ms")
    print("librosa beats:", out["librosa_beats_first8"])


if __name__ == "__main__":
    main()

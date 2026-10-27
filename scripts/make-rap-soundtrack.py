"""Create an original 8-second beat and mix local synthetic reference vocals.

No remote API, pretrained music or sampled song. Run the companion PowerShell
script first to render the four voice lines using Windows Speech. This is a
reference demo, not a verified commercially licensed vocal master.
"""
import array
import json
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SR = 44100
LENGTH = 8
rng = random.Random(2702026)
beat = [0.0] * (SR * LENGTH)
vocals = [0.0] * len(beat)


def add(start, duration, sample, gain=1):
    first = round(start * SR)
    for j in range(min(round(duration * SR), len(beat) - first)):
        beat[first + j] += gain * sample(j / SR)


for step in range(64):
    start = step * 0.125
    if step % 8 in (0, 3, 6):
        add(start, 0.24, lambda t: math.sin(2 * math.pi * (48 * t + 7 * (1 - math.exp(-t * 38)))) * math.exp(-t * 19), 0.72)
    if step % 8 == 4:
        add(start, 0.14, lambda t: (rng.uniform(-1, 1) * .8 + math.sin(2 * math.pi * 180 * t) * .2) * math.exp(-t * 35), 0.45)
    if step % 2 == 0:
        add(start, 0.04, lambda t: rng.uniform(-1, 1) * math.exp(-t * 110), 0.22)

for bar, freq in enumerate((55, 65.406, 49, 55)):
    for offset in (0, 0.75, 1.5):
        add(bar * 2 + offset, 0.42, lambda t, f=freq: (math.sin(2 * math.pi * f * t) + .15 * math.sin(2 * math.pi * f * 2 * t)) * min(1, t * 100) * math.exp(-t * 5), .28)
    for offset, note in ((0.25, freq * 8), (1.0, freq * 6), (1.625, freq * 12)):
        add(bar * 2 + offset, 0.25, lambda t, f=note: (math.sin(2 * math.pi * f * t) + .2 * math.sin(2 * math.pi * f * 3 * t)) * math.exp(-t * 16), .12)


def read_voice(filename):
    with wave.open(str(filename), 'rb') as source:
        channels, width, rate, frames, _, _ = source.getparams()
        if width != 2:
            raise ValueError('16-bit PCM input required')
        data = array.array('h', source.readframes(frames))
        mono = [sum(data[i:i + channels]) / (channels * 32768) for i in range(0, len(data), channels)]
    # Remove synthesizer padding, keeping plosives and breaths.
    active = [i for i, x in enumerate(mono) if abs(x) > .008]
    if not active:
        raise ValueError('Voice is silent')
    mono = mono[max(0, active[0] - rate // 100):min(len(mono), active[-1] + rate // 25)]
    count = min(round(len(mono) * SR / rate), round(1.70 * SR))
    # Uniform resampling keeps each phrase inside its two-second bar.
    scale = (len(mono) - 1) / max(1, count - 1)
    result = []
    peak = max(abs(x) for x in mono) or 1
    for i in range(count):
        p = i * scale
        k = int(p)
        result.append((mono[k] * (1 - (p - k)) + mono[min(k + 1, len(mono) - 1)] * (p - k)) / peak)
    return result


for bar in range(4):
    line = read_voice(ROOT / 'inputs' / 'rap-audio' / f'line-{bar}.wav')
    first = round((bar * 2 + .12) * SR)
    for i, value in enumerate(line):
        vocals[first + i] += .66 * value


def write(filename, samples):
    peak = max(max(abs(x) for x in samples), 1)
    pcm = b''.join(struct.pack('<h', round(max(-1, min(1, x / peak * .92)) * 32767)) for x in samples)
    with wave.open(str(filename), 'wb') as out:
        out.setparams((1, 2, SR, 0, 'NONE', 'not compressed'))
        out.writeframes(pcm)


target = ROOT / 'public' / 'rap'
target.mkdir(parents=True, exist_ok=True)
mixed = [(b * (.62 if abs(v) > .015 else 1) + v) * min(1, (len(beat) - i) / (SR * .08)) for i, (b, v) in enumerate(zip(beat, vocals))]
write(target / 'booth-original-v1.wav', mixed)
write(target / 'booth-instrumental-v1.wav', beat)
print(json.dumps({'durationSeconds': LENGTH, 'sampleRate': SR, 'channels': 1, 'format': 'PCM16 WAV', 'bpm': 120, 'remoteCalls': 0}))

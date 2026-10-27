# BOOTH assets, 2026-10-27

- `sample-left.png` / `sample-right.png`: copies of user-provided `inputs/left.png` / `inputs/right.png` for the explicit sample-photo action. Originals are unchanged. These committed demo photos are distinct from customer uploads, which are never stored under public/.
- `sample-left.webp` / `sample-right.webp`: resized preview derivatives of the supplied photos.
- `booth-concept-v1.png` / `.webp`: static illustration generated using the built-in imagegen tool with the supplied photos as identity references. It is **not** a Seedance result or a quality benchmark. The page labels it concept art.
- `booth-original-v1.wav`: 8 s, 44,100 Hz, mono PCM16; original procedural 120 BPM beat, four original English lines, offline Windows Zira synthetic reference voice. No copied song, voice clone or remote music/video API used.
- `booth-instrumental-v1.wav`: the same original instrumental without reference speech.

Lyrics: “Two faces, one beat. Step in, feel the heat. Side by side, we shine. Your crew, your time.”

Reproduce the audio on Windows: run `scripts/make-rap-vocals.ps1`, then `python scripts/make-rap-soundtrack.py`. The synthetic reference vocal is a production demo, not a verified commercial vocal license. Keep `RAP_MUSIC_RIGHTS_APPROVED=false` until the chosen final recording and rights have been approved. A professionally recorded vocal may replace it under a new asset/template version.

Image prompt used (built-in mode):

> Create a photorealistic editorial concept poster. First adult man in blue sweatshirt stands on the left; second adult woman in burgundy sweatshirt on the right. Preserve distinct faces and clothing. Portrait 9:16, both upper bodies clearly visible, one suspended studio microphone, warm burnt-orange acoustic recording booth, analog film texture, direct-flash music editorial lighting. No letters, text, logos or watermark. Static concept illustration, not a video frame.

No KIE video task has been submitted by this implementation session. The five-group quality gate remains unexecuted.

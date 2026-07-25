# Firefox Page Recorder

Firefox extension that records the visible area of the active tab, with optional microphone audio, and downloads the result locally as WebM.

## Features

- Records only the visible viewport of the active tab (`captureVisibleTab`).
- Optional microphone and meeting-loopback audio, recorded as separate Deepgram channels.
- Optional real-time transcription with speaker labels, downloaded as a .txt next to the video.
- Waits for a 3-second countdown before recording starts.
- Downloads WebM via the native MediaRecorder pipeline (VP8 + Opus).
- Remembers the last FPS choice locally.
- Adjusts the encoder bitrate to the captured resolution.
- Saves files with host-based names and timestamps.

## Installation

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `manifest.json`.
4. Open the page you want to record.
5. Click the extension button.
6. Choose audio mode and FPS.
7. Click start, wait for the countdown, then stop to download WebM.

## Output

- Filename base: `domain-timestamp`
- Container: WebM
- Codec: VP8 + Opus (native browser MediaRecorder)
- Capture rate: 5, 10, 15, 30, or 60 fps, with 5 fps as the default
- Bitrate: scaled from the capture resolution and selected FPS

## Development

This repository has no build step. Edit the files in the repository root and reload the temporary add-on in Firefox.

Validation commands:

```bash
node --check popup.js
node --check recorder.js
jq empty manifest.json
```

## Project Layout

```text
popup.html      Popup markup
popup.css       Popup and recorder window styles
popup.js        Settings, device picker, recorder window launcher
recorder.html   Recorder window markup
recorder.js     Recording pipeline (capture, audio, Deepgram, encode, download)
pcm-worklet.js  AudioWorklet turning the mixer output into linear16 for Deepgram
manifest.json   Firefox extension manifest
```

## Meeting audio and live transcription

Firefox cannot capture tab or system audio ([bug 1541425](https://bugzilla.mozilla.org/show_bug.cgi?id=1541425)), so the other participants have to reach the extension as a regular audio input:

```bash
# PipeWire / PulseAudio: the monitor of your output device is already a source
pactl list short sources | grep monitor
```

Pick that `Monitor of ...` entry as **Áudio da reunião (loopback)** in the popup, and your headset as **Microfone**. Both are recorded into the WebM, and each is sent to Deepgram as its own channel — so your voice is never confused with theirs.

Speaker labels:

- `Você` — the mic channel.
- `Reunião · Participante N` — the loopback channel, split by Deepgram's diarization.

Set **Transcrição** to `Deepgram (tempo real)` and paste an API key. The transcript renders live in the recorder window and downloads as `domain-timestamp.txt` next to the video, timestamps aligned to the recording.

## Limitations

- Records the visible area of the active tab only (not a free window picker).
- Tab/system audio is not captured: Firefox blocks `getDisplayMedia` in extension pages for this flow.
- The recorder window does not close by itself after stopping: files are handed to the browser as `blob:` downloads, and destroying the document would cancel one still in flight. Dismiss it with its own button.
- Recording runs in a small dedicated window: Firefox refuses `getUserMedia` in background pages, and a mic track dies with the document that created it. Closing that window discards the take; use its stop button (or the toolbar popup) to finish.
- Microphone audio is optional and prompts for permission on the recorder window.
- Codec support depends on the installed Firefox build and operating system.
- The UI is currently in Portuguese.

## License

MIT. See [LICENSE](LICENSE).

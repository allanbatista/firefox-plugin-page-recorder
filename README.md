# Firefox Page Recorder

Firefox extension that records the visible area of the active tab, with optional microphone audio, and downloads the result locally as WebM.

## Features

- Records only the visible viewport of the active tab (`captureVisibleTab`).
- Optional microphone audio.
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
popup.js        Settings, recorder window launcher
recorder.html   Recorder window markup
recorder.js     Recording pipeline (capture, mic, encode, download)
manifest.json   Firefox extension manifest
```

## Limitations

- Records the visible area of the active tab only (not a free window picker).
- Tab/system audio is not captured: Firefox blocks `getDisplayMedia` in extension pages for this flow.
- Recording runs in a small dedicated window: Firefox refuses `getUserMedia` in background pages, and a mic track dies with the document that created it. Closing that window discards the take; use its stop button (or the toolbar popup) to finish.
- Microphone audio is optional and prompts for permission on the recorder window.
- Codec support depends on the installed Firefox build and operating system.
- The UI is currently in Portuguese.

## License

MIT. See [LICENSE](LICENSE).

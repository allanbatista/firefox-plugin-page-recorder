# Firefox Page Recorder

Firefox extension that records the visible area of the active tab and downloads the result locally.

## Features

- Records only the visible viewport of the active tab.
- Prefers MP4/H.264 and falls back to WebM/VP8 when MP4 is unavailable.
- Adjusts the encoder bitrate to the captured resolution.
- Saves files with host-based names and timestamps.

## Installation

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `manifest.json`.
4. Open the page you want to record.
5. Click the extension button and start recording.
6. Click stop to download the file.

## Output

- Filename: `domain-timestamp.mp4` or `domain-timestamp.webm`
- Container: MP4 when supported, otherwise WebM
- Codec: H.264 or VP8, depending on the Firefox and OS support
- Capture rate: 8 fps
- Bitrate: scaled from the capture resolution

## Development

This repository has no build step. Edit the files in the repository root and reload the temporary add-on in Firefox.

Validation commands:

```bash
node --check background.js
node --check popup.js
jq empty manifest.json
```

## Project Layout

```text
background.js   Extension logic and recording pipeline
popup.html      Popup markup
popup.css       Popup styles
popup.js        Popup state and messaging
manifest.json   Firefox extension manifest
```

## Limitations

- The extension records the visible area only.
- Codec support depends on the installed Firefox build and operating system.
- The popup UI is currently in Portuguese.

## License

MIT. See [LICENSE](LICENSE).

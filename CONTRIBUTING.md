# Contributing

Thanks for helping improve Firefox Page Recorder.

## Before you start

- Keep changes small and focused.
- Open an issue first for larger behavior changes.
- Use English in new documentation and GitHub templates.

## Local setup

This project has no build step. Load `manifest.json` through Firefox `about:debugging` and reload the temporary add-on after every change.

## Validation

Run these checks before opening a pull request:

```bash
node --check background.js
node --check popup.js
jq empty manifest.json
```

## Pull requests

- Describe the user-visible behavior change.
- Include Firefox version and operating system when recording behavior changes.
- Attach a sample recording if the change affects output quality or file format.


#!/usr/bin/env sh
set -eu

mkdir -p dist
rm -f dist/firefox-page-recorder.xpi
zip -qr dist/firefox-page-recorder.xpi \
  manifest.json popup.html popup.css popup.js recorder.html recorder.js pcm-worklet.js assets

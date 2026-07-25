#!/usr/bin/env sh
set -eu

mkdir -p dist
rm -f dist/firefox-page-recorder.xpi
zip -qr dist/firefox-page-recorder.xpi \
  manifest.json background.js popup.html popup.css popup.js assets

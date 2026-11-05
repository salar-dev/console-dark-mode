#!/usr/bin/env bash
# Validate the extension and package it for the Chrome Web Store.
#   ./scripts/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extension"
DIST="$ROOT/dist"

echo "▶ Validating manifest…"
node -e '
  const fs = require("fs"), path = require("path");
  const ext = process.argv[1];
  const m = JSON.parse(fs.readFileSync(path.join(ext, "manifest.json")));
  if (m.manifest_version !== 3) throw new Error("manifest_version must be 3");
  if (m.default_locale || /__MSG_/.test(JSON.stringify(m))) throw new Error("manifest must use literal English strings");
  for (const [k, v] of Object.entries(m.icons)) {
    if (!fs.existsSync(path.join(ext, v))) throw new Error("missing icon " + v);
  }
  for (const f of ["popup/popup.html", "popup/brand/play-console.svg", "popup/brand/app-store-connect.svg", "popup/brand/extension.svg"]) {
    if (!fs.existsSync(path.join(ext, f))) throw new Error("missing popup file " + f);
  }
  for (const cs of m.content_scripts) {
    for (const f of [...(cs.css || []), ...(cs.js || [])]) {
      if (!fs.existsSync(path.join(ext, f))) throw new Error("missing content file " + f);
    }
  }
  console.log("  manifest ok — version " + m.version);
' "$EXT"

echo "▶ Checking JavaScript syntax…"
find "$EXT" -name '*.js' -print0 | xargs -0 -n1 node --check
echo "  js ok"

VERSION="$(node -p 'require(process.argv[1]).version' "$EXT/manifest.json")"
OUT="$DIST/console-dark-mode-v$VERSION.zip"

mkdir -p "$DIST"
rm -f "$OUT"
echo "▶ Zipping…"
(cd "$EXT" && zip -qr "$OUT" . -x '.DS_Store' -x '*/.DS_Store' -x '*.map')
echo "✔ $OUT ($(du -h "$OUT" | cut -f1))"

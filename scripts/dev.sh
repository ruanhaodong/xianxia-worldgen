#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
node scripts/build-viewer.mjs
node src/cli/generate.mjs --seed "${1:-九州·42}" --out data/world
echo "Open http://127.0.0.1:4173  (starting server)"
npx --yes serve public -l 4173

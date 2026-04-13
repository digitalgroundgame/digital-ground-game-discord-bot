#!/usr/bin/env bash
set -euo pipefail
# Command hooks receive JSON on stdin; drain it so tooling does not consume it.
cat >/dev/null
npm run format:fix
npm run lint:fix

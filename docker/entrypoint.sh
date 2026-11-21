#!/bin/sh
# Claude Mnemosyne server container: checks the password, lays out /data, starts the server.
set -eu

if [ -z "${MNEMOSYNE_UI_PASSWORD:-}" ]; then
  echo "mnemosyne: MNEMOSYNE_UI_PASSWORD is not set. Set it (8 or more characters) in the app's environment and deploy again." >&2
  exit 64
fi
if [ "${#MNEMOSYNE_UI_PASSWORD}" -lt 8 ]; then
  echo "mnemosyne: MNEMOSYNE_UI_PASSWORD is shorter than 8 characters. Choose a longer one and deploy again." >&2
  exit 64
fi

# Embeddings follow the image's build (EMBEDDINGS=1 -> on) unless set at run time.
if [ -z "${MNEMOSYNE_EMBEDDINGS:-}" ]; then
  MNEMOSYNE_EMBEDDINGS="$(cat /opt/mnemosyne/embeddings 2>/dev/null || echo off)"
fi
export MNEMOSYNE_EMBEDDINGS

ROOT="${MNEMOSYNE_ROOT:-/data}"
STORE="${MNEMOSYNE_STORE:-$ROOT/store}"

if ! mkdir -p "$STORE" "$ROOT/backups" 2>/dev/null || [ ! -w "$ROOT" ]; then
  echo "mnemosyne: cannot write to $ROOT as uid $(id -u):$(id -g). Give that user the data folder on the host (e.g. chown -R $(id -u):$(id -g) <data folder>)." >&2
  exit 73
fi
chmod 700 "$STORE" "$ROOT/backups"

bun /app/docker/init-data.ts "$ROOT"
exec bun /app/ui/server.ts --server

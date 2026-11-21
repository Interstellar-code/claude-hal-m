#!/bin/sh
# Claude Mnemosyne server container: checks the password, lays out /data, starts the server.
# Started as root (the default, and what Unraid's Tailscale hook needs), it gives the data
# folder to PUID:PGID and runs again as that user; started as a non-root user (--user), it
# runs as that user.
set -eu

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-99}"
  PGID="${PGID:-100}"
  case "$PUID$PGID" in
    ''|*[!0-9]*) echo "mnemosyne: PUID and PGID must be numbers (got \"$PUID:$PGID\")." >&2; exit 64 ;;
  esac
  if [ "$PUID" -eq 0 ] || [ "$PGID" -eq 0 ]; then
    echo "mnemosyne: PUID/PGID must not be 0; the server does not run as root." >&2; exit 64
  fi
  ROOT="${MNEMOSYNE_ROOT:-/data}"
  mkdir -p "$ROOT"
  # Only what is not owned yet, so a large store is not walked on every start.
  find "$ROOT" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} + \
    || echo "mnemosyne: could not give all of $ROOT to $PUID:$PGID; carrying on, the write check below decides." >&2
  chown "$PUID:$PGID" /home/mnemosyne
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups --inh-caps=-all -- /bin/sh "$0" "$@"
fi

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

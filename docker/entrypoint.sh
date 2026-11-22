#!/bin/sh
# Claude HAL-M server container: checks the password, lays out /data, starts the server.
# Started as root (the default, and what Unraid's Tailscale hook needs), it gives the data
# folder to PUID:PGID and runs again as that user; started as a non-root user (--user), it
# runs as that user.
#
# Settings (plan 3.1): each is HALM_<X>, else the old MNEMOSYNE_<X> (an empty value counts
# as not set), else the default below; the result is exported as HALM_<X>, which the server
# reads first. The image bakes none of these, so an old template's MNEMOSYNE_BIND=127.0.0.1
# is never beaten by an image default.
set -eu

# setting <NAME> [<default>]: prints HALM_<NAME>, else MNEMOSYNE_<NAME>, else <default>.
setting() {
  eval "_new=\"\${HALM_$1:-}\" _old=\"\${MNEMOSYNE_$1:-}\""
  if [ -n "$_new" ]; then printf '%s' "$_new"
  elif [ -n "$_old" ]; then printf '%s' "$_old"
  else printf '%s' "${2:-}"
  fi
}

# resolve <NAME> [<default>]: exports HALM_<NAME> as above; left unset when it ends empty.
resolve() {
  _value="$(setting "$@")"
  if [ -n "$_value" ]; then
    export "HALM_$1=$_value"
  else
    unset "HALM_$1"
  fi
}

resolve ROOT /data
ROOT="$HALM_ROOT"

if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-99}"
  PGID="${PGID:-100}"
  case "$PUID$PGID" in
    ''|*[!0-9]*) echo "hal-m: PUID and PGID must be numbers (got \"$PUID:$PGID\")." >&2; exit 64 ;;
  esac
  if [ "$PUID" -eq 0 ] || [ "$PGID" -eq 0 ]; then
    echo "hal-m: PUID/PGID must not be 0; the server does not run as root." >&2; exit 64
  fi
  mkdir -p "$ROOT"
  # Only what is not owned yet, so a large store is not walked on every start.
  find "$ROOT" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} + \
    || echo "hal-m: could not give all of $ROOT to $PUID:$PGID; carrying on, the write check below decides." >&2
  chown "$PUID:$PGID" /home/mnemosyne
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups --inh-caps=-all -- /bin/sh "$0" "$@"
fi

resolve UI_PASSWORD
if [ -z "${HALM_UI_PASSWORD:-}" ]; then
  echo "hal-m: HALM_UI_PASSWORD (or MNEMOSYNE_UI_PASSWORD) is not set. Set it (8 or more characters) in the app's environment and deploy again." >&2
  exit 64
fi
if [ "${#HALM_UI_PASSWORD}" -lt 8 ]; then
  echo "hal-m: HALM_UI_PASSWORD (or MNEMOSYNE_UI_PASSWORD) is shorter than 8 characters. Choose a longer one and deploy again." >&2
  exit 64
fi

resolve STORE "$ROOT/store"
resolve PORT 8787
resolve BIND 0.0.0.0
resolve SECURE_COOKIE auto
# Embeddings follow the image's build (EMBEDDINGS=1 -> on) unless set at run time.
resolve EMBEDDINGS "$(cat /opt/mnemosyne/embeddings 2>/dev/null || echo off)"
# No default: unset means the server's own default (none, any host, 90 days).
resolve PUBLIC_URL
resolve HOSTS
resolve EXPIRE_UNUSED_DAYS
STORE="$HALM_STORE"

if ! mkdir -p "$STORE" "$ROOT/backups" 2>/dev/null || [ ! -w "$ROOT" ]; then
  echo "hal-m: cannot write to $ROOT as uid $(id -u):$(id -g). Give that user the data folder on the host (e.g. chown -R $(id -u):$(id -g) <data folder>)." >&2
  exit 73
fi
chmod 700 "$STORE" "$ROOT/backups"

bun /app/docker/init-data.ts "$ROOT"
exec bun /app/ui/server.ts --server

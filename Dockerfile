# Claude HAL-M as a server: one shared memory, its dashboard, /api/plugin/* and /mcp.
# See README "Run it as a server" and docs/plans/remote-server.md. Debian (glibc), not
# Alpine: the embeddings runtime (onnxruntime-node) needs glibc.
FROM oven/bun:1.4.3-debian

# 1 installs the local embedding model at build time and turns embeddings on; 0 leaves both out.
ARG EMBEDDINGS=1
# The user the server runs as. 99:100 is nobody:users on Unraid, which owns /mnt/*/appdata.
# The container starts as root (Unraid's Tailscale hook needs root); the entrypoint hands the
# data folder to PUID:PGID and drops to that user before the server starts. PUID/PGID set at
# run time win over these build defaults.
ARG PUID=99
ARG PGID=100

# Nothing an operator can set is baked here, under either name (plan 3.1): a baked
# HALM_BIND=0.0.0.0 would beat an old template's MNEMOSYNE_BIND=127.0.0.1. ROOT, STORE,
# PORT, BIND, SECURE_COOKIE and EMBEDDINGS get their defaults in docker/entrypoint.sh,
# which reads HALM_<X>, then the old MNEMOSYNE_<X>, and exports HALM_<X>. EMBEDDINGS
# defaults to this build's choice (/opt/mnemosyne/embeddings). Only image-internal
# paths nobody sets are baked, under the new names. The /opt/mnemosyne and
# /home/mnemosyne folders keep their names: they are inside the image only.
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    HALM_CLI=/opt/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts \
    HALM_PLUGIN_ROOT=/app \
    HALM_MODEL_CACHE=/opt/mnemosyne/model-cache \
    PUID=${PUID} \
    PGID=${PGID} \
    HOME=/home/mnemosyne

WORKDIR /app
COPY . /app

# Root deps are production only (umap-js); the dashboard's 3D libraries are prebuilt in ui/vendor.
# The engine install checks itself against a throwaway store (and, with embeddings, downloads
# the model into /opt/mnemosyne/model-cache). Its store/settings/launcher are not used: the
# real ones live in /data.
RUN set -eu; \
    bun install --frozen-lockfile --production; \
    if [ "$EMBEDDINGS" = "1" ]; then \
      bun bin/install-engine.ts --root /opt/mnemosyne --embeddings; echo on > /opt/mnemosyne/embeddings; \
    else \
      bun bin/install-engine.ts --root /opt/mnemosyne; echo off > /opt/mnemosyne/embeddings; \
    fi; \
    rm -rf /opt/mnemosyne/store /opt/mnemosyne/engine.lock; \
    getent group "$PGID" >/dev/null || groupadd -g "$PGID" mnemosyne; \
    getent passwd "$PUID" >/dev/null || useradd -o -u "$PUID" -g "$PGID" -M -d /home/mnemosyne -s /usr/sbin/nologin mnemosyne; \
    mkdir -p /data /home/mnemosyne; \
    chown -R "$PUID:$PGID" /opt/mnemosyne /data /home/mnemosyne; \
    chmod 700 /data /home/mnemosyne

VOLUME /data
EXPOSE 8787

# The check runs with the container's own environment (not the entrypoint's exports), so it
# reads the port under both names, new first.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "const e=process.env;fetch('http://127.0.0.1:'+(e.HALM_PORT||e.MNEMOSYNE_PORT||'8787')+'/api/session').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]

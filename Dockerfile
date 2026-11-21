# Claude Mnemosyne as a server: one shared memory, its dashboard, /api/plugin/* and /mcp.
# See README "Run it as a server" and docs/plans/remote-server.md. Debian (glibc), not
# Alpine: the embeddings runtime (onnxruntime-node) needs glibc.
FROM oven/bun:1.4.3-debian

# 1 installs the local embedding model at build time and turns embeddings on; 0 leaves both out.
ARG EMBEDDINGS=1
# The user the server runs as. 99:100 is nobody:users on Unraid, which owns /mnt/*/appdata.
ARG PUID=99
ARG PGID=100

# MNEMOSYNE_EMBEDDINGS is not set here: the entrypoint defaults it to this build's
# choice (/opt/mnemosyne/embeddings), and a value set at run time wins.
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    MNEMOSYNE_ROOT=/data \
    MNEMOSYNE_STORE=/data/store \
    MNEMOSYNE_CLI=/opt/mnemosyne/engine/node_modules/@oh-my-pi/pi-mnemopi/src/cli.ts \
    MNEMOSYNE_PLUGIN_ROOT=/app \
    MNEMOSYNE_MODEL_CACHE=/opt/mnemosyne/model-cache \
    MNEMOSYNE_PORT=8787 \
    MNEMOSYNE_BIND=0.0.0.0 \
    MNEMOSYNE_SECURE_COOKIE=auto \
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

USER ${PUID}:${PGID}
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.MNEMOSYNE_PORT||'8787')+'/api/session').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]

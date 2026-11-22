// The engine build this plugin expects: engine/package.json's version, which
// /hal-m-setup (old alias /mnemosyne-setup) installs (engine/UPSTREAM.md,
// change 3); its -mnemosyne.N build suffix stays (Stage 2 keep-list). No imports, so the
// hooks, the proxy, scripts and Bun specs can all read it.
export const ENGINE_BUILD = '18.12.3-mnemosyne.18'

// /hal-m-setup's limit on bin/install-engine.ts, and the installer's own
// limits on its steps: the inner ones stay well below the outer one, so the
// installer always ends (and cleans up .next) before the host kills it.
export const SETUP_TIMEOUT_MS = 600_000
export const INSTALL_STEP_TIMEOUT_MS = 240_000
// The embeddings check downloads the ~63 MB model once on this run, so it is
// allowed far longer than a plain tools/list probe.
export const INSTALL_CHECK_TIMEOUT_MS = 300_000
// How long a second install waits for another's lock (bin/install-engine.ts):
// longer than one whole install step plus check, so a healthy install is
// waited out. Under /hal-m-setup the host's own limit ends the wait first.
export const INSTALL_LOCK_WAIT_MS = 600_000
// The wait /hal-m-setup asks for (HALM_LOCK_WAIT_MS, old name
// MNEMOSYNE_LOCK_WAIT_MS): with the worst
// install step plus check it still ends 30 s before SETUP_TIMEOUT_MS, so a
// waiting setup reports "another install holds" instead of being killed.
export const SETUP_LOCK_WAIT_MS = 30_000

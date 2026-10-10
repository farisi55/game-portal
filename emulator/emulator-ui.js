// ============================================================================
// GIMBOOT — Emulator page shell logic (Task #022, expanded in Task #024)
//
// Handles: system dropdown (35 systems, grouped per vendor), ROM / BIOS file
// selection, message handshake with the runtime iframe, and the postMessage
// of the File object to the runtime.
//
// The <select> options in index.html are the single source of truth for the
// system list (value = EmulatorJS system key, data-accept = ROM file
// extensions, data-bios = required | recommended). The runtime iframe
// independently validates the core key against its own allowlist.
//
// ROM/BIOS bytes never leave the browser: the File is structured-clone
// postMessage'd to the same-origin runtime iframe, which calls
// URL.createObjectURL() and feeds it to EmulatorJS.
// ============================================================================

const MB = 1048576;
const DEFAULT_MAX_ROM_BYTES = 128 * MB;
// Per-system ROM size caps (larger than the default for disc/UMD systems).
const SYSTEM_MAX_ROM_BYTES = {
  psx: 999 * MB,
  psp: 2048 * MB,
};

function maxRomBytesFor(core) {
  return SYSTEM_MAX_ROM_BYTES[core] || DEFAULT_MAX_ROM_BYTES;
}

const state = {
  selectedSystem: null,
  selectedCore: null,
  romFile: null,
  biosFile: null,
  runtimeReady: false,
  started: false,
};

const els = {
  sysSelect: document.getElementById('sys-select'),
  sysHint: document.getElementById('sys-hint'),
  romInput: document.getElementById('rom-file'),
  romStatus: document.getElementById('rom-status'),
  biosInput: document.getElementById('bios-file'),
  biosStatus: document.getElementById('bios-status'),
  loadBtn: document.getElementById('btn-load'),
  loadStatus: document.getElementById('load-status'),
  stage: document.querySelector('.emu-stage'),
  stageStatus: document.getElementById('stage-status'),
  iframe: document.getElementById('emu-iframe'),
};

// Defense-in-depth: allowed keys are derived from the shipped dropdown
// itself; the runtime iframe re-validates against its own hard-coded
// allowlist before accepting a core.
const ALLOWED_CORES = [...els.sysSelect.querySelectorAll('option[value]')]
  .map((opt) => opt.value)
  .filter(Boolean);

// ---------------------------------------------------------------------------
// System picker
// ---------------------------------------------------------------------------

function onSelectChange() {
  const opt = els.sysSelect.selectedOptions[0];
  if (!opt || !opt.value || !ALLOWED_CORES.includes(opt.value)) return;

  state.selectedSystem = opt.value;
  state.selectedCore = opt.value; // system key === EmulatorJS core key

  const label = opt.textContent.trim();
  els.romInput.accept = opt.dataset.accept || '';
  els.romInput.disabled = false;

  const bios = opt.dataset.bios;
  els.sysHint.textContent =
    bios === 'required'
      ? `${label} requires a BIOS file — select it in step 2 before loading.`
      : bios === 'recommended'
        ? `${label} works best with a BIOS file — consider providing one.`
        : '';

  els.romStatus.textContent = `Selected: ${label}. Now choose a ROM file.`;

  // Reset previous selection when system changes.
  state.romFile = null;
  els.romInput.value = '';
  updateLoadButton();
}

function updateLoadButton() {
  els.loadBtn.disabled = !state.romFile || !state.selectedCore;
}

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

function onRomChange() {
  const file = els.romInput.files?.[0] || null;
  if (!file) {
    state.romFile = null;
    els.romStatus.textContent = 'No file selected.';
    updateLoadButton();
    return;
  }
  const maxBytes = maxRomBytesFor(state.selectedCore);
  if (file.size > maxBytes) {
    state.romFile = null;
    els.romInput.value = '';
    els.romStatus.textContent = `File too large (max ${formatBytes(maxBytes)}).`;
    updateLoadButton();
    return;
  }
  state.romFile = file;
  els.romStatus.textContent = `Loaded: ${file.name} (${formatBytes(file.size)})`;
  updateLoadButton();
}

function onBiosChange() {
  const file = els.biosInput.files?.[0] || null;
  state.biosFile = file || null;
  els.biosStatus.textContent = file
    ? `Loaded: ${file.name} (${formatBytes(file.size)})`
    : '';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Iframe handshake
// ---------------------------------------------------------------------------

let loadRetryTimer = null;

function onIframeMessage(e) {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (!d || typeof d !== 'object') return;

  if (d.type === 'gimboot:runtime-ready') {
    state.runtimeReady = true;
    els.loadStatus.textContent = '';
  }

  if (d.type === 'gimboot:started') {
    state.started = true;
    clearInterval(loadRetryTimer);
    els.stageStatus.hidden = true;
  }
}

function onLoadClick() {
  if (!state.romFile || !state.selectedCore) return;
  if (state.started) return; // single-ROM-per-page-load policy

  els.loadStatus.textContent = 'Loading emulator…';
  els.stage.hidden = false;

  // Post the File to the runtime iframe. The runtime ignores duplicate
  // gimboot:load messages (one-shot `loaded` guard), so we retry on an
  // interval until it reports `gimboot:started` — this makes the
  // handshake robust against a still-navigating/reloading iframe
  // swallowing the first message (see Task #024 notes).
  const postRom = () => {
    els.iframe.contentWindow?.postMessage(
      {
        type: 'gimboot:load',
        core: state.selectedCore,
        rom: state.romFile,
        bios: state.biosFile,
      },
      location.origin,
    );
  };

  postRom();
  clearInterval(loadRetryTimer);
  let attempts = 0;
  loadRetryTimer = setInterval(() => {
    if (state.started || attempts >= 20) {
      clearInterval(loadRetryTimer);
      return;
    }
    attempts += 1;
    postRom();
  }, 500);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  els.sysSelect.addEventListener('change', onSelectChange);

  els.romInput.addEventListener('change', onRomChange);
  els.biosInput.addEventListener('change', onBiosChange);
  els.loadBtn.addEventListener('click', onLoadClick);

  window.addEventListener('message', onIframeMessage);

  // Start the runtime iframe hidden. Extensionless URL — matches the
  // canonical assets route and avoids an extra .html → extensionless
  // redirect hop for a document that is itself going cross-origin
  // isolated (COOP/COEP).
  els.iframe.src = '/emulator/runtime';

  // Signal readiness for tests / debugging.
  window.__emuUiReady = true;
}

init();

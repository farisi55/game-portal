// ============================================================================
// GIMBOOT — Emulator page shell logic (Task #022)
//
// Handles: system picker, ROM / BIOS file selection, message handshake with
// the runtime iframe, and the postMessage of the File object to the runtime.
//
// ROM/BIOS bytes never leave the browser: the File is structured-clone
// postMessage'd to the same-origin runtime iframe, which calls
// URL.createObjectURL() and feeds it to EmulatorJS.
// ============================================================================

const MAX_ROM_BYTES = 134217728; // 128 MB sanity cap

const ALLOWED_CORES = ['nes', 'snes', 'gb', 'gba', 'segaMD'];

// ---------------------------------------------------------------------------

const state = {
  selectedSystem: null,
  selectedCore: null,
  romFile: null,
  biosFile: null,
  runtimeReady: false,
  started: false,
};

const els = {
  sysButtons: document.querySelectorAll('.sys-btn'),
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

// ---------------------------------------------------------------------------
// System picker
// ---------------------------------------------------------------------------

function selectSystem(btn) {
  const core = btn.dataset.core;
  if (!ALLOWED_CORES.includes(core)) return;

  state.selectedSystem = btn.dataset.system;
  state.selectedCore = core;

  els.sysButtons.forEach((b) => b.setAttribute('aria-checked', String(b === btn)));

  const accept = btn.dataset.accept || '';
  els.romInput.accept = accept;
  els.romInput.disabled = false;
  els.romStatus.textContent = `Selected: ${btn.textContent}. Now choose a ROM file.`;

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
  if (file.size > MAX_ROM_BYTES) {
    state.romFile = null;
    els.romInput.value = '';
    els.romStatus.textContent = 'File too large (max 128 MB).';
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
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Iframe handshake
// ---------------------------------------------------------------------------

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
    els.stageStatus.hidden = true;
  }
}

function onLoadClick() {
  if (!state.romFile || !state.selectedCore) return;
  if (state.started) return; // single-ROM-per-page-load policy

  els.loadStatus.textContent = 'Loading emulator…';
  els.stage.hidden = false;

  // Wait for the iframe to report ready, then post the File.
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

  if (state.runtimeReady) {
    postRom();
  } else {
    // Runtime not yet loaded — queue on the next ready signal.
    const onReady = (e) => {
      if (e.origin !== location.origin) return;
      if (e.data?.type === 'gimboot:runtime-ready') {
        window.removeEventListener('message', onReady);
        postRom();
      }
    };
    window.addEventListener('message', onReady);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  els.sysButtons.forEach((btn) => {
    btn.addEventListener('click', () => selectSystem(btn));
  });

  els.romInput.addEventListener('change', onRomChange);
  els.biosInput.addEventListener('change', onBiosChange);
  els.loadBtn.addEventListener('click', onLoadClick);

  window.addEventListener('message', onIframeMessage);

  // Start the runtime iframe hidden.
  els.iframe.src = '/emulator/runtime.html';

  // Signal readiness for tests / debugging.
  window.__emuUiReady = true;
}

init();

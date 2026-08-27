/* ==========================================================================
   ui-share.js  —  Viral Share & High-Score Confetti (zero dependencies)
   Drop this script before each game's own <script> and call:
       ViralShare.show('kejar-koruptor', 12345);
   ========================================================================== */

;(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1. COPYWRITING  (per gameId)
  ------------------------------------------------------------------ */
  var COPY = {
    'kejar-koruptor':
      '\u{1F6A8} Gila, aku baru aja nangkep koruptor dengan skor {SKOR} di Gimboot! ' +
      'Yakin kamu bisa lebih lincah ngehindarin polisi & nyita asetnya? ' +
      'Buktikan nyalimu, mari bersihkan Indonesia! \u{1F44A}\u{1F1EE}\u{1F1E9} Main sekarang: ',
    'mobil-mbg':
      '\u{1F697}\u{1F4A8} Ngebut anter Omprengan Gizi MBG! Skorku tembus {SKOR}. ' +
      'Jangan sampai telat, tunjukkan skill nyetir retro kamu, coba kalahkan rekorku! ' +
      '\u{1F371} #MobilMBG #Gimboot \u2192 ',
    'ayo-kopdes':
      '\u{1F6D2}\u{1F4A8} Keranjang belanjaku penuh! Rekor belanjaku: {SKOR} di Ayo ke Kopdes. ' +
      'Siapa bilang belanja di minimarket nggak butuh skill? Coba kalahin rekorku! ' +
      '#AyoKopdes \u2192 ',
    'kicau-mania':
      '\u{1F426}\u{1F525} Gacor pol! Burungku cetak skor {SKOR} di Kicau Mania. ' +
      'Yakin para master kicau bisa ngalahin rekorku? Buktikan di sini! ' +
      '#KicauMania \u2192 ',
  };

  var BASE_URL = 'https://gimboot.com/game?id=';

  function buildShareText (gameId, score) {
    var tpl = COPY[gameId] || COPY['kejar-koruptor'];
    return tpl.replace('{SKOR}', String(score)) + BASE_URL + encodeURIComponent(gameId);
  }

  /* ------------------------------------------------------------------
     2. CSS  (injected once)
  ------------------------------------------------------------------ */
  var cssInjected = false;

  function injectCSS () {
    if (cssInjected) return;
    cssInjected = true;

    // CSP-friendly: load external stylesheet (style-src 'self' allows it even
    // when inline <style> is blocked). Use absolute path so it works from
    // any game subfolder.
    try {
      if (!document.querySelector('link[href*="ui-share.css"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/games/shared/ui-share.css';
        document.head.appendChild(link);
      }
    } catch (_) { /* ignore */ }

    // Fallback inline style for file:// or when external fails.
    // Will be blocked under strict CSP but harmless; when CSP allows
    // 'unsafe-inline' it ensures styling even before link loads.
    try {
      var style = document.createElement('style');
      try {
        var nonceSrc = document.querySelector('script[nonce]');
        var nonceVal = nonceSrc && (nonceSrc.nonce || nonceSrc.getAttribute('nonce'));
        if (nonceVal) { style.setAttribute('nonce', nonceVal); style.nonce = nonceVal; }
      } catch (_) { /* ignore */ }
      style.textContent = [
        '#viral-confetti-canvas{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:99998}',
        '.viral-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .3s ease,visibility .3s ease}',
        '.viral-overlay.viral-show{opacity:1;visibility:visible;pointer-events:auto}',
        '.viral-modal{position:relative;z-index:1;width:min(92vw,400px);text-align:center;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);border-radius:20px;padding:32px 24px 28px;box-shadow:0 8px 40px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,0.08);transform:scale(0.7) translateY(30px);transition:transform .35s cubic-bezier(.34,1.56,.64,1);font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#fff}',
        '.viral-overlay.viral-show .viral-modal{transform:scale(1) translateY(0)}',
        '.viral-trophy{font-size:52px;line-height:1;margin-bottom:8px;animation:viral-bounce .6s ease infinite alternate}',
        '@keyframes viral-bounce{from{transform:translateY(0) scale(1)}to{transform:translateY(-8px) scale(1.08)}}',
        '.viral-heading{font-size:15px;font-weight:700;letter-spacing:0.5px;color:#fbbf24;margin:0 0 6px}',
        '.viral-score{font-size:56px;font-weight:900;line-height:1.1;margin:4px 0 18px;background:linear-gradient(135deg,#fbbf24,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}',
        '.viral-btns{display:flex;flex-direction:column;gap:10px}',
        '.viral-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px 18px;border:none;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;transition:transform .15s,box-shadow .15s}',
        '.viral-btn:active{transform:scale(0.96)}',
        '.viral-btn-share{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;box-shadow:0 4px 14px rgba(34,197,94,0.35)}',
        '.viral-btn-share:hover{box-shadow:0 6px 20px rgba(34,197,94,0.5)}',
        '.viral-btn-close{background:rgba(255,255,255,0.1);color:#d1d5db;border:1px solid rgba(255,255,255,0.12)}',
        '.viral-btn-close:hover{background:rgba(255,255,255,0.16);color:#fff}'
      ].join('');
      document.head.appendChild(style);
    } catch (_) { /* ignore */ }
  }

  /* ------------------------------------------------------------------
     3. HTML  (modal + confetti canvas, injected on first show)
  ------------------------------------------------------------------ */
  var overlay = null;
  var confettiCanvas = null;
  var confettiCtx = null;
  var confettiPieces = [];
  var confettiRAF = null;

  function ensureDOM () {
    if (overlay) return;

    /* --- confetti canvas --- */
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.id = 'viral-confetti-canvas';
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    document.body.appendChild(confettiCanvas);
    confettiCtx = confettiCanvas.getContext('2d');
    window.addEventListener('resize', function () {
      if (!confettiCanvas) return;
      confettiCanvas.width = window.innerWidth;
      confettiCanvas.height = window.innerHeight;
    });

    /* --- modal overlay --- */
    overlay = document.createElement('div');
    overlay.className = 'viral-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Rekor baru');
    overlay.innerHTML = [
      '<div class="viral-modal">',
      '  <div class="viral-trophy">\u{1F3C6}</div>',
      '  <p class="viral-heading">\u{1F389} SELAMAT! Rekor Baru! \u{1F389}</p>',
      '  <div class="viral-score" id="viral-score">0</div>',
      '  <div class="viral-btns">',
      '    <button class="viral-btn viral-btn-share" id="viral-share-btn">',
      '      \u{1F4E4} Bagikan Rekormu!',
      '    </button>',
      '    <button class="viral-btn viral-btn-close" id="viral-close-btn">',
      '      \u{1F519} Tutup / Main Lagi',
      '    </button>',
      '  </div>',
      '</div>',
    ].join('');
    document.body.appendChild(overlay);

    /* --- close button --- */
    document.getElementById('viral-close-btn').addEventListener('click', hide);

    /* --- overlay backdrop click to close --- */
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) hide();
    });

    /* --- Esc to close & block propagation while visible --- */
    document.addEventListener('keydown', function (e) {
      if (!overlay || !overlay.classList.contains('viral-show')) return;
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hide();
      }
    });
  }

  /* ------------------------------------------------------------------
     4. CONFETTI  (lightweight, no library)
  ------------------------------------------------------------------ */
  var COLORS = [
    '#ef4444','#f97316','#eab308','#22c55e',
    '#3b82f6','#a855f7','#ec4899','#06b6d4',
  ];

  function spawnConfetti () {
    if (!confettiCanvas || !confettiCtx) return;
    confettiPieces = [];
    var count = Math.min(120, Math.floor(window.innerWidth / 6));
    for (var i = 0; i < count; i++) {
      confettiPieces.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * confettiCanvas.height * 0.6,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 4,
        rot: Math.random() * 360,
        rotV: (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      });
    }
    if (!confettiRAF) tickConfetti();
  }

  function tickConfetti () {
    if (!confettiCtx || !confettiCanvas) return;
    var ctx = confettiCtx;
    var W = confettiCanvas.width;
    var H = confettiCanvas.height;
    try { ctx.clearRect(0, 0, W, H); } catch (_) { return; }

    var alive = false;
    for (var i = 0; i < confettiPieces.length; i++) {
      var p = confettiPieces[i];
      if (p.life <= 0) continue;
      alive = true;

      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;           // gravity
      p.rot += p.rotV;
      if (p.y > H * 0.85) p.life -= 0.02;   // fade near bottom

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }

    if (alive) {
      confettiRAF = requestAnimationFrame(tickConfetti);
    } else {
      confettiRAF = null;
      ctx.clearRect(0, 0, W, H);
    }
  }

  function stopConfetti () {
    if (confettiRAF) {
      cancelAnimationFrame(confettiRAF);
      confettiRAF = null;
    }
    try {
      if (confettiCtx && confettiCanvas) confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    } catch (_) { /* ignore */ }
    confettiPieces = [];
  }

  /* ------------------------------------------------------------------
     5. SHARE LOGIC
  ------------------------------------------------------------------ */
  var pendingShareText = '';
  var pendingCallback = null;

  function onShareClick () {
    var text = pendingShareText;

    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {
        copyFallback(text);
      });
    } else {
      copyFallback(text);
    }
  }

  function copyFallback (text) {
    var btn = document.getElementById('viral-share-btn');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showCopied(btn);
      }, function () {
        forceCopy(text);
        showCopied(btn);
      });
    } else {
      forceCopy(text);
      showCopied(btn);
    }
  }

  function forceCopy (text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function showCopied (btn) {
    if (!btn) return;
    var orig = btn.innerHTML;
    btn.innerHTML = '\u2705 Teks Disalin!';
    btn.style.pointerEvents = 'none';
    setTimeout(function () {
      btn.innerHTML = orig;
      btn.style.pointerEvents = '';
    }, 2200);
  }

  /* ------------------------------------------------------------------
     6. SHOW / HIDE
  ------------------------------------------------------------------ */
  function isVisible () {
    return !!(overlay && overlay.classList.contains('viral-show'));
  }

  function show (gameId, newScore, onClose) {
    injectCSS();
    ensureDOM();

    /* store callback for when modal closes */
    pendingCallback = typeof onClose === 'function' ? onClose : null;

    /* update score display */
    var scoreEl = document.getElementById('viral-score');
    if (scoreEl) scoreEl.textContent = String(newScore);

    /* build share text */
    pendingShareText = buildShareText(gameId, newScore);

    /* reset share button */
    var shareBtn = document.getElementById('viral-share-btn');
    if (shareBtn) {
      shareBtn.innerHTML = '\u{1F4E4} Bagikan Rekormu!';
      shareBtn.onclick = onShareClick;
      shareBtn.style.pointerEvents = '';
    }

    /* ensure canvas size matches viewport (handles rotation) */
    if (confettiCanvas) {
      confettiCanvas.width = window.innerWidth;
      confettiCanvas.height = window.innerHeight;
    }

    /* show — force reflow so transition triggers even if re-shown quickly */
    overlay.classList.remove('viral-show');
    void overlay.offsetWidth;
    overlay.classList.add('viral-show');
    spawnConfetti();
  }

  function hide () {
    var wasVisible = isVisible();
    if (overlay) overlay.classList.remove('viral-show');
    stopConfetti();
    if (wasVisible && pendingCallback) {
      var cb = pendingCallback;
      pendingCallback = null;
      // Defer callback to next tick so overlay transition can start and
      // game code (startPlaying) doesn't run inside the click event's
      // propagation where it could be swallowed.
      setTimeout(function () { try { cb(); } catch (e) { console.error(e); } }, 30);
    } else if (!wasVisible) {
      // If hide called while not visible (e.g. double click), just clear
      pendingCallback = null;
    }
  }

  /* ------------------------------------------------------------------
     7. GLOBAL API
  ------------------------------------------------------------------ */
  window.ViralShare = { show: show, hide: hide, isVisible: isVisible };
})();

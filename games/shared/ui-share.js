/* ==========================================================================
   ui-share.js  —  Viral Share & High-Score Confetti (zero dependencies)
   Drop this script before each game's own <script> and call:
       ViralShare.show('kejar-koruptor', 12345);
   ========================================================================== */

;(function () {
  'use strict';

  /* ------------------------------------------------------------------
     0. GAME ID RESOLUTION
     Games call ViralShare.show('<slug>', score) using their folder slug
     (e.g. 'kicau-mania'), but the portal's canonical game IDs are the
     LOCAL_GAMES ids (e.g. 'local-kicau-mania'). Share links pointing at
     the raw slug would miss the server's LOCAL_GAMES lookup and land on
     a generic page — so map slug -> canonical id here. When a new
     first-party game is added, register it in this map.
  ------------------------------------------------------------------ */
  var GAME_ID_BY_SLUG = {
    'kicau-mania': 'local-kicau-mania',
    'ayo-kopdes': 'local-ayo-kopdes',
    'mobil-mbg': 'local-mobil-mbg',
    'kejar-koruptor': 'local-kejar-koruptor',
  };

  function resolveGameId (slug) {
    return GAME_ID_BY_SLUG[slug] || slug;
  }

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

  var BASE_URL = 'https://gimboot.com/play/';

  /**
   * Builds the share text: copy template + score + canonical deep link.
   * The link targets /play/<canonical-id>/<slug> — the SEO page whose OG
   * meta tags carry the game name, so a social-card debugger renders the
   * correct preview. The score travels in the share text (client-side
   * state never reaches the server — see knowledge.md §7), which is why
   * COPY templates end with an arrow pointing at the link.
   */
  function buildShareText (gameId, score) {
    var canonicalId = resolveGameId(gameId);
    var tpl = COPY[gameId] || COPY['kejar-koruptor'];
    var text = tpl.replace('{SKOR}', String(score));
    return text + BASE_URL + encodeURIComponent(canonicalId) + '/' + encodeURIComponent(slugify(gameId));
  }

  /** Mirrors js/utils.js's slugify — keep the two in sync. */
  function slugify (text) {
    return (
      String(text == null ? '' : text)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'game'
    );
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
    // any game subfolder. The stylesheet holds the full visual spec — there
    // is deliberately no inline <style> fallback: the Worker's strict CSP
    // (style-src 'self', no 'unsafe-inline', Task #014) blocks inline styles,
    // so any injected <style> would only produce console errors.
    try {
      if (!document.querySelector('link[href*="ui-share.css"]')) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/games/shared/ui-share.css';
        document.head.appendChild(link);
      }
    } catch (_) { /* ignore */ }
    try {
      if (document.querySelectorAll('style').length === 0) {
        console.warn('ViralShare: /games/shared/ui-share.css failed to load — share modal will be unstyled.');
      }
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

    /* --- modal overlay — built with DOM APIs to avoid innerHTML + Trusted Types --- */
    overlay = document.createElement('div');
    overlay.className = 'viral-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Rekor baru');

    var modal = document.createElement('div');
    modal.className = 'viral-modal';

    var trophy = document.createElement('div');
    trophy.className = 'viral-trophy';
    trophy.textContent = '\u{1F3C6}';
    modal.appendChild(trophy);

    var heading = document.createElement('p');
    heading.className = 'viral-heading';
    heading.textContent = '\u{1F389} SELAMAT! Rekor Baru! \u{1F389}';
    modal.appendChild(heading);

    var scoreEl = document.createElement('div');
    scoreEl.className = 'viral-score';
    scoreEl.id = 'viral-score';
    scoreEl.textContent = '0';
    modal.appendChild(scoreEl);

    var btns = document.createElement('div');
    btns.className = 'viral-btns';

    var shareBtn = document.createElement('button');
    shareBtn.className = 'viral-btn viral-btn-share';
    shareBtn.id = 'viral-share-btn';
    shareBtn.type = 'button';
    shareBtn.textContent = '\u{1F4E4} Bagikan Rekormu!';
    btns.appendChild(shareBtn);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'viral-btn viral-btn-close';
    closeBtn.id = 'viral-close-btn';
    closeBtn.type = 'button';
    closeBtn.textContent = '\u{1F519} Tutup / Main Lagi';
    btns.appendChild(closeBtn);

    modal.appendChild(btns);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    /* --- close button --- */
    closeBtn.addEventListener('click', hide);

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
    var orig = btn.textContent;
    btn.textContent = '\u2705 Teks Disalin!';
    btn.style.pointerEvents = 'none';
    setTimeout(function () {
      btn.textContent = orig;
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
      shareBtn.textContent = '\u{1F4E4} Bagikan Rekormu!';
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

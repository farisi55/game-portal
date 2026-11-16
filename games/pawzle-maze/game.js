(() => {
  'use strict';

  const LEVELS = {
    easy: { label: 'EASY', title: 'Labirin pemanasan', size: 7, algorithm: 'dfs', braid: 0.02, goalFraction: 0.65, color: '#78bf9b' },
    medium: { label: 'MEDIUM', title: 'Labirin penuh cabang', size: 14, algorithm: 'prim', braid: 0.10, color: '#e9b65e' },
    hard: { label: 'HARD', title: 'Labirin berliku', size: 18, algorithm: 'prim', braid: 0.19, color: '#ed9b71' },
    veryhard: { label: 'VERY HARD', title: 'Labirin kompleks', size: 24, algorithm: 'prim', braid: 0.28, color: '#e8899b' },
    nightmare: { label: 'NIGHTMARE', title: 'Labirin ekstrem tanpa ampun', size: 34, algorithm: 'prim', braid: 0.44, color: '#cf5572' }
  };

  const LEVEL_ORDER = Object.keys(LEVELS);
  const DIRS = {
    up: { x: 0, y: -1, keys: ['ArrowUp', 'w', 'W'] },
    down: { x: 0, y: 1, keys: ['ArrowDown', 's', 'S'] },
    left: { x: -1, y: 0, keys: ['ArrowLeft', 'a', 'A'] },
    right: { x: 1, y: 0, keys: ['ArrowRight', 'd', 'D'] }
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('maze-canvas');
  const ctx = canvas.getContext('2d');

  const els = {
    activeLevelName: $('active-level-name'), levelDot: $('level-dot'),
    mazeSize: $('maze-size-label'), gameStatus: $('game-status'),
    time: $('time-value'), steps: $('steps-value'), bestTime: $('best-time-value'),
    menuToggle: $('menu-toggle'), menu: $('ingame-menu'), menuBackdrop: $('menu-backdrop'), menuClose: $('menu-close'),
    menuLevelButtons: [...document.querySelectorAll('.menu-level')],
    directionButtons: [...document.querySelectorAll('.dpad-button[data-direction]')],
    restartButton: $('restart-button'), newMazeButton: $('new-maze-button'), menuNewMazeButton: $('menu-new-maze-button'),
    musicToggle: $('music-toggle'), musicLabel: $('music-label'), menuMusicButton: $('menu-music-button'),
    menuMusicLabel: $('menu-music-label'), musicSwitch: $('music-switch'),
    winModal: $('win-modal'), winLevelLabel: $('win-level-label'), completionTime: $('completion-time'),
    recordResult: $('record-result'), recordSummary: $('record-summary'), completionSteps: $('completion-steps'),
    completionBest: $('completion-best'), playAgainButton: $('play-again-button'), chooseLevelButton: $('choose-level-button'),
    nextLevelButton: $('next-level-button')
  };

  const state = {
    level: 'easy', maze: [], rows: 0, cols: 0,
    player: { x: 1, y: 1 }, goal: { x: 0, y: 0 },
    steps: 0, startedAt: null, elapsed: 0, won: false,
    menuOpen: false, bestTimes: loadBestTimes()
  };

  function loadBestTimes() {
    try {
      const parsed = JSON.parse(localStorage.getItem('pawzle-best-times') || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }

  function saveBestTimes() {
    try { localStorage.setItem('pawzle-best-times', JSON.stringify(state.bestTimes)); }
    catch (_) { /* Best time remains available for this session if storage is blocked. */ }
  }

  function loadMusicPreference() {
    try { return localStorage.getItem('pawzle-music-enabled') !== 'false'; }
    catch (_) { return true; }
  }

  function saveMusicPreference() {
    try { localStorage.setItem('pawzle-music-enabled', String(audio.enabled)); }
    catch (_) { /* Audio settings need not persist to play. */ }
  }

  function getGlobalBestTime() {
    const values = Object.values(state.bestTimes).map(Number).filter((value) => Number.isFinite(value) && value >= 0);
    return values.length ? Math.min(...values) : null;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }

  // Notify the host portal without coupling the game to a specific portal implementation.
  function emitPortalEvent(event, detail = {}) {
    const payload = { type: 'pawzle-maze', event, ...detail };
    window.dispatchEvent(new CustomEvent(`pawzle:${event}`, { detail: payload }));
    if (window.parent !== window) {
      const targetOrigin = new URLSearchParams(window.location.search).get('parentOrigin') || '*';
      window.parent.postMessage(payload, targetOrigin);
    }
  }

  // Generate either a long-corridor DFS maze or a branch-heavy randomized Prim maze.
  // Higher levels add carefully selected loops and place the fish at the farthest cell.
  function generateMaze(cellRows, cellCols, options = {}) {
    const height = cellRows * 2 + 1;
    const width = cellCols * 2 + 1;
    const grid = Array.from({ length: height }, () => Array(width).fill(1));
    const visited = Array.from({ length: cellRows }, () => Array(cellCols).fill(false));
    const directions = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
    const inBounds = (x, y) => x >= 0 && x < cellCols && y >= 0 && y < cellRows;
    const shuffle = (items) => {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    };
    const openCell = (x, y) => { grid[y * 2 + 1][x * 2 + 1] = 0; };

    openCell(0, 0);
    visited[0][0] = true;

    if (options.algorithm === 'prim') {
      const frontier = [];
      const addFrontier = (x, y) => {
        for (const d of directions) {
          const nx = x + d.x;
          const ny = y + d.y;
          if (inBounds(nx, ny) && !visited[ny][nx]) frontier.push({ x, y, nx, ny, dx: d.x, dy: d.y });
        }
      };
      addFrontier(0, 0);
      while (frontier.length) {
        const index = Math.floor(Math.random() * frontier.length);
        const edge = frontier.splice(index, 1)[0];
        if (visited[edge.ny][edge.nx]) continue;
        grid[edge.y * 2 + 1 + edge.dy][edge.x * 2 + 1 + edge.dx] = 0;
        visited[edge.ny][edge.nx] = true;
        openCell(edge.nx, edge.ny);
        addFrontier(edge.nx, edge.ny);
      }
    } else {
      const stack = [{ x: 0, y: 0 }];
      while (stack.length) {
        const current = stack[stack.length - 1];
        const candidates = shuffle(directions.filter((d) => {
          const nx = current.x + d.x;
          const ny = current.y + d.y;
          return inBounds(nx, ny) && !visited[ny][nx];
        }));
        if (!candidates.length) { stack.pop(); continue; }
        const direction = candidates[0];
        const nx = current.x + direction.x;
        const ny = current.y + direction.y;
        grid[current.y * 2 + 1 + direction.y][current.x * 2 + 1 + direction.x] = 0;
        visited[ny][nx] = true;
        openCell(nx, ny);
        stack.push({ x: nx, y: ny });
      }
    }

    const cellNeighbors = (x, y) => directions.map((d) => ({ x: x + d.x, y: y + d.y, d }))
      .filter((n) => inBounds(n.x, n.y));
    const connected = (x, y, neighbor) => grid[y * 2 + 1 + neighbor.d.y][x * 2 + 1 + neighbor.d.x] === 0;

    // Braid a percentage of dead ends. This creates loops, cross-connections and
    // misleading junctions instead of a predictable tree with obvious branches.
    const deadEnds = [];
    for (let y = 0; y < cellRows; y += 1) {
      for (let x = 0; x < cellCols; x += 1) {
        const degree = cellNeighbors(x, y).filter((n) => connected(x, y, n)).length;
        if (degree === 1 && (x !== 0 || y !== 0)) deadEnds.push({ x, y });
      }
    }
    shuffle(deadEnds);
    const braidRatio = Math.max(0, Math.min(0.6, Number(options.braid) || 0));
    let addedLoops = 0;
    for (const cell of deadEnds) {
      if (Math.random() > braidRatio) continue;
      const possibleLinks = cellNeighbors(cell.x, cell.y).filter((n) => !connected(cell.x, cell.y, n));
      if (!possibleLinks.length) continue;
      const link = randomItem(possibleLinks);
      grid[cell.y * 2 + 1 + link.d.y][cell.x * 2 + 1 + link.d.x] = 0;
      addedLoops += 1;
    }

    // Measure all routes after braiding. Higher levels use a farthest-cell target;
    // Easy selects a nearer cell from a controlled distance band.
    const distance = Array.from({ length: cellRows }, () => Array(cellCols).fill(-1));
    const queue = [{ x: 0, y: 0 }];
    distance[0][0] = 0;
    let head = 0;
    let farthestDistance = 0;
    let farthestCells = [{ x: 0, y: 0 }];
    while (head < queue.length) {
      const current = queue[head++];
      for (const neighbor of cellNeighbors(current.x, current.y)) {
        if (!connected(current.x, current.y, neighbor) || distance[neighbor.y][neighbor.x] !== -1) continue;
        distance[neighbor.y][neighbor.x] = distance[current.y][current.x] + 1;
        queue.push({ x: neighbor.x, y: neighbor.y });
        const nextDistance = distance[neighbor.y][neighbor.x];
        if (nextDistance > farthestDistance) {
          farthestDistance = nextDistance;
          farthestCells = [{ x: neighbor.x, y: neighbor.y }];
        } else if (nextDistance === farthestDistance) {
          farthestCells.push({ x: neighbor.x, y: neighbor.y });
        }
      }
    }
    let goalCell = randomItem(farthestCells);
    if (Number.isFinite(options.goalFraction) && options.goalFraction > 0 && options.goalFraction < 1) {
      const targetDistance = Math.max(2, Math.round(farthestDistance * options.goalFraction));
      const candidateCells = [];
      for (let y = 0; y < cellRows; y += 1) {
        for (let x = 0; x < cellCols; x += 1) {
          if (distance[y][x] >= targetDistance - 1 && distance[y][x] <= targetDistance + 1) candidateCells.push({ x, y });
        }
      }
      if (candidateCells.length) goalCell = randomItem(candidateCells);
    }
    const goalDistance = distance[goalCell.y][goalCell.x];
    const cellDegrees = [];
    for (let y = 0; y < cellRows; y += 1) {
      for (let x = 0; x < cellCols; x += 1) {
        cellDegrees.push(cellNeighbors(x, y).filter((n) => connected(x, y, n)).length);
      }
    }
    const junctions = cellDegrees.filter((degree) => degree >= 3).length;
    const remainingDeadEnds = cellDegrees.filter((degree) => degree === 1).length;

    return {
      grid,
      goal: { x: goalCell.x * 2 + 1, y: goalCell.y * 2 + 1 },
      metrics: { shortestPathCells: goalDistance, maxDistanceCells: farthestDistance, junctions, deadEnds: remainingDeadEnds, addedLoops }
    };
  }

  // All audio is synthesized locally using Web Audio; no external sound files are required.
  const audio = {
    context: null,
    enabled: loadMusicPreference(),
    musicTimer: null,
    noteIndex: 0,
    unlocked: false,
    melody: [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 698.46, 880, 783.99, 698.46, 659.25, 587.33],

    async unlock() {
      if (!this.enabled) return false;
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return false;
        if (!this.context) this.context = new AudioContextClass();
        if (this.context.state === 'suspended') await this.context.resume();
        this.unlocked = this.context.state === 'running';
        return this.unlocked;
      } catch (_) { return false; }
    },

    tone(frequency, duration, options = {}) {
      if (!this.context || this.context.state !== 'running') return;
      const { when = this.context.currentTime, type = 'sine', volume = 0.025 } = options;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), when + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(when);
      oscillator.stop(when + duration + 0.035);
    },

    async startMusic() {
      if (!this.enabled) return;
      const ready = await this.unlock();
      if (!ready || this.musicTimer || state.won || !this.enabled) return;
      const tick = () => {
        if (!this.context || this.context.state !== 'running' || !this.enabled || state.won) return;
        const now = this.context.currentTime;
        const note = this.melody[this.noteIndex % this.melody.length];
        this.tone(note, 0.32, { when: now, type: 'triangle', volume: 0.018 });
        if (this.noteIndex % 2 === 0) {
          const bassNotes = [130.81, 164.81, 196, 164.81, 146.83, 164.81];
          this.tone(bassNotes[Math.floor(this.noteIndex / 2) % bassNotes.length], 0.46, { when: now + 0.025, type: 'sine', volume: 0.009 });
        }
        this.noteIndex += 1;
      };
      tick();
      this.musicTimer = window.setInterval(tick, 420);
    },

    stopMusic() {
      if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    },

    async finishSound() {
      this.stopMusic();
      if (!this.enabled) return;
      const ready = await this.unlock();
      if (!ready || !this.enabled) return;
      const now = this.context.currentTime + 0.04;
      const notes = [659.25, 783.99, 987.77, 1318.51];
      notes.forEach((note, index) => this.tone(note, 0.42, { when: now + index * 0.14, type: 'triangle', volume: 0.045 }));
      [523.25, 659.25, 783.99].forEach((note) => this.tone(note, 0.72, { when: now + 0.62, type: 'sine', volume: 0.018 }));
    },

    async toggle() {
      this.enabled = !this.enabled;
      saveMusicPreference();
      updateMusicControls();
      if (this.enabled) {
        if (!state.won) await this.startMusic();
      } else {
        this.stopMusic();
      }
    }
  };

  function updateMusicControls() {
    const label = audio.enabled ? 'Musik ON' : 'Musik OFF';
    els.musicLabel.textContent = label;
    els.musicToggle.setAttribute('aria-pressed', String(audio.enabled));
    els.musicToggle.title = audio.enabled ? 'Matikan musik' : 'Aktifkan musik';
    els.menuMusicLabel.textContent = audio.enabled ? 'Matikan musik' : 'Aktifkan musik';
    els.musicSwitch.textContent = audio.enabled ? 'ON' : 'OFF';
    els.musicSwitch.classList.toggle('is-off', !audio.enabled);
  }

  function updateLevelControls() {
    const config = LEVELS[state.level];
    els.activeLevelName.textContent = config.label;
    els.levelDot.style.background = config.color;
    els.menuLevelButtons.forEach((button) => {
      const active = button.dataset.level === state.level;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function setLevel(level) {
    if (!LEVELS[level]) return;
    state.level = level;
    const config = LEVELS[level];
    updateLevelControls();
    state.rows = config.size;
    state.cols = config.size;
    const generated = generateMaze(state.rows, state.cols, config);
    state.maze = generated.grid;
    state.goal = generated.goal;
    state.mazeMetrics = generated.metrics;
    resetRun();
    els.mazeSize.textContent = `${config.size} × ${config.size} petak`;
    emitPortalEvent('level-change', { level, label: config.label, size: config.size, bestTime: state.bestTimes[level] ?? null, globalBestTime: getGlobalBestTime(), mazeMetrics: state.mazeMetrics });
  }

  function resetRun() {
    state.player = { x: 1, y: 1 };
    state.steps = 0;
    state.startedAt = null;
    state.elapsed = 0;
    state.won = false;
    els.winModal.hidden = true;
    els.gameStatus.textContent = 'Miko siap berangkat!';
    updateStats();
    drawMaze();
    if (audio.enabled && audio.context && audio.unlocked) audio.startMusic();
  }

  function createNewMaze() {
    const config = LEVELS[state.level];
    const generated = generateMaze(config.size, config.size, config);
    state.maze = generated.grid;
    state.goal = generated.goal;
    state.mazeMetrics = generated.metrics;
    resetRun();
  }

  function updateStats() {
    const currentElapsed = state.startedAt !== null && !state.won ? (Date.now() - state.startedAt) / 1000 : state.elapsed;
    els.time.textContent = formatTime(currentElapsed);
    els.steps.textContent = String(state.steps);
    const best = Number(state.bestTimes[state.level]);
    els.bestTime.textContent = Number.isFinite(best) && best >= 0 ? formatTime(best) : '—';
  }

  function openMenu() {
    if (state.menuOpen) return;
    state.menuOpen = true;
    els.menu.hidden = false;
    els.menuBackdrop.hidden = false;
    els.menuToggle.setAttribute('aria-expanded', 'true');
    const selected = els.menuLevelButtons.find((button) => button.dataset.level === state.level);
    if (selected) selected.focus();
  }

  function closeMenu(restoreFocus = true) {
    if (!state.menuOpen) return;
    state.menuOpen = false;
    els.menu.hidden = true;
    els.menuBackdrop.hidden = true;
    els.menuToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) els.menuToggle.focus();
  }

  function move(directionName) {
    if (state.won || state.menuOpen) return;
    const direction = DIRS[directionName];
    if (!direction || !state.maze.length) return;
    const nextX = state.player.x + direction.x;
    const nextY = state.player.y + direction.y;
    if (nextY < 0 || nextY >= state.maze.length || nextX < 0 || nextX >= state.maze[0].length) return;
    if (state.maze[nextY][nextX] !== 0) return;

    if (state.startedAt === null) state.startedAt = Date.now();
    state.player.x = nextX;
    state.player.y = nextY;
    state.steps += 1;
    audio.startMusic();

    if (nextX === state.goal.x && nextY === state.goal.y) finishGame();
    else els.gameStatus.textContent = 'Terus jalan, Miko!';
    updateStats();
    drawMaze();
  }

  function finishGame() {
    state.won = true;
    state.elapsed = state.startedAt !== null ? (Date.now() - state.startedAt) / 1000 : 0;
    const previousBest = Number(state.bestTimes[state.level]);
    const hadPreviousBest = Number.isFinite(previousBest) && previousBest >= 0;
    const isNewRecord = !hadPreviousBest || state.elapsed < previousBest;

    if (isNewRecord) {
      state.bestTimes[state.level] = state.elapsed;
      saveBestTimes();
    }

    els.gameStatus.textContent = 'Misi berhasil! Miko kenyang.';
    els.winLevelLabel.textContent = `LEVEL ${LEVELS[state.level].label} SELESAI`;
    els.completionTime.textContent = formatTime(state.elapsed);
    els.completionSteps.textContent = String(state.steps);
    const bestAfterFinish = Number(state.bestTimes[state.level]);
    els.completionBest.textContent = formatTime(bestAfterFinish);
    els.recordResult.classList.toggle('not-record', !isNewRecord);

    if (isNewRecord) {
      els.recordSummary.textContent = hadPreviousBest
        ? `REKOR BARU! Lebih cepat dari rekor sebelumnya (${formatTime(previousBest)}).`
        : 'REKOR PERTAMA! Ini catatan terbaik pertamamu untuk level ini.';
    } else {
      els.recordSummary.textContent = `Belum memecahkan rekor. Rekor terbaikmu tetap ${formatTime(previousBest)}.`;
    }

    const currentIndex = LEVEL_ORDER.indexOf(state.level);
    const hasNextLevel = currentIndex >= 0 && currentIndex < LEVEL_ORDER.length - 1;
    els.nextLevelButton.hidden = !hasNextLevel;
    if (hasNextLevel) {
      const nextLabel = LEVELS[LEVEL_ORDER[currentIndex + 1]].label;
      els.nextLevelButton.innerHTML = `Lanjut ke ${nextLabel === 'VERY HARD' ? 'Very Hard' : nextLabel[0] + nextLabel.slice(1).toLowerCase()} <span>→</span>`;
      els.nextLevelButton.dataset.nextLevel = LEVEL_ORDER[currentIndex + 1];
    }

    els.winModal.hidden = false;
    updateStats();
    audio.finishSound();
    emitPortalEvent('finish', {
      level: state.level, time: state.elapsed, steps: state.steps, newRecord: isNewRecord,
      bestTime: bestAfterFinish, globalBestTime: getGlobalBestTime(), mazeMetrics: state.mazeMetrics
    });
    if (isNewRecord) {
      ViralShare.show('pawzle-maze', formatTime(state.elapsed));
    }
    els.playAgainButton.focus();
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawCat(context, cx, cy, unit) {
    context.save();
    context.translate(cx, cy);
    const s = unit;
    context.fillStyle = 'rgba(50,43,83,.13)';
    context.beginPath(); context.ellipse(0, s * .31, s * .34, s * .12, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#f5b84f'; context.strokeStyle = '#8d633a'; context.lineWidth = Math.max(1, s * .045); context.lineJoin = 'round';
    context.beginPath(); context.moveTo(-s*.27,-s*.13); context.lineTo(-s*.34,-s*.48); context.lineTo(-s*.04,-s*.31); context.closePath(); context.fill(); context.stroke();
    context.beginPath(); context.moveTo(s*.27,-s*.13); context.lineTo(s*.34,-s*.48); context.lineTo(s*.04,-s*.31); context.closePath(); context.fill(); context.stroke();
    context.fillStyle = '#ef8e9b';
    context.beginPath(); context.moveTo(-s*.255,-s*.22); context.lineTo(-s*.295,-s*.405); context.lineTo(-s*.12,-s*.30); context.closePath(); context.fill();
    context.beginPath(); context.moveTo(s*.255,-s*.22); context.lineTo(s*.295,-s*.405); context.lineTo(s*.12,-s*.30); context.closePath(); context.fill();
    context.fillStyle = '#ffc96f'; context.strokeStyle = '#8d633a'; context.lineWidth = Math.max(1, s*.045);
    context.beginPath(); context.ellipse(0,0,s*.34,s*.32,0,0,Math.PI*2); context.fill(); context.stroke();
    context.fillStyle = 'rgba(238,125,143,.55)';
    context.beginPath(); context.ellipse(-s*.205,s*.095,s*.07,s*.045,-.2,0,Math.PI*2); context.fill();
    context.beginPath(); context.ellipse(s*.205,s*.095,s*.07,s*.045,.2,0,Math.PI*2); context.fill();
    context.fillStyle = '#443c5c';
    context.beginPath(); context.ellipse(-s*.125,-s*.045,s*.035,s*.055,0,0,Math.PI*2); context.fill();
    context.beginPath(); context.ellipse(s*.125,-s*.045,s*.035,s*.055,0,0,Math.PI*2); context.fill();
    context.fillStyle = '#fff';
    context.beginPath(); context.arc(-s*.135,-s*.065,s*.012,0,Math.PI*2); context.fill();
    context.beginPath(); context.arc(s*.115,-s*.065,s*.012,0,Math.PI*2); context.fill();
    context.fillStyle = '#e7798e';
    context.beginPath(); context.moveTo(-s*.045,s*.045); context.lineTo(s*.045,s*.045); context.lineTo(0,s*.095); context.closePath(); context.fill();
    context.strokeStyle = '#735044'; context.lineWidth = Math.max(.8,s*.025); context.lineCap = 'round';
    context.beginPath(); context.moveTo(0,s*.09); context.lineTo(0,s*.125); context.quadraticCurveTo(-s*.055,s*.17,-s*.095,s*.125); context.stroke();
    context.beginPath(); context.moveTo(0,s*.125); context.quadraticCurveTo(s*.055,s*.17,s*.095,s*.125); context.stroke();
    context.strokeStyle = 'rgba(113,81,66,.7)'; context.lineWidth = Math.max(.6,s*.018);
    for (const side of [-1,1]) {
      context.beginPath(); context.moveTo(side*s*.19,s*.07); context.lineTo(side*s*.32,s*.045); context.stroke();
      context.beginPath(); context.moveTo(side*s*.19,s*.12); context.lineTo(side*s*.31,s*.16); context.stroke();
    }
    context.restore();
  }

  function drawFish(context, cx, cy, unit) {
    context.save(); context.translate(cx, cy); const s = unit;
    context.fillStyle = 'rgba(50,43,83,.12)';
    context.beginPath(); context.ellipse(0,s*.3,s*.31,s*.1,0,0,Math.PI*2); context.fill();
    context.fillStyle = '#ee9b62'; context.strokeStyle = '#a56850'; context.lineWidth = Math.max(1,s*.035);
    context.beginPath(); context.moveTo(-s*.22,0); context.lineTo(-s*.43,-s*.2); context.lineTo(-s*.43,s*.2); context.closePath(); context.fill(); context.stroke();
    context.fillStyle = '#ffbf68';
    context.beginPath(); context.ellipse(s*.035,0,s*.3,s*.205,0,0,Math.PI*2); context.fill(); context.stroke();
    context.fillStyle = '#ed8c78';
    context.beginPath(); context.moveTo(-s*.02,-s*.16); context.lineTo(s*.04,-s*.31); context.lineTo(s*.17,-s*.16); context.closePath(); context.fill(); context.stroke();
    context.strokeStyle = 'rgba(213,126,88,.7)'; context.lineWidth = Math.max(1,s*.035);
    context.beginPath(); context.arc(s*.08,0,s*.15,-1.05,1.05); context.stroke();
    context.fillStyle = '#51445d'; context.beginPath(); context.arc(s*.22,-s*.045,s*.025,0,Math.PI*2); context.fill();
    context.strokeStyle = '#a56850'; context.lineWidth = Math.max(.8,s*.02);
    context.beginPath(); context.moveTo(s*.29,s*.045); context.quadraticCurveTo(s*.32,s*.065,s*.34,s*.04); context.stroke();
    context.restore();
  }

  function drawMaze() {
    if (!state.maze.length) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || 640;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const pixelSize = Math.max(1, Math.floor(cssWidth * dpr));
    if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
      canvas.width = pixelSize;
      canvas.height = pixelSize;
    }
    const logicalSize = pixelSize / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = state.maze[0].length;
    const height = state.maze.length;
    const unit = logicalSize / width;
    ctx.clearRect(0, 0, logicalSize, logicalSize);
    ctx.fillStyle = '#083d2d'; ctx.fillRect(0, 0, logicalSize, logicalSize);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x * unit;
        const py = y * unit;
        if (state.maze[y][x] === 1) {
          ctx.fillStyle = ((x + y) % 2 === 0) ? '#0b432f' : '#104b36';
          ctx.fillRect(px, py, unit + .35, unit + .35);
          ctx.fillStyle = 'rgba(223,255,232,.045)';
          ctx.fillRect(px + unit*.16, py + unit*.16, unit*.18, Math.max(1,unit*.045));
        } else {
          ctx.fillStyle = ((x + y) % 2 === 0) ? '#e4f2dc' : '#d9ebd3';
          ctx.fillRect(px, py, unit + .35, unit + .35);
          if ((x * 7 + y * 11) % 13 === 0) {
            ctx.fillStyle = 'rgba(86,143,103,.15)';
            ctx.beginPath(); ctx.arc(px + unit*.5, py + unit*.5, Math.max(.45,unit*.035), 0, Math.PI*2); ctx.fill();
          }
        }
      }
    }

    ctx.fillStyle = 'rgba(255,143,169,.32)';
    roundedRect(ctx, unit*1.08, unit*1.08, unit*.84, unit*.84, unit*.2); ctx.fill();
    ctx.fillStyle = 'rgba(255,204,83,.4)';
    roundedRect(ctx, state.goal.x*unit + unit*.08, state.goal.y*unit + unit*.08, unit*.84, unit*.84, unit*.2); ctx.fill();
    drawFish(ctx, (state.goal.x + .5)*unit, (state.goal.y + .5)*unit, unit*.92);
    drawCat(ctx, (state.player.x + .5)*unit, (state.player.y + .5)*unit, unit*1.18);
    ctx.strokeStyle = 'rgba(220,255,231,.22)'; ctx.lineWidth = 1;
    ctx.strokeRect(.5,.5,logicalSize-1,logicalSize-1);
  }

  function handleKeydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      if (state.menuOpen) { event.preventDefault(); closeMenu(); }
      return;
    }
    if (state.menuOpen || state.won) return;
    for (const [name, direction] of Object.entries(DIRS)) {
      if (direction.keys.includes(event.key)) {
        event.preventDefault();
        move(name);
        return;
      }
    }
  }

  function bindPointerControls() {
    let swipeStart = null;
    const drag = { active: false, pointerId: null, lastCell: null };

    function getGridCell(event) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.maze[0].length);
      const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.maze.length);
      if (x < 0 || y < 0 || y >= state.maze.length || x >= state.maze[0].length) return null;
      return { x, y };
    }

    function dragThroughCell(targetCell) {
      if (!targetCell || state.won || state.menuOpen || !drag.lastCell) return;
      let x = drag.lastCell.x;
      let y = drag.lastCell.y;
      let guard = state.maze.length + state.maze[0].length + 8;

      // A fast mouse can skip cells between pointermove events. Walk toward the
      // target one cardinal tile at a time, preferring the axis closest to it,
      // and only step into an open tile directly connected to Miko.
      while ((x !== targetCell.x || y !== targetCell.y) && guard-- > 0) {
        const dx = targetCell.x - x;
        const dy = targetCell.y - y;
        const candidates = [];
        if (dx !== 0) candidates.push({ x: x + Math.sign(dx), y, axis: 'x', priority: Math.abs(dx) >= Math.abs(dy) ? 0 : 1 });
        if (dy !== 0) candidates.push({ x, y: y + Math.sign(dy), axis: 'y', priority: Math.abs(dy) > Math.abs(dx) ? 0 : 1 });
        candidates.sort((a, b) => a.priority - b.priority);

        const next = candidates.find((candidate) => {
          if (candidate.y < 0 || candidate.y >= state.maze.length || candidate.x < 0 || candidate.x >= state.maze[0].length) return false;
          if (state.maze[candidate.y][candidate.x] !== 0) return false;
          return Math.abs(candidate.x - state.player.x) + Math.abs(candidate.y - state.player.y) === 1;
        });
        if (!next) break;

        const stepX = next.x - state.player.x;
        const stepY = next.y - state.player.y;
        const direction = stepX === 1 ? 'right' : stepX === -1 ? 'left' : stepY === 1 ? 'down' : 'up';
        move(direction);
        if (state.won) break;
        x = next.x;
        y = next.y;
      }
      // Keep the anchor at Miko's real position. If the pointer crosses a wall,
      // the next pointer event can continue from the actual character position.
      drag.lastCell = { x: state.player.x, y: state.player.y };
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') {
        if (state.won || state.menuOpen) return;
        const cell = getGridCell(event);
        // Begin dragging only when the user grabs Miko, not an arbitrary wall.
        if (!cell || cell.x !== state.player.x || cell.y !== state.player.y) return;
        drag.active = true;
        drag.pointerId = event.pointerId;
        drag.lastCell = cell;
        canvas.classList.add('is-dragging');
        try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Optional. */ }
        event.preventDefault();
        return;
      }
      swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
      try { canvas.setPointerCapture(event.pointerId); } catch (_) { /* Optional. */ }
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!drag.active || drag.pointerId !== event.pointerId) return;
      const cell = getGridCell(event);
      if (cell && (cell.x !== drag.lastCell.x || cell.y !== drag.lastCell.y)) {
        dragThroughCell(cell);
      }
      event.preventDefault();
    });

    function finishPointer(event) {
      if (drag.active && drag.pointerId === event.pointerId) {
        const finalCell = getGridCell(event);
        if (finalCell) dragThroughCell(finalCell);
        drag.active = false;
        drag.pointerId = null;
        drag.lastCell = null;
        canvas.classList.remove('is-dragging');
        return;
      }
      if (!swipeStart || swipeStart.id !== event.pointerId) return;
      const dx = event.clientX - swipeStart.x;
      const dy = event.clientY - swipeStart.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= 18) {
        if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
        else move(dy > 0 ? 'down' : 'up');
      }
      swipeStart = null;
    }

    canvas.addEventListener('pointerup', finishPointer);
    canvas.addEventListener('pointercancel', (event) => {
      if (drag.pointerId === event.pointerId) {
        drag.active = false;
        drag.pointerId = null;
        drag.lastCell = null;
        canvas.classList.remove('is-dragging');
      }
      if (swipeStart && swipeStart.id === event.pointerId) swipeStart = null;
    });
    canvas.addEventListener('lostpointercapture', () => {
      drag.active = false;
      drag.pointerId = null;
      drag.lastCell = null;
      canvas.classList.remove('is-dragging');
    });
  }

  // A real user gesture unlocks browser audio. Browsers intentionally block autoplay.
  window.addEventListener('pointerdown', () => {
    if (audio.enabled && !state.won) audio.startMusic();
  }, { once: true, capture: true });
  window.addEventListener('keydown', () => {
    if (audio.enabled && !state.won) audio.startMusic();
  }, { once: true, capture: true });

  els.menuToggle.addEventListener('click', openMenu);
  els.menuClose.addEventListener('click', () => closeMenu());
  els.menuBackdrop.addEventListener('click', () => closeMenu());
  els.menuLevelButtons.forEach((button) => button.addEventListener('click', () => {
    setLevel(button.dataset.level);
    closeMenu(false);
  }));
  els.directionButtons.forEach((button) => button.addEventListener('click', () => move(button.dataset.direction)));
  els.restartButton.addEventListener('click', () => { resetRun(); closeMenu(false); });
  els.newMazeButton.addEventListener('click', createNewMaze);
  els.menuNewMazeButton.addEventListener('click', () => { createNewMaze(); closeMenu(false); });
  els.musicToggle.addEventListener('click', () => audio.toggle());
  els.menuMusicButton.addEventListener('click', () => audio.toggle());
  els.playAgainButton.addEventListener('click', () => { resetRun(); });
  els.chooseLevelButton.addEventListener('click', () => { els.winModal.hidden = true; openMenu(); });
  els.nextLevelButton.addEventListener('click', () => {
    const next = els.nextLevelButton.dataset.nextLevel;
    if (LEVELS[next]) setLevel(next);
  });

  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', drawMaze);
  bindPointerControls();

  window.setInterval(() => {
    if (state.startedAt !== null && !state.won) updateStats();
  }, 200);

  updateMusicControls();
  setLevel('easy');
  emitPortalEvent('ready', { level: state.level, label: LEVELS[state.level].label, globalBestTime: getGlobalBestTime() });
})();

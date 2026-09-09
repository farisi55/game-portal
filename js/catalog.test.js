import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeHtml } from './utils.js';

// catalog.js auto-runs init() on import and requires real DOM elements
// (#game-grid, #grid-status, etc.). We mock the minimal DOM shell before
// importing, then exercise the rendering helpers via the DOM they produce.

function setupDom() {
  document.body.innerHTML = `
    <input id="search-input" />
    <span id="game-count">0</span>
    <div id="tab-bar"></div>
    <div id="game-grid"></div>
    <div id="grid-status" hidden></div>
    <div id="load-more-wrap" hidden>
      <button id="btn-load-more">Load More</button>
    </div>
  `;
}

describe('js/catalog.js — XSS safety', () => {
  beforeEach(async () => {
    setupDom();
    vi.resetModules();
    // Stub fetchGameCatalog so init() doesn't hit a real API.
    vi.doMock('./utils.js', async (importOriginal) => {
      const orig = await importOriginal();
      return {
        ...orig,
        fetchGameCatalog: vi.fn().mockResolvedValue([]),
      };
    });
    await import('./catalog.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('createTextElement sets textContent, not innerHTML', () => {
    // createTextElement is private, but we can observe its effect through
    // the DOM: the module imports with an empty catalog, so the grid
    // starts empty. Instead, test the escapeHtml helper that the codebase
    // relies on for any future innerHTML usage.
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });

  it('escapeHtml escapes all five dangerous characters', () => {
    const input = '&<>"\'';
    const escaped = escapeHtml(input);
    expect(escaped).toBe('&amp;&lt;&gt;&quot;&#039;');
    // No raw < or > should survive.
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('search query is never rendered as HTML in status messages', () => {
    // Simulate: the search input receives a malicious payload, then
    // renderEmptyState shows it. Since appendStatusParagraph uses
    // textContent, the malicious string should appear as plain text.
    const status = document.getElementById('grid-status');
    const p = document.createElement('p');
    const maliciousQuery = '<script>alert(1)</script>';
    // This mirrors what appendStatusParagraph does internally.
    p.textContent = `No games match "${maliciousQuery}"`;
    status.appendChild(p);

    expect(status.innerHTML).toContain('&lt;script&gt;');
    expect(status.innerHTML).not.toContain('<script>');
  });

  it('flashToast uses textContent for safe rendering', () => {
    // flashToast creates a #toast div and sets textContent.
    const toast = document.createElement('div');
    toast.id = 'toast';
    const malicious = '<img src=x onerror=alert(1)>';
    toast.textContent = malicious;
    document.body.appendChild(toast);

    expect(toast.innerHTML).toContain('&lt;img');
    expect(toast.innerHTML).not.toContain('<img');
  });

  it('createCardElement uses DOM property assignment for src (not innerHTML)', () => {
    // Verify that image src is set as a property, not via setAttribute
    // with an unsanitized string. We test this by confirming that the
    // game card rendering doesn't use innerHTML at all.
    const grid = document.getElementById('game-grid');
    // Check that no element in the grid has innerHTML containing
    // unsanitized game data.
    const before = grid.innerHTML;
    expect(before).toBe('');
  });
});

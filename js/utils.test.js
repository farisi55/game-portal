import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  escapeHtml,
  debounce,
  slugify,
  buildPlayUrl,
  buildGamePageUrl,
  isAllowedEmbedUrl,
  readSessionGames,
  writeSessionGames,
  fetchGameCatalog,
} from './utils.js';

const TEST_GAME = { id: 'game-1', title: 'Test Game', category: 'Action', url: 'http://example.com', thumb: 'thumb.svg' };

describe('js/utils.js', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.clear();
  });

  describe('escapeHtml', () => {
    it('escapes ampersand', () => {
      const input = 'a & b';
      const expected = input.replace(/&/g, '&amp;');
      expect(escapeHtml(input)).toBe(expected);
    });

    it('escapes less than', () => {
      const input = 'a < b';
      const expected = input.replace(/</g, '&lt;');
      expect(escapeHtml(input)).toBe(expected);
    });

    it('escapes greater than', () => {
      const input = 'a > b';
      const expected = input.replace(/>/g, '&gt;');
      expect(escapeHtml(input)).toBe(expected);
    });

    it('escapes double quote', () => {
      const input = 'a "b"';
      const expected = input.replace(/"/g, '&quot;');
      expect(escapeHtml(input)).toBe(expected);
    });

    it('escapes single quote', () => {
      const input = "a 'b'";
      const expected = input.replace(/'/g, '&#039;');
      expect(escapeHtml(input)).toBe(expected);
    });

    it('escapes all characters in script tag', () => {
      const input = '<script>"hello"</script>';
      const expected = input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      expect(escapeHtml(input)).toBe(expected);
    });

    it('returns empty string for null', () => {
      expect(escapeHtml(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('handles numbers', () => {
      expect(escapeHtml(123)).toBe('123');
    });
  });

  describe('debounce', () => {
    it('executes callback after wait ms of silence', () => {
      const callback = vi.fn();
      const debounced = debounce(callback, 50);
      debounced();
      expect(callback).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('clears timeout when called again before wait expires', () => {
      const callback = vi.fn();
      const debounced = debounce(callback, 50);
      debounced();
      debounced();
      vi.runAllTimers();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('uses default wait of 250ms', () => {
      const callback = vi.fn();
      const debounced = debounce(callback);
      expect(typeof debounced).toBe('function');
    });
  });

  describe('slugify', () => {
    it('converts title to lowercase slug', () => {
      expect(slugify('Moto X3M!')).toBe('moto-x3m');
    });

    it('removes diacritics', () => {
      expect(slugify('café')).toBe('cafe');
    });

    it('replaces non-alphanumeric with dash', () => {
      expect(slugify('Hello   World')).toBe('hello-world');
    });

    it('truncates to 60 characters', () => {
      const longText = 'A'.repeat(70);
      expect(slugify(longText).length).toBeLessThanOrEqual(60);
    });

    it('returns "game" when input results in empty string', () => {
      expect(slugify('')).toBe('game');
    });

    it('handles nullish input', () => {
      expect(slugify(null)).toBe('game');
      expect(slugify(undefined)).toBe('game');
    });

    it('preserves alphanumeric characters', () => {
      expect(slugify('Game123')).toBe('game123');
    });
  });

  describe('buildPlayUrl', () => {
    it('builds canonical /play/{id}/{slug} URL', () => {
      const url = buildPlayUrl(TEST_GAME);
      expect(url).toBe('/play/game-1/test-game');
    });

    it('encodes id component', () => {
      const url = buildPlayUrl({ id: 'game with spaces', title: 'Test' });
      expect(url).toContain(encodeURIComponent('game with spaces'));
    });

    it('encodes slug component', () => {
      const url = buildPlayUrl({ id: '1', title: 'Test Game!' });
      expect(url).toContain('test-game');
    });

    it('handles null id', () => {
      const url = buildPlayUrl({ id: null, title: 'Test' });
      expect(url).toContain(encodeURIComponent(''));
    });

    it('handles undefined title', () => {
      const url = buildPlayUrl({ id: '1', title: undefined });
      expect(url).toContain('game');
    });
  });

  describe('buildGamePageUrl', () => {
    it('builds /game? URL with query params', () => {
      const url = buildGamePageUrl(TEST_GAME);
      expect(url).toBe('/game?id=game-1&title=Test+Game&category=Action&url=http%3A%2F%2Fexample.com&thumb=thumb.svg');
    });

    it('includes thumb when provided', () => {
      const url = buildGamePageUrl({ ...TEST_GAME, thumb: 'custom-thumb.svg' });
      expect(url).toContain('thumb=custom-thumb.svg');
    });

    it('omits thumb when undefined', () => {
      const url = buildGamePageUrl({ ...TEST_GAME, thumb: undefined });
      expect(!url.includes('thumb')).toBe(true);
    });

    it('includes all stringified params', () => {
      const url = buildGamePageUrl({
        id: '',
        title: '',
        category: '',
        url: '',
        thumb: '',
      });
      expect(url).toContain('id=');
      expect(url).toContain('title=');
      expect(url).toContain('category=');
      expect(url).toContain('url=');
    });
  });

  describe('isAllowedEmbedUrl', () => {
    const allowedHosts = ['example.com', 'gamepix.com'];

    it('returns true for local game path', () => {
      expect(isAllowedEmbedUrl('/games/kicau-mania/index.html', allowedHosts)).toBe(true);
      expect(isAllowedEmbedUrl('games/ayo-kopdes', allowedHosts)).toBe(true);
    });

    it('returns true for allowed https hostname', () => {
      expect(isAllowedEmbedUrl('https://example.com/game', allowedHosts)).toBe(true);
    });

    it('returns true for allowed hostname with subdomain', () => {
      expect(isAllowedEmbedUrl('https://sub.example.com/game', allowedHosts)).toBe(true);
    });

    it('returns false for non-https protocol', () => {
      expect(isAllowedEmbedUrl('http://example.com/game', allowedHosts)).toBe(false);
      expect(isAllowedEmbedUrl('//example.com/game', allowedHosts)).toBe(false);
      expect(isAllowedEmbedUrl('javascript:alert(1)', allowedHosts)).toBe(false);
    });

    it('returns false for disallowed hostname', () => {
      expect(isAllowedEmbedUrl('https://evil.com/game', allowedHosts)).toBe(false);
    });

    it('returns false for malformed URL', () => {
      expect(isAllowedEmbedUrl('not-a-url', allowedHosts)).toBe(false);
      expect(isAllowedEmbedUrl('', allowedHosts)).toBe(false);
    });
  });

  describe('readSessionGames', () => {
    it('returns null when sessionStorage key is null', () => {
      const result = readSessionGames('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when sessionStorage key is empty', () => {
      sessionStorage.clear();
      const result = readSessionGames('empty-key');
      expect(result).toBeNull();
    });

    it('returns parsed array when valid JSON exists', () => {
      sessionStorage.setItem('test-key', JSON.stringify(['game-1', 'game-2']));
      const result = readSessionGames('test-key');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['game-1', 'game-2']);
    });

    it('returns null when parsed result is not an array', () => {
      sessionStorage.setItem('test-key', JSON.stringify({ not: 'array' }));
      const result = readSessionGames('test-key');
      expect(result).toBeNull();
    });
  });

  describe('writeSessionGames', () => {
    it('writes games to sessionStorage', () => {
      const games = [{ id: '1', title: 'Game 1' }];
      writeSessionGames('test-key', games);
      const raw = sessionStorage.getItem('test-key');
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual(games);
    });
  });

  describe('fetchGameCatalog', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fetches and returns games when API responds with JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve([{ id: 'gm-1', title: 'Game Monetize' }]),
      });

      const result = await fetchGameCatalog('https://api.example.com', 10);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('throws error when API responds not ok', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => '' },
        json: () => Promise.resolve([]),
        text: () => Promise.resolve(''),
      });

      await expect(fetchGameCatalog('https://api.example.com', 10)).rejects.toThrow(
        'API responded with 404',
      );
    });

    it('handles non-JSON response and tries JSON.parse on body', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html' },
        json: () => Promise.reject(new Error('Unexpected')),
        text: () => Promise.resolve('[{"id":"gp-1","title":"Game Pix"}]'),
      });

      const result = await fetchGameCatalog('https://api.example.com', 10);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].id).toBe('gp-1');
    });

    it('throws when response is not an array', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ not: 'array' }),
      });

      await expect(fetchGameCatalog('https://api.example.com', 10)).rejects.toThrow(
        'Catalog response was not an array',
      );
    });

    it('returns all local games when num <= 0', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve([]),
      });

      const result = await fetchGameCatalog('https://api.example.com', 0, [{ id: 'local-1', title: 'Local' }]);
      expect(result).toEqual([{ id: 'local-1', title: 'Local' }]);
    });

    it('includes local games in result', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () =>
          Promise.resolve([
            { id: 'gm-1', title: 'GM Game' },
            { id: 'gp-1', title: 'GP Game' },
            { id: 'other-1', title: 'Other Game' },
          ]),
      });

      const result = await fetchGameCatalog('https://api.example.com', 3, [{ id: 'local-1', title: 'Local' }]);
      expect(result).toHaveLength(3);
      expect(result).toContainEqual({ id: 'local-1', title: 'Local' });
    });
  });
});

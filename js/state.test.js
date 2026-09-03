import { describe, it, expect, afterEach } from 'vitest';
import { saveRecent, getRecentGames, toggleFavorite, getFavorites, isFavorite, removeFavorite } from './state.js';

const TEST_FAVORITE_ID = 'game-1';
const TEST_RECENT_ID = 'game-2';
const TEST_GAME_OBJ = { id: TEST_RECENT_ID, title: 'Test Game' };

describe('js/state.js', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('readArray', () => {
    it('returns empty array when localStorage key is null', () => {
      const result = (() => {
        try { return localStorage.getItem('test-key'); } catch { return null; }
      })();
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('returns empty array when localStorage key is undefined', () => {
      const result = localStorage.getItem('nonexistent-key');
      const parsed = result ? JSON.parse(result) : [];
      expect(Array.isArray(parsed) ? parsed : []).toEqual([]);
    });
  });

  describe('saveRecent', () => {
    it('saves a game to recently played and returns it first', () => {
      saveRecent(TEST_GAME_OBJ);
      const recent = getRecentGames();
      expect(recent).toHaveLength(1);
      expect(recent[0].id).toBe(TEST_RECENT_ID);
    });

    it('does not save if gameObj is falsy', () => {
      saveRecent(null);
      saveRecent(undefined);
      const recent = getRecentGames();
      expect(recent).toHaveLength(0);
    });

    it('does not save if gameObj has no id', () => {
      saveRecent({ title: 'No ID' });
      const recent = getRecentGames();
      expect(recent).toHaveLength(0);
    });

    it('handles FIFO order - duplicates moved to front', () => {
      saveRecent({ id: 'a', title: 'A' });
      saveRecent({ id: 'b', title: 'B' });
      saveRecent({ id: 'a', title: 'A again' });
      const recent = getRecentGames();
      expect(recent).toHaveLength(2);
      expect(recent[0].id).toBe('a');
      expect(recent[1].id).toBe('b');
    });

    it('caps recent list at RECENT_LIMIT (20)', () => {
      for (let i = 0; i < 25; i++) {
        saveRecent({ id: `game-${i}`, title: `Game ${i}` });
      }
      const recent = getRecentGames();
      expect(recent).toHaveLength(20);
      expect(recent[0].id).toBe('game-24');
    });
  });

  describe('getRecentGames', () => {
    it('returns recently played games most recent first', () => {
      saveRecent({ id: 'a', title: 'A' });
      saveRecent({ id: 'b', title: 'B' });
      const recent = getRecentGames();
      expect(recent).toHaveLength(2);
      expect(recent[0].id).toBe('b');
      expect(recent[1].id).toBe('a');
    });

    it('returns empty array when no games played', () => {
      const recent = getRecentGames();
      expect(recent).toEqual([]);
    });
  });

  describe('toggleFavorite', () => {
    it('adds a game to favorites when not present', () => {
      const result = toggleFavorite({ id: TEST_FAVORITE_ID, title: 'Test' });
      expect(result).toBe(true);
      expect(isFavorite(TEST_FAVORITE_ID)).toBe(true);
    });

    it('removes a game from favorites when present', () => {
      toggleFavorite({ id: TEST_FAVORITE_ID, title: 'Test' });
      const result = toggleFavorite({ id: TEST_FAVORITE_ID, title: 'Test' });
      expect(result).toBe(false);
      expect(isFavorite(TEST_FAVORITE_ID)).toBe(false);
    });

    it('returns false if gameObj is falsy', () => {
      expect(toggleFavorite(null)).toBe(false);
      expect(toggleFavorite(undefined)).toBe(false);
    });

    it('returns false if gameObj has no id', () => {
      expect(toggleFavorite({ title: 'No ID' })).toBe(false);
    });

    it('preserves other favorites when toggling one', () => {
      toggleFavorite({ id: 'game-1', title: 'Game 1' });
      toggleFavorite({ id: 'game-2', title: 'Game 2' });
      expect(getFavorites()).toHaveLength(2);
      expect(isFavorite('game-1')).toBe(true);
      expect(isFavorite('game-2')).toBe(true);
    });
  });

  describe('getFavorites', () => {
    it('returns favorite games when favorites exist', () => {
      toggleFavorite({ id: 'fav-1', title: 'Favorite 1' });
      const favs = getFavorites();
      expect(favs).toHaveLength(1);
      expect(favs[0].id).toBe('fav-1');
    });

    it('returns empty array when no favorites', () => {
      const favs = getFavorites();
      expect(favs).toEqual([]);
    });
  });

  describe('isFavorite', () => {
    it('returns true for a favorited game', () => {
      toggleFavorite({ id: 'test-id', title: 'Test' });
      expect(isFavorite('test-id')).toBe(true);
    });

    it('returns false for a non-favorited game', () => {
      expect(isFavorite('never-favorited')).toBe(false);
    });

    it('returns false when no favorites', () => {
      expect(isFavorite('any-id')).toBe(false);
    });
  });

  describe('removeFavorite', () => {
    it('removes a game from favorites', () => {
      toggleFavorite({ id: 'remove-this', title: 'To Remove' });
      removeFavorite('remove-this');
      expect(isFavorite('remove-this')).toBe(false);
      expect(getFavorites()).toHaveLength(0);
    });

    it('does nothing if gameId not in favorites', () => {
      removeFavorite('nonexistent');
      expect(getFavorites()).toEqual([]);
    });
  });
});
// Unit tests for js/ad-loader.js — ad script loading with timeout fallback.
//
// Runs in the jsdom environment (vitest.config.js) so document APIs are
// available.  Script load/error events are simulated by firing the
// corresponding callback on the created <script> element.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadScriptWithTimeout } from './ad-loader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock <script> element that tracks appendChild calls. */
function createMockScript() {
  const el = {
    src: '',
    async: false,
    onload: null,
    onerror: null,
    remove: vi.fn(),
  };
  return el;
}

let appendSpy;
let originalCreateElement;

beforeEach(() => {
  // Intercept document.createElement to return our controllable mock
  originalCreateElement = document.createElement.bind(document);
  appendSpy = vi.fn();

  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'script') return createMockScript();
    return originalCreateElement(tag);
  });

  vi.spyOn(document.head, 'appendChild').mockImplementation((el) => {
    appendSpy(el);
    return el;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadScriptWithTimeout', () => {
  it('resolves true when script fires onload', async () => {
    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/ad.js');

    // Simulate successful load
    script.onload();

    const result = await promise;
    expect(result).toBe(true);
    expect(script.src).toBe('https://example.com/ad.js');
    expect(script.async).toBe(true);
    expect(appendSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves false when script fires onerror', async () => {
    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/bad.js');

    // Simulate load error
    script.onerror();

    const result = await promise;
    expect(result).toBe(false);
  });

  it('resolves false and removes element on timeout', async () => {
    vi.useFakeTimers();

    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/slow.js', {
      timeout: 3000,
    });

    // Advance past the timeout
    vi.advanceTimersByTime(3001);

    const result = await promise;
    expect(result).toBe(false);
    expect(script.remove).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('resolves false for null/undefined src', async () => {
    expect(await loadScriptWithTimeout(null)).toBe(false);
    expect(await loadScriptWithTimeout(undefined)).toBe(false);
    expect(await loadScriptWithTimeout('')).toBe(false);
  });

  it('uses default timeout of 3000ms', async () => {
    vi.useFakeTimers();

    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/ad.js');

    // At 2999ms — should NOT have timed out yet
    vi.advanceTimersByTime(2999);
    expect(script.remove).not.toHaveBeenCalled();

    // At 3000ms — should time out
    vi.advanceTimersByTime(1);
    const result = await promise;
    expect(result).toBe(false);
    expect(script.remove).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('respects custom timeout option', async () => {
    vi.useFakeTimers();

    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/ad.js', {
      timeout: 1000,
    });

    vi.advanceTimersByTime(1001);

    const result = await promise;
    expect(result).toBe(false);

    vi.useRealTimers();
  });

  it('appends script to custom container when specified', async () => {
    const container = document.createElement('div');
    const appendToContainer = vi.fn();
    container.appendChild = appendToContainer;

    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/ad.js', {
      container,
    });

    script.onload();
    await promise;

    expect(appendSpy).not.toHaveBeenCalled();
    expect(appendToContainer).toHaveBeenCalledWith(script);
  });

  it('does not fire resolve twice (onload after timeout)', async () => {
    vi.useFakeTimers();

    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/ad.js', {
      timeout: 1000,
    });

    // Time out first
    vi.advanceTimersByTime(1001);
    const result1 = await promise;
    expect(result1).toBe(false);

    // Then try to fire onload (race condition)
    script.onload();

    // Should still be false — the promise already resolved
    const result2 = await promise;
    expect(result2).toBe(false);

    vi.useRealTimers();
  });

  it('does not fire resolve twice (timeout after onload)', async () => {
    vi.useFakeTimers();

    const script = createMockScript();
    document.createElement.mockReturnValueOnce(script);

    const promise = loadScriptWithTimeout('https://example.com/ad.js', {
      timeout: 1000,
    });

    // Load first
    script.onload();
    const result1 = await promise;
    expect(result1).toBe(true);

    // Then try to time out (race condition)
    vi.advanceTimersByTime(1001);

    // Should still be true — the promise already resolved
    const result2 = await promise;
    expect(result2).toBe(true);

    vi.useRealTimers();
  });
});

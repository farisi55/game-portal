// ============================================================================
// Ad script loader with timeout fallback for GameMonetize/GamePix integration.
//
// Loads external ad scripts with a configurable timeout. If the script fails
// to load within the timeout, the page continues without ads — the game
// remains fully playable. Errors from ad networks are silently caught to
// prevent unhandled exceptions from breaking the page.
//
// Usage:
//   import { loadScriptWithTimeout } from '/js/ad-loader.js';
//   loadScriptWithTimeout('https://example.com/ad.js');
// ============================================================================

/** Default maximum time (ms) to wait for an ad script before giving up. */
const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Loads an external script element with a timeout fallback.
 *
 * @param {string} src - The script URL to load.
 * @param {object} [options] - Configuration overrides.
 * @param {number}  [options.timeout]   - Max wait in ms (default 3000).
 * @param {HTMLElement} [options.container] - Parent element (default document.head).
 * @returns {Promise<boolean>} `true` if the script fired `onload`, `false` on
 *   timeout, error, or invalid input.
 */
export function loadScriptWithTimeout(src, options = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, container = document.head } = options;

  return new Promise((resolve) => {
    if (!src || typeof document === 'undefined') {
      resolve(false);
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;

    let settled = false;

    const done = (loaded) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(loaded);
    };

    script.onload = () => done(true);
    script.onerror = () => done(false);

    const timer = setTimeout(() => {
      if (!settled) {
        script.remove();
        done(false);
      }
    }, timeout);

    container.appendChild(script);
  });
}

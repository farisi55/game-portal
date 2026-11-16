// ============================================================================
// functions/game.js — Server-side SEO renderer for the canonical game page.
//
// DEPLOYMENT NOTE
// ---------------
// This repository is deployed as a Cloudflare Worker with static assets
// (`wrangler.toml` -> `main = "./src/index.js"`), not as Cloudflare Pages
// Functions. `functions/` is listed in `.assetsignore`, so this module is
// bundled into the Worker by `src/index.js` and is never served as a static
// file. Route interception lives in `src/index.js`; this module owns every
// HTMLRewriter transformation so the edge-rendering logic stays in the file
// the SEO task asked for and still runs in production.
//
// WHY THE CANONICAL IS /play/{id}/{slug}
// --------------------------------------
// The repo already migrated every internal game link, the sitemap, the share
// flow, and GSC remediation to path-based /play URLs. Making /game?id={id}
// the canonical would reintroduce exactly the query-string duplicates this
// task is trying to remove. /game and /game.html are therefore single-hop
// 301s to the canonical /play URL. This renderer runs on that canonical page.
// ============================================================================

export const SITE_NAME = 'Gimboot';
export const SITE_ORIGIN = 'https://gimboot.com';
export const SITE_ROOT = `${SITE_ORIGIN}/`;

const META_DESCRIPTION_MAX = 158;
const BODY_DESCRIPTION_MAX = 700;

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  rarr: '\u2192',
  larr: '\u2190',
  uarr: '\u2191',
  darr: '\u2193',
  middot: '\u00b7',
  bull: '\u2022',
  zwj: '',
};

/** Decodes HTML entities (named + numeric) with a two-pass approach. */
export function decodeEntities(str) {
  let out = String(str ?? '');
  for (let pass = 0; pass < 2; pass += 1) {
    out = out
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
        try {
          return String.fromCodePoint(parseInt(code, 16));
        } catch {
          return '';
        }
      })
      .replace(/&#(\d+);/g, (_, code) => {
        try {
          return String.fromCodePoint(Number(code));
        } catch {
          return '';
        }
      })
      .replace(/&([a-zA-Z]+);/g, (match, name) =>
        name in ENTITY_MAP ? ENTITY_MAP[name] : match
      );
  }
  return out;
}

/** Mirrors js/utils.js's slugify exactly — keep the two in sync. */
export function slugify(text) {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'game'
  );
}

/** Escapes a string for safe insertion into HTML text or an attribute. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const escapeHtmlAttr = escapeHtml;

/**
 * Escapes a JSON-LD object for safe embedding inside a
 * <script type="application/ld+json"> tag. HTML entities are NOT decoded
 * inside script data, so `</script`, `<!--`, and `-->` must be escaped.
 */
export function escapeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Absolute /play path for a game. This is the only canonical game URL form. */
export function gameCanonicalPath(game) {
  const id = encodeURIComponent(String(game?.id ?? ''));
  const slug = slugify(game?.title);
  return `/play/${id}/${slug}`;
}

/** Absolute canonical URL for a game. */
export function gameCanonicalUrl(game, origin = SITE_ORIGIN) {
  return `${origin}${gameCanonicalPath(game)}`;
}

/** Resolves a relative URL against the production origin, or returns ''. */
export function absoluteUrl(maybeRelative, origin = SITE_ORIGIN) {
  if (!maybeRelative) return '';
  try {
    return new URL(String(maybeRelative), origin).toString();
  } catch {
    return '';
  }
}

/** Resolves an image URL and falls back to the site icon for unsafe values. */
export function safeImageUrl(maybeRelative, origin = SITE_ORIGIN) {
  const absolute = absoluteUrl(maybeRelative, origin);
  try {
    const parsed = new URL(absolute);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // fall through to the default icon
  }
  return `${origin}/icon-512.png`;
}

/**
 * Transforms the static game shell into a fully server-rendered game page.
 *
 * The transformation is deliberately idempotent: every tag this function owns
 * is removed first, then re-added exactly once. That prevents a hand-written
 * or previously injected canonical/OG/JSON-LD tag from creating duplicates.
 *
 * @param {Response} assetResponse Raw `game.html` response from env.ASSETS.
 * @param {object} game Normalized game record from the catalog.
 * @param {{ origin?: string, siteName?: string }} [options]
 * @returns {Response}
 */
export function renderGamePage(assetResponse, game, options = {}) {
  const origin = options.origin || SITE_ORIGIN;
  const siteName = options.siteName || SITE_NAME;
  const canonicalUrl = gameCanonicalUrl(game, origin);
  const seo = buildGameSeo(game, { origin, siteName, canonicalUrl });
  const headExtra = buildHeadExtra(game, seo, { origin, siteName });
  const bodyHtml = buildBodySection(game, seo, { siteName });

  return new HTMLRewriter()
    .on('html', new SetAttribute('lang', 'id'))
    .on('link[rel="canonical"]', new RemoveElement())
    .on('meta[name="description"]', new RemoveElement())
    .on('meta[name="robots"]', new RemoveElement())
    .on('meta[property^="og:"]', new RemoveElement())
    .on('meta[name^="twitter:"]', new RemoveElement())
    .on('meta[name^="gimboot-play-"]', new RemoveElement())
    .on('script[type="application/ld+json"]', new RemoveElement())
    .on('title', new SetTextContent(seo.title))
    .on('head', new AppendHtml(headExtra))
    .on('#game-title', new SetTextContent(game.title))
    .on('#game-category', new SetTextContent(game.category || 'Game'))
    .on('#game-frame', new SetAttribute('title', `${game.title} — main gratis di ${siteName}`))
    .on('main', new AppendHtml(bodyHtml))
    .transform(assetResponse);
}

function buildGameSeo(game, { origin, siteName, canonicalUrl }) {
  const title = `${game.title} - Main Gratis di ${siteName}`;
  const category = String(game.category || 'Game').trim() || 'Game';
  const rawDescription = plainText(game.description, BODY_DESCRIPTION_MAX);
  const longDescription =
    rawDescription || defaultDescription(game, category, siteName);
  const description = truncateText(
    `${longDescription} Main gratis tanpa download di ${siteName}.`,
    META_DESCRIPTION_MAX
  );
  const howToPlay = buildHowToPlay(game, category, siteName);
  const imageUrl = safeImageUrl(game.thumb, origin);

  return {
    title,
    category,
    description,
    longDescription,
    howToPlay,
    imageUrl,
    canonicalUrl,
  };
}

function buildHeadExtra(game, seo, { origin, siteName }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.title,
    description: seo.longDescription,
    genre: seo.category,
    url: seo.canonicalUrl,
    image: seo.imageUrl,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Windows, Android, iOS, macOS',
    gamePlatform: 'Web Browser',
    playMode: 'SinglePlayer',
    inLanguage: 'id-ID',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'IDR',
      category: 'free',
    },
    publisher: {
      '@type': 'Organization',
      name: siteName,
      url: origin,
    },
  };

  return [
    `<link rel="canonical" href="${escapeHtmlAttr(seo.canonicalUrl)}">`,
    `<meta name="description" content="${escapeHtmlAttr(seo.description)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${escapeHtmlAttr(siteName)}">`,
    '<meta property="og:locale" content="id_ID">',
    `<meta property="og:title" content="${escapeHtmlAttr(seo.title)}">`,
    `<meta property="og:description" content="${escapeHtmlAttr(seo.description)}">`,
    `<meta property="og:image" content="${escapeHtmlAttr(seo.imageUrl)}">`,
    `<meta property="og:image:alt" content="${escapeHtmlAttr(`${game.title} — ${siteName}`)}">`,
    `<meta property="og:url" content="${escapeHtmlAttr(seo.canonicalUrl)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtmlAttr(seo.title)}">`,
    `<meta name="twitter:description" content="${escapeHtmlAttr(seo.description)}">`,
    `<meta name="twitter:image" content="${escapeHtmlAttr(seo.imageUrl)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtmlAttr(`${game.title} — ${siteName}`)}">`,
    `<meta name="gimboot-play-id" content="${escapeHtmlAttr(game.id)}">`,
    `<meta name="gimboot-play-url" content="${escapeHtmlAttr(game.url || '')}">`,
    `<meta name="gimboot-play-title" content="${escapeHtmlAttr(game.title)}">`,
    `<meta name="gimboot-play-category" content="${escapeHtmlAttr(game.category || '')}">`,
    `<meta name="gimboot-play-image" content="${escapeHtmlAttr(seo.imageUrl)}">`,
    `<meta name="gimboot-play-width" content="${escapeHtmlAttr(game.width ?? '')}">`,
    `<meta name="gimboot-play-height" content="${escapeHtmlAttr(game.height ?? '')}">`,
    `<script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>`,
  ].join('\n');
}

function buildBodySection(game, seo, { siteName }) {
  const title = escapeHtml(game.title);
  const category = escapeHtml(seo.category);

  return `
<section class="game-info game-seo" id="game-seo-content" aria-labelledby="game-seo-title">
  <h2 id="game-seo-title">Tentang ${title}</h2>
  <p>${escapeHtml(seo.longDescription)}</p>

  <h2>Cara Bermain ${title}</h2>
  <p>${escapeHtml(seo.howToPlay)}</p>

  <h2>Fitur ${title}</h2>
  <ul class="game-features">
    <li>Main ${title} gratis di browser — tanpa download, tanpa instal.</li>
    <li>Bisa dimainkan di Windows, Android, iOS, dan macOS.</li>
    <li>Kontrol keyboard, mouse, atau layar sentuh.</li>
    <li>Mode layar penuh untuk pengalaman bermain yang lebih imersif.</li>
    <li>Tanpa registrasi atau akun.</li>
  </ul>

  <p>Cari game ${category} lainnya di <a href="/">katalog game gratis ${escapeHtml(siteName)}</a>.</p>
</section>`;
}

function buildHowToPlay(game, category, siteName) {
  const key = category.toLowerCase();
  let controls = 'gunakan tombol panah, WASD, mouse, atau layar sentuh sesuai kontrol yang tampil di dalam game';

  if (key.includes('racing')) {
    controls = 'gunakan tombol panah atau WASD untuk mengemudi, mengerem, dan menikung';
  } else if (key.includes('puzzle')) {
    controls = 'klik atau ketuk objek untuk memindahkan, mencocokkan, atau memecahkan teka-teki';
  } else if (key.includes('card')) {
    controls = 'klik kartu untuk memilih, memindahkan, atau menumpuknya sesuai aturan permainan';
  } else if (key.includes('moba')) {
    controls = 'gunakan WASD untuk bergerak, mouse untuk menargetkan, dan tombol kemampuan untuk menyerang';
  } else if (key.includes('action') || key.includes('shooter')) {
    controls = 'gunakan tombol arah atau WASD untuk bergerak, lalu mouse atau tombol aksi untuk menyerang';
  }

  return `Buka ${game.title} di ${siteName}, tekan tombol Play Now, lalu ${controls}. Jika bingung, ikuti petunjuk yang tampil di layar game. Tekan Full Screen untuk pengalaman yang lebih luas, dan mainkan dengan ritme Anda sendiri — tidak ada batas waktu untuk mulai.`;
}

function defaultDescription(game, category, siteName) {
  return `${game.title} adalah game ${category} gratis yang bisa dimainkan langsung di browser. Tanpa download, tanpa instal, dan tanpa registrasi — cukup buka halaman ini dan tekan Play Now di ${siteName}.`;
}

function plainText(value, maxLength = 0) {
  let text = String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  text = decodeEntities(text).replace(/\s+/g, ' ').trim();
  return maxLength > 0 ? truncateText(text, maxLength) : text;
}

function truncateText(text, maxLength) {
  const normalized = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;

  const sliced = normalized.slice(0, maxLength - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const safeCut = lastSpace > maxLength * 0.6 ? sliced.slice(0, lastSpace) : sliced;
  return `${safeCut.trim()}…`;
}

export class SetTextContent {
  constructor(content) {
    this.content = content;
  }

  element(element) {
    element.setInnerContent(this.content);
  }
}

export class SetAttribute {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }

  element(element) {
    // workerd's setAttribute does not entity-encode the value, so a title
    // containing `"` or `<` would break out of the attribute. Escape here.
    element.setAttribute(this.name, escapeHtml(this.value));
  }
}

export class AppendHtml {
  constructor(html) {
    this.html = html;
  }

  element(element) {
    element.append(this.html, { html: true });
  }
}

export class RemoveElement {
  element(element) {
    element.remove();
  }
}

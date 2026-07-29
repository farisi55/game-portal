// Extends the Tailwind Play CDN's default theme with the arcade palette so
// utility classes like `bg-ink` or `text-gold` line up with the CSS custom
// properties defined in css/style.css. Loaded as an external file (instead
// of an inline <script>) so the site's CSP can keep script-src free of
// 'unsafe-inline'.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        ink: '#0e0b1a',
        surface: '#171129',
        cyan: '#35e4e0',
        magenta: '#ff3d9a',
        gold: '#ffc542',
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['Space Mono', 'monospace'],
      },
    },
  },
};

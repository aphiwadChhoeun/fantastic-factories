/**
 * Tailwind v4 is a PostCSS plugin and nothing else — there is no
 * `tailwind.config.js`, because the theme is declared in CSS. Everything the
 * design system knows about lives in `src/app/globals.css` under `@theme`.
 */
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;

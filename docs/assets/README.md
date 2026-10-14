# README artwork

The poster and optional eight-second GIF are illustrated product studies, not captured UI.
An editorial page, a contact sheet, a matching pair, and a ticket describe the product in the site's
visual language. The stable poster is the README's main image; motion is behind a disclosure.

[`product-study.html`](product-study.html) is editable HTML/CSS/SVG. The timeline exposes
`renderFrame(seconds)` so every output is sampled deterministically. It draws from the actual
`:root` tokens in [`globals.css`](../../src/styles/globals.css), and renders the repository's
Lora and Geist Mono font files. No new font or application dependency is introduced.

With project dependencies installed, Chromium available to Playwright, and FFmpeg on PATH:

```bash
node docs/assets/render.mjs
```

To use an installed Chrome, set `README_BROWSER_CHANNEL=chrome`. Otherwise, if needed, install the browser with `pnpm exec playwright install chromium`. The renderer uses a
loopback-only temporary server and removes its temporary frames. It writes `milk-and-henny.png`
and `milk-and-henny.gif` beside the source. `README_REVIEW_DIR` optionally retains sampled review
frames outside the repository. `README_PLAYWRIGHT_MODULE` can point to an existing artifact
runtime's Playwright module instead of the project's installation.

Keep the GIF visually quiet and preserve its closed loop. Review the poster at README width and
sample the card flip, ticket mark, and reset when revising it. Fonts retain their licenses in
[`public/fonts`](../../public/fonts/README.md).

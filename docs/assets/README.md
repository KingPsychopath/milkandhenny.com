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

## Pairs recovery demo

`pairs-recovery.gif` and `pairs-recovery.mp4` show the real Pairs application in an editorial recording
frame. Alex and Jo play on one shared device, match a pair, reload the page, and resume with the
same score and cleared cards. `pairs-recovery.png` is the final still. The capture checks the score,
remaining cards, and exact recovered command journal before exporting.

[`capture-pairs.mjs`](capture-pairs.mjs) drives ordinary UI controls and captures live frames.
[`demo-frame.html`](demo-frame.html) supplies only the surrounding title and step captions. It does
not change the application, seed storage, or mock server responses. Setup occurs before recording;
the two matching card clicks are chosen from the actual randomly generated shuffle. This is a
shared-device recovery demo, not a multiplayer network or production-health claim.

Run the local app, then capture it in a separate terminal:

```bash
README_BROWSER_CHANNEL=chrome README_DEMO_URL=http://127.0.0.1:3000 \
  README_DEMO_COMMIT=$(git rev-parse HEAD) node --import tsx docs/assets/capture-pairs.mjs
```

The capture refuses non-local hosts. It needs the repository dependencies, an available Playwright
browser, and FFmpeg. Omit `README_BROWSER_CHANNEL` to use Playwright's installed Chromium.
`pairs-recovery.json` records the source commit, scenario, checks, and presentation choices.

The committed capture uses an isolated local app with no hosted credentials. Pairs runs in the
browser and does not need a database for this scenario.

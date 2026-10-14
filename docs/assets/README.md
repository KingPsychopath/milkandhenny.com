# Documentation visuals

The README uses a product illustration, a recorded Pairs game, and an architecture diagram.
All use the site's theme tokens, Lora, and Geist Mono. Font licenses are in
[public/fonts](../../public/fonts/README.md).

## Product illustration

[`product-study.html`](product-study.html) draws the editorial page, contact sheet, matching cards,
and ticket used in `milk-and-henny.png`.

```bash
README_BROWSER_CHANNEL=chrome node docs/assets/render.mjs
```

The renderer reads tokens from [globals.css](../../src/styles/globals.css), serves fonts through a
temporary loopback-only server, and writes the poster beside its source.

## Pairs recovery demo

[`capture-pairs.mjs`](capture-pairs.mjs) records the local application. Alex and Jo match a pair,
reload, and resume. It checks the score, remaining cards, and exact recovered command journal
before exporting `pairs-recovery.gif`, `pairs-recovery.mp4`, and a final still.
[`demo-frame.html`](demo-frame.html) supplies the surrounding title and step captions.

Run the local app, then capture it in a separate terminal:

```bash
README_BROWSER_CHANNEL=chrome README_DEMO_URL=http://127.0.0.1:3000 \
  README_DEMO_COMMIT=$(git rev-parse HEAD) node --import tsx docs/assets/capture-pairs.mjs
```

Setup occurs before recording. Matching clicks are chosen from the real random shuffle; application
responses and storage are not seeded. `pairs-recovery.json` records the scenario and checks.
The capture accepts local hosts only. Pairs needs no hosted credentials or database for this demo.

## Architecture flow

[`architecture.html`](architecture.html) draws the system shape in
[architecture](../architecture.md). Static light and dark PNGs use twice the display resolution.
The 20-second motion sequence follows a read, then job enqueue, worker claim, R2 processing,
settlement, and advisory notification. A small marker moves along existing connectors; the layout
stays fixed. Timing is illustrative.

```bash
README_BROWSER_CHANNEL=chrome node docs/assets/render.mjs --architecture --animate
```

Omit `--animate` for PNGs only. Motion exports are `architecture-flow-light.gif`,
`architecture-flow-dark.gif`, and their MP4 versions. The README selects light/dark images with
`picture`; reduced-motion preferences select the static image inside the disclosure.

The scripts need repository dependencies and a Playwright browser. Motion exports also need
FFmpeg on PATH. Omit `README_BROWSER_CHANNEL` to use installed Playwright Chromium.
`README_PLAYWRIGHT_MODULE` can select an existing artifact runtime's Playwright module for the
illustration and architecture renderer. Temporary frames are removed after export.

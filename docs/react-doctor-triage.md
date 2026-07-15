# React Doctor triage

Scan: React Doctor 0.7.8, 2026-07-15. Baseline: 43/100, 22 errors and 297 warnings across 94 files.

Repeated diagnostics are grouped by rule below; the count covers every reported instance. “Fix” means the finding is confirmed and included as a focused commit on this PR. “Follow-up” means plausible but too broad, behavior-sensitive, or product-dependent for an unreviewed sweep. “No change” means the diagnostic is disproved by source context.

## Errors

| Rule | Count | Triage | Confidence | Evidence / action |
| --- | ---: | --- | --- | --- |
| `no-effect-with-fresh-deps` | 7 | Fix | High | Inline callbacks/options reach effects in `useOutsideClick`, `useEscapeKey`, and `useSwipe`; stabilize at the hook boundary. |
| `no-impure-state-updater` | 1 | Fix | High | `AlbumGallery` clears other state inside a `setSelectable` updater. Move the clearing to the event callback. |
| `tanstack-start-route-property-order` | 4 | Fix | High | Four route definitions put `validateSearch` after `loader`; reorder without changing behavior. |
| `no-ref-current-in-render` | 8 | Follow-up | Medium | Six real-time/game files mirror live state or callbacks into refs during render. The pattern needs event-by-event concurrency review; a mechanical effect conversion can introduce stale reads. |
| `effect-needs-cleanup` | 1 | No change | High | `useReliableGameSocket` already clears retry/heartbeat timers, removes both listeners, marks the closure inactive, and closes the socket in its effect cleanup. |
| `rules-of-hooks` | 1 | No change | High | `useStorage` is Nitro’s request-scoped storage API in a server route, not a React Hook. |

## Warnings

| Rule | Count | Triage | Confidence | Evidence / action |
| --- | ---: | --- | --- | --- |
| `exhaustive-deps` | 7 | Fix | High | Same root cause and files as `no-effect-with-fresh-deps`; fixed at the shared hook boundary. |
| `button-has-type` | 65 | Follow-up | High | Real HTML default-submit risk, but this is a 14-file migration-sized family; audit form intent before a bulk change. |
| `no-locale-format-in-render` | 7 | Follow-up | High | Locale/time-zone output can differ between SSR and hydration; product must choose a canonical locale/time zone. |
| `rendering-hydration-mismatch-time` | 2 | Follow-up | High | `TokenSessionsPanel` derives render output from current time; needs an agreed server/client clock strategy. |
| `no-fetch-in-effect` | 2 | Follow-up | Medium | Guest management fetches client-side after auth/UI transitions; moving it changes loading and invalidation ownership. |
| `no-chain-state-updates` | 12 | Follow-up | Medium | Plausible extra renders across six state-heavy views; reducer/event consolidation is behavior-sensitive. |
| `no-effect-chain` | 8 | Follow-up | Medium | Editor and transfer state synchronization is real but entwined with selection/reset behavior. |
| `no-mirror-prop-effect` | 2 | Follow-up | Medium | Transfer gallery mirrors props for local interaction state; ownership needs product-flow review. |
| `no-pass-live-state-to-parent` | 1 | Follow-up | Medium | Transfer gallery parent notification may be intentional coordination. |
| `no-prop-callback-in-effect` | 1 | Follow-up | Medium | Transfer gallery callback timing is externally observable. |
| `prefer-use-effect-event` | 9 | Follow-up | Medium | Valid optimization in four files, but converting listener callbacks requires concurrency review. |
| `prefer-useReducer` | 5 | Follow-up | Low | Structural recommendation, not a demonstrated defect. |
| `no-array-index-as-key` | 3 | Follow-up | Medium | Could misassociate state if lists reorder; stable domain keys must be identified first. |
| `server-sequential-independent-await` | 2 | Follow-up | Medium | Calls look parallelizable, but backend rate/ordering constraints need confirmation. |
| `control-has-associated-label` | 10 | Follow-up | High | Likely accessibility defects across five files; labels need control-specific copy. |
| `label-has-associated-control` | 9 | Follow-up | High | Likely accessibility defects across four files; confirm whether labels wrap custom controls or need `htmlFor`. |
| `click-events-have-key-events` | 1 | Follow-up | High | Branded image click target needs equivalent keyboard behavior or a semantic control. |
| `no-static-element-interactions` | 3 | Follow-up | High | Interactive static elements need semantic controls/keyboard behavior; interaction design must be preserved. |
| `no-interactive-element-to-noninteractive-role` | 1 | Follow-up | High | Searchable word list overrides native interaction semantics. |
| `prefer-html-dialog` | 8 | Follow-up | Medium | Native dialog migration affects focus, dismissal, and styling across seven modal flows. |
| `prefer-tag-over-role` | 2 | Follow-up | High | Native semantic tags can replace explicit roles after markup review. |
| `no-redundant-roles` | 21 | Follow-up | High | Safe cleanup in principle, but broad and non-functional. |
| `img-redundant-alt` | 3 | Follow-up | Medium | Alt copy should be edited with the surrounding caption/context. |
| `async-await-in-loop` | 25 | Follow-up | Low | Many loops are intentionally sequential, rate-limited, streaming, or order-dependent; triage per call site. |
| `js-combine-iterations` | 16 | Follow-up | Low | Micro-optimization without evidence of a hot path. |
| `js-flatmap-filter` | 6 | Follow-up | Low | Micro-optimization; current code may be clearer. |
| `js-cache-property-access` | 3 | Follow-up | Low | Micro-optimization without profiling evidence. |
| `js-set-map-lookups` | 3 | Follow-up | Low | Potential hot-loop improvement; needs input-size evidence. |
| `js-index-maps` | 1 | Follow-up | Low | Potential indexing improvement; needs workload evidence. |
| `rendering-hydration-no-flicker` | 3 | Follow-up | Medium | Storage/client-derived UI can flicker; fix depends on SSR/product expectations. |
| `rerender-state-only-in-handlers` | 2 | Follow-up | Medium | State may coordinate async handlers even when not rendered; inspect ownership before replacing with refs. |
| `rerender-lazy-ref-init` | 3 | Follow-up | High | Safe localized optimization, but not user-impacting. |
| `rerender-lazy-state-init` | 1 | Follow-up | High | Safe localized optimization, but not user-impacting. |
| `rerender-memo-with-default-value` | 1 | Follow-up | Medium | Default array identity can defeat memoization; low impact without profiling. |
| `no-large-animated-blur` | 1 | Follow-up | Medium | Photo viewer blur animation may be GPU-heavy; visual change needs review. |
| `no-giant-component` | 12 | Follow-up | High | Twelve large components are maintainability debt, not focused bug fixes. |
| `no-multi-comp` | 4 | Follow-up | Low | Co-located root components are a style/organization concern. |
| `only-export-components` | 4 | Follow-up | Low | Fast-refresh convention; no demonstrated production defect. |
| `prefer-module-scope-pure-function` | 9 | Follow-up | Medium | Safe where closures are truly absent; broad low-impact cleanup. |
| `prefer-module-scope-static-value` | 1 | Follow-up | High | `AdminDashboard` rebuilds a static helper value; low-impact cleanup. |
| `no-inline-exhaustive-style` | 1 | Follow-up | Low | Style exhaustiveness preference, not a demonstrated defect. |
| `unused-export` | 6 | Follow-up | Medium | May be consumed by scripts/framework conventions outside the analyzer graph. |
| `unused-file` | 6 | Follow-up | Low | Includes convention-based Nitro/WebSocket routes and standalone deployment code that dead-code analysis cannot reliably trace. |
| `unsafe-json-in-html` | 1 | Follow-up | Medium | Structured data serialization needs a dedicated escaping review before changing SEO output. |
| `insecure-crypto-risk` | 2 | No change | High | One hit is generated `.output` code; the source hit uses `crypto.randomUUID()` for a connection epoch, not weak cryptography. |
| `require-pnpm-hardening` | 2 | Follow-up | Medium | Workspace config lacks supply-chain hardening settings; policy change belongs in a dependency-security PR. |

## Verification

Each fix commit is checked with `npm run typecheck`, `npm run lint`, and React Doctor’s changed-scope scan against `main`. The full scan remains the baseline for deferred families.

Final full scan: 47/100, 10 errors and 290 warnings across 89 files. The stacked fixes removed 12 errors and 7 warnings; the remaining errors are the eight concurrency-sensitive ref writes and the two high-confidence false positives documented above.

## Follow-up review — 2026-07-15

The second pass fixes every error without weakening runtime behavior. Live callback/state refs now synchronize after commit, Nitro’s non-React `useStorage` API is aliased, and the socket effect explicitly owns and closes every connection it creates. The socket cleanup diagnostic is suppressed with local evidence because React Doctor does not follow the owned `Set<WebSocket>` cleanup.

Actionable warnings fixed in this pass:

- escaped content-derived JSON-LD at the inline-script boundary, with focused malicious and legitimate-value regression coverage;
- missing form-control labels, redundant/non-native roles, redundant image alt wording, and keyboard access for upload/lightbox surfaces;
- nondeterministic SSR locale/time formatting and render-time clocks;
- two independent server operations that were unnecessarily awaited in sequence.

Remaining warning decisions:

| Families | Count | Decision |
| --- | ---: | --- |
| Missing button `type` | 64 | Worth fixing as a dedicated form audit. Many are outside forms and cannot submit anything, so the rule overstates current impact; adding types remains useful hardening. |
| Native dialog / static backdrop interaction | 10 | Worth fixing as a focused modal migration with focus, Escape, backdrop, and return-focus verification. |
| State/effect synchronization and reducer suggestions | 38 | Not false positives, but behavior-sensitive refactor advice rather than demonstrated defects. Change only with flow-specific tests or an observed bug. |
| Fetch-in-effect | 2 | Intentional client transitions: initial voting-window refresh and lazy loading when the games tab opens. No server-render ownership issue. |
| Locale formatting | 2 | False positives: both values are gated behind `hasMounted`, so server and hydration output match. |
| Array-index keys | 3 | Not actionable: derived text/leaderboard rows carry no local component state; reordering cannot associate user input with another row. |
| Maintainability | 43 | Real debt, not runtime defects. Split giant components and move pure values only when those areas are actively changed. |
| Performance | 65 | Hypotheses, not verified regressions. Sequential loops include ordered, streaming, and rate-sensitive work; iteration rewrites need profiling/input-size evidence. |
| Crypto / pnpm hardening | 4 | False positives: generated output plus a non-security JSON change signature; pnpm findings cite a nonexistent `pnpm-workspace.yaml`. |

Final second-pass scan: 54/100, **0 errors** and 231 warnings across 71 files.

## Final warning audit — 2026-07-15

This pass reviewed every remaining instance, grouped by rule. It fixed all 64 missing button types, closed the 10 modal/backdrop findings with focus and Escape handling or evidence-backed suppressions, corrected one misapplied alert-dialog role, and applied nine low-risk initialization/lookup optimizations. No warning was suppressed solely to improve the score.

| Rule | Count | Decision |
| --- | ---: | --- |
| `no-chain-state-updates` | 12 | Leave. These state-heavy flows intentionally reset related state together; reducer conversion is behavior-sensitive and no defect is demonstrated. |
| `prefer-use-effect-event` | 9 | Leave. Listener and socket callbacks depend on current state; conversion needs concurrency-specific verification. |
| `no-effect-chain` | 8 | Leave. The chains coordinate editor, selection, and transfer resets; changing ownership could alter visible behavior. |
| `prefer-useReducer` | 5 | Leave. Structural recommendation, not a correctness finding. |
| `no-array-index-as-key` | 3 | Leave. Keys cover derived text and display-only leaderboard fragments with no row-local state. |
| `no-fetch-in-effect` | 2 | Leave. Intentional client transitions: voting-window refresh and lazy games-tab loading. |
| `no-locale-format-in-render` | 2 | False positive. Both render paths are gated by `hasMounted`, so server and hydration output match. |
| `no-mirror-prop-effect` | 2 | Leave. Transfer gallery deliberately creates local interaction state from refreshed server props. |
| `no-pass-live-state-to-parent` | 1 | Leave. The parent notification is intentional transfer-gallery coordination. |
| `no-prop-callback-in-effect` | 1 | Leave. Callback timing is part of the gallery synchronization contract. |
| `no-giant-component` | 12 | Leave. Real maintainability debt, but splitting these components is not a warning-level correctness fix. |
| `prefer-module-scope-pure-function` | 9 | Leave. Low-impact organization advice; move functions when their owning components are refactored. |
| `unused-export` | 6 | Leave. Analyzer reachability does not include every script and framework convention. |
| `unused-file` | 6 | Leave. Includes convention-routed Nitro/WebSocket and deployment files that are not dead. |
| `no-multi-comp` | 4 | Leave. Co-location preference with no runtime impact. |
| `only-export-components` | 4 | Leave. Fast-refresh convention with no demonstrated production defect. |
| `no-inline-exhaustive-style` | 1 | Leave. Style exhaustiveness preference, not a defect. |
| `prefer-module-scope-static-value` | 1 | Leave. Negligible allocation in a non-hot path. |
| `async-await-in-loop` | 25 | Leave. Reviewed loops preserve ordering/backpressure or avoid storage races and request bursts. |
| `js-combine-iterations` | 16 | Leave. Micro-optimization without hot-path or input-size evidence. |
| `js-flatmap-filter` | 6 | Leave. Equivalent rewrite would reduce clarity without measured benefit. |
| `js-cache-property-access` | 3 | Leave. Micro-optimization without profiling evidence. |
| `rendering-hydration-no-flicker` | 3 | Leave. File-system, sharing, and media-query capabilities are client-only; SSR must use a conservative default. |
| `rerender-state-only-in-handlers` | 2 | Leave. State coordinates asynchronous handlers; replacing it with refs risks stale or reordered updates. |
| `no-large-animated-blur` | 1 | Leave. Intentional photo-viewer treatment; change only with device profiling or an approved visual alternative. |
| `insecure-crypto-risk` | 2 | False positive. One hit is generated output; the source hit compares JSON as a change signature, not for security. |
| `require-pnpm-hardening` | 2 | False positive. Both diagnostics refer to a nonexistent `pnpm-workspace.yaml`; this repository uses only a lockfile. |

Final audited scan: 55/100, **0 errors** and 148 warnings across 60 files. All 148 remaining warnings are covered by the decisions above.

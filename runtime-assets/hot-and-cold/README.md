# Hot and Cold generated data

Each judging revision has its own immutable directory. Daily puzzles #1–#5 use
`1.0.0`; puzzle #6 and later use `2.0.0`. Keeping both assets means an archive
visit, an in-progress game, and a result always use the ruling they started with.

Run `pnpm data:hot-and-cold` to rebuild the latest revision. The source data is
Open English WordNet 2025 (CC BY 4.0), SUBTLEX-US frequency data, and the bundled
Xenova/all-MiniLM-L6-v2 model.

Judging uses semantic versioning independently from the application: major
changes alter word identity, ranks, scoring, or other comparability boundaries;
minor changes alter player-visible rulings such as official hints while
preserving the comparable rank core; patches do not intentionally change a
ruling. `pnpm check:game-judging` enforces the version bump and
`pnpm check:hot-and-cold-quality` verifies the generated data plus the rolling
30-puzzle human-approval window.

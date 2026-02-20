# Agent Instructions

Use the Cursor rules in `.cursor/rules/` as the primary instruction source for this repository.

- Apply all relevant rules found in `.cursor/rules/`.
- If multiple rules apply, follow the strictest applicable guidance.
- Treat updates in `.cursor/rules/` as authoritative for future work in this repo.
- If the prompt is not asking for code changes, direct implementation work, or planning/execution work in this codebase, do not load `.cursor/rules/`.
- For simple questions or codebase Q&A, answer directly using repository context and skip rule-loading to avoid unnecessary token use.

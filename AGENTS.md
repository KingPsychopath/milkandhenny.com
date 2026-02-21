# Codex CLI — Agent Instructions

## 1. Token Economy (Always Active)

- Be concise. No fluff. No explaining code unless asked.
- For edits, show only changed lines plus minimal surrounding context.
- Do not repeat prior context. Reference decisions in one line.
- Do not summarize what you just did unless asked.
- Ask for only the minimum missing inputs to unblock the task.
- If the thread becomes long or drifts into resolved tangents, recommend a new chat or branch from the last clean point.

## 2. Checkpoint Protocol (Codex CLI — Always Active)

If I type `/save` or `checkpoint`, stop all work and output a
**Context Capsule** in a single fenced code block.

Schema (keep under 300 tokens):

1. **Goal:** One sentence on what we are building/debugging.
2. **Recent Changes:** Bullets of files touched, logic added/removed.
3. **Current State:** Dense technical status — variables, interfaces,
   endpoints, constraints, known risks.
4. **Next Steps:** Immediate next actions.

No prefacing text. No follow-up commentary. Just the capsule.

## 3. 2-Turn Recovery Rule (Codex CLI — Always Active)

If two fix attempts fail on the same issue:
- Stop.
- Output a Context Capsule automatically.
- Recommend I start a fresh session with the capsule.

## 4. Rule Loading (Lazy — Do Not Preload)

This repo has detailed rules in `.cursor/rules/`.
Do not read these files unless the current task requires them.
`AGENTS.md` is the source of truth for token economy and checkpoint behavior.
Do not load `.cursor/rules/token-economy.mdc` for normal work.

| Task Domain | Read This File |
|---|---|
| UI, design, CSS, components | `.cursor/rules/design-system.mdc` |
| Accessibility, semantic HTML, forms, focus/keyboard | `.cursor/rules/accessibility.mdc` |
| React, Next.js routing, server/client boundaries | `.cursor/rules/react-nextjs.mdc` |
| App CLI commands, domain scripts, admin tools | `.cursor/rules/cli-parity.mdc` |
| File moves, renames, codemods | `.cursor/rules/file-ops.mdc` |
| TypeScript, safety, module boundaries | `.cursor/rules/engineering-core.mdc` |
| Testing, Vitest, test strategy | `.cursor/rules/testing.mdc` |

For simple Q&A or small fixes: answer directly, skip rule loading.

## 5. Execution

- If a `.md` plan is attached, follow it step-by-step. Do not invent new steps.
- If no plan exists, gather context first (read/grep), then batch edits in minimal turns.
- Use Conventional Commits for any suggested commit messages.

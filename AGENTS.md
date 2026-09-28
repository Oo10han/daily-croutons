# Agent Guidance

## Project Boundaries

- This is an offline Electron + Vue 3 + TypeScript application. SQLite access belongs in the main process, centered in [src/main/database.ts](src/main/database.ts); renderer code must use the business API exposed by [src/preload/index.ts](src/preload/index.ts), not Node APIs, SQLite, or arbitrary IPC.
- Keep IPC changes synchronized across [src/shared/types.ts](src/shared/types.ts), preload, and main-process handlers. Preserve context isolation, sandboxing, and runtime validation of IPC inputs.
- Keep shared unit conversions and domain rules in [src/shared/finance.ts](src/shared/finance.ts) and [src/shared/health.ts](src/shared/health.ts). Persist money as integer cents and weight as integer grams; validate dates as real `YYYY-MM-DD` dates.
- Consult [README.md](README.md) for feature behavior, backup compatibility, data locations, and environment details. Link to it rather than copying its full documentation here.

## Development Checks

- Use `pnpm typecheck`, `pnpm test`, and `pnpm build` for type, database-test, and production-build checks as appropriate to the change.
- Run `pnpm build` before `pnpm test:e2e`, `pnpm test:dev`, or `pnpm start`; those scripts consume build output and do not build it themselves.
- Keep tests scoped to the changed behavior. Do not claim desktop or UI behavior is verified by the database-only `pnpm test` suite.

## Collaboration Preferences

- Keep commits focused, with concise, descriptive commit messages. Do not create a commit unless asked.
- Write thorough comments for non-obvious logic: explain intent, invariants, edge cases, and important constraints. Keep comments current and avoid merely restating obvious code.
- Answer directly and without defensiveness. Acknowledge mistakes or uncertainty plainly, correct them, and focus on the next useful step rather than arguing or over-justifying.
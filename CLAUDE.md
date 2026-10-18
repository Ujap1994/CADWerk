# ParaWerk – notes for AI-assisted development

ParaWerk is a parametric CAD application (Electron + TypeScript + React + three.js + OCCT WebAssembly).
The plan lives in ROADMAP.md, decisions in docs/adr/.

## Working agreements
- Conversation with the owner in German; code, comments, docs, README, CHANGELOG and release notes in English.
- Adopt functionality of established CAD tools, never their code, assets, icons or visual design.
- Priorities: usability, performance with large parts/assemblies, stability.
- Every feature ships with tests (unit/integration/E2E), benchmark coverage where performance matters,
  user-guide text and screenshots (`npm run docs:screenshots`). Push to GitHub after each step.
- No DWG support (closed format).

## Conventions
- Relative imports use explicit `.ts`/`.tsx` extensions; only erasable TypeScript syntax
  (no enums, no parameter properties): bench scripts run directly in Node.
- Product name and IDs live in `src/shared/app-info.ts`, `package.json` and `electron-builder.yml` only.
- All UI strings come from `src/shared/locales/{en,de}.json`; keys must match (unit test).
- Kernel code (`src/kernel`) must release every embind object: use `Arena` (`using arena = new Arena()`),
  and `arena.trackAlgorithm()` for BRepAlgoAPI objects (`Clear()` before `delete()` avoids a leak).
  Do not use `BRepCheck_Analyzer` in hot paths (leaks in the current build).
- The renderer never blocks on the kernel: all geometry work goes through `KernelClient` → worker.
- Viewport engine (`src/renderer/src/viewport/engine.ts`) renders on demand; do not add render loops.

## Commands
- `npm run dev`, `npm run build`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`
- `npm run bench:kernel | bench:solver | bench:render | bench:compare`
- `npm run package` (current platform) – releases run in `.github/workflows/release.yml`

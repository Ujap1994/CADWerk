# 0003 – Native file format (.pwpart)

**Status:** accepted.

## Decision

A `.pwpart` file is a ZIP container:

| Entry | Content |
|---|---|
| `document.json` | `{ format: "parawerk-part", version, units: "mm", features: [...] }`, the source of truth |
| `meta.json` | application version and save time (informational) |
| later: `brep/*.brep` | cached B-Rep results for fast opening of large parts |
| later: `thumbnail.png` | preview for file browsers |

- Readers ignore unknown entries, so newer files with extra caches still open.
- `version` is incremented on breaking changes; older versions are migrated forward on load. Files from
  a newer ParaWerk are rejected with a clear message.
- Everything read from a file is validated (`src/shared/model/validate.ts`); invalid files produce a
  coded error, never a crash. Entries larger than 64 MB uncompressed are rejected (zip-bomb guard).
- Assemblies (`.pwasm`) and drawings (`.pwdrw`) will use the same container with their own
  `format` value.

## Why ZIP and JSON

Human-readable and diff-friendly where it matters (the feature list), compact for binary caches, and
readable with standard tools for debugging and data recovery.

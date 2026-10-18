# 0008 – Dependency license policy

**Status:** accepted.

ParaWerk is licensed under GPL-3.0-or-later. Every bundled dependency must be compatible:

- Allowed: MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, Zlib, LGPL-2.0/2.1 (or later), GPL-3.0-or-later.
- `npm run licenses:check` verifies all bundled packages and their dependencies; it runs in CI.
- Third-party notices are listed in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and shown
  in the About dialog.

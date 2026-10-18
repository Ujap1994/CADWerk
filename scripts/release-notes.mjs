// Prints the CHANGELOG.md section of a version (or "Unreleased") for the GitHub release notes.
import { readFileSync } from 'node:fs';

const version = process.argv[2];
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const sections = changelog.split(/^## /m).slice(1);
const section =
  sections.find((s) => s.startsWith(`[${version}]`)) ?? sections.find((s) => s.startsWith('[Unreleased]')) ?? '';
const body = section.split('\n').slice(1).join('\n').trim();

console.log(`${body}

---

> **ParaWerk is under active development.** Builds are not code-signed yet, so macOS and Windows show a
> security warning on first start. See the [README](https://github.com/Ujap1994/ParaWerk#readme) for the disclaimer
> and the [user guide](https://github.com/Ujap1994/ParaWerk/tree/main/docs/user-guide) for instructions.`);

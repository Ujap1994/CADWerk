// Prints the GitHub release notes of a version: the highlights in docs/release-notes/v<version>.md (if
// there are any), then the CHANGELOG.md section of the version (or "Unreleased"). Relative links and
// images point into the repository at the release tag, so they work on the release page.
import { existsSync, readFileSync } from 'node:fs';

const REPOSITORY = 'https://github.com/Ujap1994/ParaWerk';
const RAW = 'https://raw.githubusercontent.com/Ujap1994/ParaWerk';

const version = process.argv[2];
const tag = `v${version}`;
const root = new URL('../', import.meta.url);

/** Rewrites relative Markdown links and images of a file at `path` (relative to the repository root). */
function absoluteLinks(markdown, path) {
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (match, image, text, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return match;
    const resolved = new URL(target, `https://repository/${path}`).pathname.slice(1);
    const base = image ? `${RAW}/${tag}` : `${REPOSITORY}/blob/${tag}`;
    const [file, anchor] = resolved.split('#');
    return `${image}[${text}](${base}/${file}${anchor ? `#${anchor}` : ''})`;
  });
}

const changelog = readFileSync(new URL('CHANGELOG.md', root), 'utf8');
const sections = changelog.split(/^## /m).slice(1);
const section =
  sections.find((s) => s.startsWith(`[${version}]`)) ?? sections.find((s) => s.startsWith('[Unreleased]')) ?? '';
const changes = absoluteLinks(section.split('\n').slice(1).join('\n').trim(), 'CHANGELOG.md');

const highlightsPath = `docs/release-notes/${tag}.md`;
const highlightsFile = new URL(highlightsPath, root);
// The title of the highlights file is the release title already.
const highlights = existsSync(highlightsFile)
  ? absoluteLinks(readFileSync(highlightsFile, 'utf8').replace(/^# .*\n+/, '').trim(), highlightsPath)
  : '';

const body = highlights ? `${highlights}\n\n## All changes\n\n${changes.replace(/^### /gm, '#### ')}` : changes;

console.log(`${body}

---

> **ParaWerk is under active development.** Builds are not signed with a developer certificate yet, so
> macOS and Windows ask once before the first start (see [getting started](${REPOSITORY}/blob/${tag}/docs/user-guide/getting-started.md#install)).
> Read the [README](${REPOSITORY}#readme) for the disclaimer and the [user guide](${REPOSITORY}/tree/${tag}/docs/user-guide) for instructions.`);

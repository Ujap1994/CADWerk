// Renders the SVG app icon into the PNG sizes needed by Electron and electron-builder.
// electron-builder derives .icns (macOS) and .ico (Windows) from build/icon.png.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(root, 'assets/brand/parawerk-icon.svg'), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

mkdirSync(path.join(root, 'build/icons'), { recursive: true });

for (const size of sizes) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(path.join(root, `build/icons/${size}x${size}.png`), png);
  if (size === 1024) writeFileSync(path.join(root, 'build/icon.png'), png);
}

console.log(`Rendered ${sizes.length} icon sizes to build/icons`);

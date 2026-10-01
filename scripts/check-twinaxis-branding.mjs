import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => /\.(?:md|html|json|toml|rs|ts|tsx|js|mjs|py)$/i.test(file));
const allowed = [
  { file: 'README.md', pattern: /3D Asset Platform>/ },
  { file: 'scripts/dev-fresh.mjs', pattern: /3d asset platform/i },
];
const failures = [];

for (const file of tracked) {
  if (file.startsWith('3d imported models/')) continue;
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  content.split(/\r?\n/).forEach((line, index) => {
    for (const name of ['3D Asset Forge', '3D Asset Platform']) {
      if (!line.includes(name)) continue;
      if (allowed.some((entry) => entry.file === file && entry.pattern.test(line))) continue;
      failures.push(`${file}:${index + 1}: ${name}`);
    }
  });
}

if (failures.length) {
  console.error(`TwinAxis branding check failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`TwinAxis branding check passed (${tracked.length} tracked text files).`);

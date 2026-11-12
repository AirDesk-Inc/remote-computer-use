// Generates the Claude Code / Agent Plugins marketplace from the canonical skill and
// its language overlays: .claude-plugin/marketplace.json and plugins/<name>/.
// `--check` reports drift without writing, so CI keeps the committed copies current.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { languages, marketplace, packageRoot, pluginFiles, pluginName } from '../lib/bundle.mjs';

const check = process.argv.includes('--check');
const version = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version;
const expected = new Map([['.claude-plugin/marketplace.json', Buffer.from(JSON.stringify(marketplace(version), null, 2) + '\n')]]);
for (const lang of languages)
  for (const [name, data] of await pluginFiles(lang, version)) expected.set(`plugins/${pluginName(lang)}/${name}`, data);

async function listTree(directory, prefix) {
  const found = [];
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const entry of entries) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await listTree(path.join(directory, entry.name), relative));
    else found.push(relative);
  }
  return found;
}

const actual = new Set([...await listTree(path.join(packageRoot, 'plugins'), 'plugins'),
  ...(await listTree(path.join(packageRoot, '.claude-plugin'), '.claude-plugin'))]);
const drift = [];
for (const [name, data] of expected) {
  const current = await fs.readFile(path.join(packageRoot, name)).catch(() => null);
  if (!current?.equals(data)) drift.push(name);
}
const stale = [...actual].filter(name => !expected.has(name) && !name.endsWith('.DS_Store'));

if (check) {
  if (drift.length || stale.length) {
    console.error(`Plugins are out of date. Run: node scripts/build-plugins.mjs\n${[...drift, ...stale].map(name => `  ${name}`).join('\n')}`);
    process.exitCode = 1;
  } else console.log(`Plugins are current: ${expected.size} files.`);
} else {
  for (const name of stale) await fs.unlink(path.join(packageRoot, name));
  for (const name of drift) {
    const filename = path.join(packageRoot, name);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, expected.get(name));
  }
  console.log(`Wrote ${drift.length} and removed ${stale.length} plugin files (${expected.size} total).`);
}

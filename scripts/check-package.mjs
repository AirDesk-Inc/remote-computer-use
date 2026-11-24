import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { packageRoot, skillFiles } from '../lib/installer.mjs';
import { languages, translatableFiles } from '../lib/bundle.mjs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

assert(process.env.npm_execpath, 'Run with npm run check:package');
const readJson = name => JSON.parse(readFileSync(path.join(packageRoot, name), 'utf8'));
assert.equal(readJson('server.json').version, readJson('package.json').version,
  'server.json version must match package.json so the MCP Registry workflow publishes each release');
const tests = spawnSync(process.execPath, ['--test', 'tests/installer.test.mjs'], { cwd: packageRoot, stdio: 'inherit' });
assert.equal(tests.status, 0, 'Installer tests failed');
const plugins = spawnSync(process.execPath, ['scripts/build-plugins.mjs', '--check'], { cwd: packageRoot, stdio: 'inherit' });
assert.equal(plugins.status, 0, 'Marketplace plugins are out of date');
const packed = spawnSync(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: packageRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
assert.equal(packed.status, 0, 'npm pack failed');
const [manifest] = JSON.parse(packed.stdout);
const files = new Set(manifest.files.map(file => file.path));
const overlays = languages.filter(lang => lang !== 'en').flatMap(lang => translatableFiles
  .map(name => `locales/${lang}/${name}`).filter(name => existsSync(path.join(packageRoot, name))));
for (const name of ['package.json', 'LICENSE', 'bin/cli.mjs', 'lib/installer.mjs', 'lib/clients.mjs', 'lib/bundle.mjs', ...overlays, 'lib/skill-releases.json', 'README.md', 'docs/assets/remote-computer-use.svg',
  'TRADEMARKS.md', ...skillFiles.map(name => `skills/remote-computer-use/${name}`)]) assert(files.has(name), `Missing ${name}`);
for (const name of files) {
  assert(!/(^|\/)(node_modules|tests|plugins|\.claude-plugin|\.git|__pycache__|\.env|\.npmrc|private)(\/|$)/u.test(name), `Unexpected ${name}`);
  assert(!/\.(pyc|log|pem|key|tgz)$/u.test(name), `Unexpected ${name}`);
}
assert(manifest.unpackedSize < 512 * 1024, 'Unexpected package size');
console.log(`Package check passed: ${files.size} files, ${manifest.unpackedSize} bytes unpacked. No publication performed.`);

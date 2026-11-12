import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import { parse } from 'smol-toml';
import { configAddition, jsonConfiguration, removeCodexAliases, defaultSkillsDir, findBinary, install, nativeSetup, packageRoot, skillFiles, clientIds, resolveClient, selectClients, isNativeAirdeskServer,
  detectLanguage, languages, onlineEndpoint, onlineKeyVariable } from '../lib/installer.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airdesk-installer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, 'AirDesk');
  await fs.writeFile(binary, '', { mode: 0o700 });
  return { root, binary, skillsDir: path.join(root, 'skills'), config: path.join(root, 'codex', 'config.toml') };
}

function fakeNative(calls) {
  return (binary, enabled) => {
    calls.push({ binary, enabled });
    return { mcpSetupVersion: 1, clientMcpOnly: true, mcpServerEnabled: enabled,
      remoteTerminalEnabled: true, remoteTerminalChanged: false,
      termsAccepted: true, termsRequired: false, termsVersion: '2026-10-28', mcpConfigured: enabled,
      blockedReason: enabled ? '' : 'mcp_disabled' };
  };
}

test('install copies a complete skill and registers only normal native startup', async t => {
  const options = await fixture(t);
  const calls = [];
  const result = await install(options, { nativeSetup: fakeNative(calls) });
  assert.equal(result.mcp, 'enabled-and-registered');
  assert.equal(result.skill, 'installed');
  for (const name of skillFiles) {
    assert.deepEqual(await fs.readFile(path.join(result.destination, name)),
      await fs.readFile(path.join(packageRoot, 'skills', 'remote-computer-use', name)));
  }
  for (const name of skillFiles.filter(name => name.endsWith('.md'))) {
    const document = path.join(result.destination, name);
    for (const [, target] of (await fs.readFile(document, 'utf8')).matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const reference = new URL(target, pathToFileURL(document));
      if (reference.protocol !== 'file:') continue;
      const filename = fileURLToPath(reference);
      const relative = path.relative(result.destination, filename);
      assert(!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Link escapes the installed skill: ${name}`);
      assert((await fs.stat(filename)).isFile(), `Missing installed reference: ${target}`);
    }
  }
  const config = parse(await fs.readFile(options.config, 'utf8'));
  assert.deepEqual(config.mcp_servers.airdesk.args, ['--mcp-server']);
  assert.equal(config.mcp_servers.airdesk.command, options.binary);
  assert.deepEqual(calls.map(c => c.enabled), [false, true]);
});

test('repeated install is idempotent and does not append duplicate config', async t => {
  const options = await fixture(t);
  const dependencies = { nativeSetup: fakeNative([]) };
  await install(options, dependencies);
  const before = await fs.readFile(options.config);
  assert.equal((await install(options, dependencies)).skill, 'unchanged');
  assert.deepEqual(await fs.readFile(options.config), before);
});

test('preserves comments, unrelated servers and approval settings byte for byte', async t => {
  const options = await fixture(t);
  const original = '# keep me\nmodel = "example"\n[mcp_servers.other]\ncommand = "other"\n';
  await fs.mkdir(path.dirname(options.config));
  await fs.writeFile(options.config, original);
  await install(options, { nativeSetup: fakeNative([]) });
  assert((await fs.readFile(options.config, 'utf8')).startsWith(original));
});

test('conflicting existing skill is never overwritten or remotely activated', async t => {
  const options = await fixture(t);
  const destination = path.join(options.skillsDir, 'remote-computer-use');
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'SKILL.md'), 'user changes');
  const calls = [];
  await assert.rejects(install(options, { nativeSetup: fakeNative(calls) }), /existing_skill_conflict/u);
  assert.equal(await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8'), 'user changes');
  assert.equal(calls.length, 0);
});

test('conflicting MCP entry stops before writing or activating', async t => {
  const options = await fixture(t);
  const original = '[mcp_servers.airdesk]\ncommand = "do-not-change"\n';
  await fs.mkdir(path.dirname(options.config));
  await fs.writeFile(options.config, original);
  const calls = [];
  await assert.rejects(install(options, { nativeSetup: fakeNative(calls) }), /existing_airdesk_config_conflict/u);
  assert.equal(await fs.readFile(options.config, 'utf8'), original);
  assert.equal(calls.length, 0);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
});

async function windowsRetargetFixture(t) {
  const options = await fixture(t);
  const local = path.join(await fs.realpath(options.root), 'Local AppData 에어데스크');
  const installed = (version, arch = 'x64') => path.join(local, 'AirDesk', 'app', `app-${version}-${arch}`, 'AirDesk.exe');
  const binary = installed('1.0.71');
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(binary, '', { mode: 0o700 });
  const context = { home: options.root, platform: 'win32', env: { LOCALAPPDATA: local } };
  return { options: { ...options, binary }, context, installed };
}

test('Windows Codex retargets only the standard stale command and keeps its exact backup', async t => {
  const { options, context, installed } = await windowsRetargetFixture(t);
  const previous = installed('1.0.70'); // The old installer may already have removed this executable.
  const oldCommand = `command = ${JSON.stringify(previous)}  # keep comment`;
  const original = ('# keep formatting\n[mcp_servers.local_pin]\n' +
    `command = ${JSON.stringify(previous)}\nargs = ["--mcp-server", "--debug"]\n` +
    configAddition('', previous).replace(`command = ${JSON.stringify(previous)}`, oldCommand) +
    '\n[mcp_servers.proxy]\nurl = "https://example.invalid/mcp"\n').replaceAll('\n', '\r\n');
  await fs.mkdir(path.dirname(options.config));
  await fs.writeFile(options.config, original);
  const calls = [];
  const dependencies = { context, nativeSetup: fakeNative(calls) };
  const dryRun = await install({ ...options, dryRun: true }, dependencies);
  assert.equal(dryRun.mcp, 'planned');
  assert.equal(await fs.readFile(options.config, 'utf8'), original);
  assert.deepEqual(calls, []);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });

  const result = await install(options, dependencies);
  const expected = original.replace(oldCommand, `command = ${JSON.stringify(options.binary)}  # keep comment`);
  assert.equal(await fs.readFile(options.config, 'utf8'), expected);
  assert.equal(await fs.readFile(result.configBackup, 'utf8'), original);
  assert.deepEqual(calls, [{ binary: options.binary, enabled: false }, { binary: options.binary, enabled: true }]);
});

for (const [client, format, key] of [
  ['cursor', 'mcpServers', 'mcpServers'], ['vscode', 'vscode', 'servers'],
  ['copilot-cli', 'copilot', 'mcpServers'], ['opencode', 'opencode', 'mcp'],
]) {
  test(`Windows retarget preserves every unrelated byte in ${client} JSON`, async t => {
    const { options, context, installed } = await windowsRetargetFixture(t);
    const previous = installed('1.0.70');
    const stale = JSON.parse(jsonConfiguration('', previous, format))[key].airdesk;
    const current = JSON.parse(jsonConfiguration('', options.binary, format))[key].airdesk;
    const standard = `"airdesk" : ${JSON.stringify(stale)}`;
    const original = `{"unrelated":[{"counter":9223372036854775807},"text containing { and }"] ,\r\n ` +
      `${JSON.stringify(key)} : {"proxy":{"url":"https://example.invalid/mcp"}, "directPin":${JSON.stringify(stale)}, ${standard}}}\r\n`;
    await fs.mkdir(path.dirname(options.config));
    await fs.writeFile(options.config, original);
    const dependencies = { context, nativeSetup: fakeNative([]) };
    const result = await install({ ...options, client }, dependencies);
    const expected = original.replace(standard, `"airdesk" : ${JSON.stringify(current)}`);
    assert.equal(await fs.readFile(options.config, 'utf8'), expected);
    assert.equal(await fs.readFile(result.configBackup, 'utf8'), original);
  });
}

test('Windows retarget treats equivalent stock command spellings as unchanged', async t => {
  const { options, context } = await windowsRetargetFixture(t);
  const casing = options.binary.replace('app-1.0.71-x64', 'APP-1.0.71-X64');
  const spelling = process.platform === 'win32' ? casing.replaceAll('\\', '/') : casing;
  const proxy = '[mcp_servers.proxy]\nurl = "https://example.invalid/mcp"\n';
  await fs.mkdir(path.dirname(options.config));
  const dependencies = { context, nativeSetup: fakeNative([]) };
  for (const [client, original] of [
    ['codex', proxy + configAddition(proxy, spelling)],
    ['opencode', jsonConfiguration('', spelling, 'opencode')],
  ]) {
    await fs.writeFile(options.config, original);
    assert.equal((await install({ ...options, client }, dependencies)).configBackup, undefined);
    assert.equal(await fs.readFile(options.config, 'utf8'), original);
  }
});

test('Windows retarget refuses custom and foreign registrations before installation writes', async t => {
  const { options, context, installed } = await windowsRetargetFixture(t);
  const previous = installed('1.0.70');
  const old = configAddition('', previous);
  const calls = [];
  const dependencies = { context, nativeSetup: fakeNative(calls) };
  const proxy = '[mcp_servers.airdesk]\ncommand = "npx"\nargs = ["supergateway"]\n';
  await fs.mkdir(path.dirname(options.config));
  for (const original of [
    old + 'enabled = false\n', old + '[mcp_servers.airdesk.env]\nOTHER="value"\n',
    old.replace('tool_timeout_sec = 60', 'tool_timeout_sec = 61'),
    old.replace('["--mcp-server"]', '["--mcp-server", "--debug"]'),
    configAddition('', installed('1.0.70', 'arm64')),
    configAddition('', path.join(options.root, 'elsewhere', 'app-1.0.70-x64', 'AirDesk.exe')),
    configAddition('', null, { auth: 'oauth' }), proxy,
  ]) {
    await fs.writeFile(options.config, original);
    await assert.rejects(install(options, dependencies), /existing_airdesk_config_conflict/u);
    assert.equal(await fs.readFile(options.config, 'utf8'), original);
  }
  const original = JSON.stringify({ mcpServers: { airdesk: { command: previous, args: ['--mcp-server'], env: { CUSTOM: 'kept' } } } });
  await fs.writeFile(options.config, original);
  await assert.rejects(install({ ...options, client: 'cursor' }, dependencies), /existing_airdesk_config_conflict/u);
  assert.equal(await fs.readFile(options.config, 'utf8'), original);
  assert.deepEqual(calls, []);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
});

test('Windows retarget refuses malformed, duplicate and ambiguous command locations', async t => {
  const { options, context, installed } = await windowsRetargetFixture(t);
  const previous = installed('1.0.70');
  const toml = configAddition('', previous);
  const jsonEntry = JSON.parse(jsonConfiguration('', previous, 'mcpServers')).mcpServers.airdesk;
  const ambiguousToml = `notes = """\n[mcp_servers.airdesk]\ncommand = "ordinary text"\n"""\n${toml}`;
  const duplicateJson = `{"outside":{"counter":9223372036854775807},"mcpServers":{"airdesk":${JSON.stringify(jsonEntry)},"airdesk":${JSON.stringify(jsonEntry)}}}\n`;
  const cases = [
    ['codex', `${toml}${toml}`, /invalid_existing_toml/u],
    ['codex', ambiguousToml, /config_requires_manual_merge/u],
    ['cursor', duplicateJson, /config_requires_manual_merge/u],
    ['cursor', duplicateJson.slice(0, -3), /invalid_existing_json/u],
  ];
  const calls = [];
  await fs.mkdir(path.dirname(options.config));
  for (const [client, original, error] of cases) {
    await fs.writeFile(options.config, original);
    await assert.rejects(install({ ...options, client }, { context, nativeSetup: fakeNative(calls) }), error);
    assert.equal(await fs.readFile(options.config, 'utf8'), original);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await fs.readdir(path.dirname(options.config)), [path.basename(options.config)]);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
});

test('Windows retarget preserves a configuration recreated while publishing the repair', async t => {
  const { options, context, installed } = await windowsRetargetFixture(t);
  await install({ ...options, skipMcp: true });
  const original = configAddition('', installed('1.0.70'));
  const recreated = '[mcp_servers.airdesk]\nurl = "https://example.invalid/mcp"\n';
  await fs.mkdir(path.dirname(options.config));
  await fs.writeFile(options.config, original);
  const calls = [];
  let retainedBackup;
  await assert.rejects(install(options, {
    context, nativeSetup: fakeNative(calls), beforeConfigPublish: async ({ filename, backup }) => {
      retainedBackup = backup;
      await fs.writeFile(filename, recreated, { flag: 'wx' });
    },
  }), error => error.code === 'EEXIST' && error.partialInstall && error.installation.configBackup === retainedBackup);
  assert.equal(await fs.readFile(options.config, 'utf8'), recreated);
  assert.equal(await fs.readFile(retainedBackup, 'utf8'), original);
  assert.deepEqual(calls, [{ binary: options.binary, enabled: false }]);
});

test('dry run neither launches AirDesk nor creates directories', async t => {
  const options = await fixture(t);
  const calls = [];
  assert.equal((await install({ ...options, dryRun: true }, { nativeSetup: fakeNative(calls) })).dryRun, true);
  assert.equal(calls.length, 0);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.dirname(options.config)), { code: 'ENOENT' });
});

test('skill-only mode needs no AirDesk or client configuration', async t => {
  const options = await fixture(t);
  const calls = [];
  const result = await install({ ...options, binary: undefined, skipMcp: true }, { nativeSetup: fakeNative(calls) });
  assert.equal(result.mcp, 'skipped');
  assert.equal(calls.length, 0);
  await assert.rejects(fs.stat(options.config), { code: 'ENOENT' });
});

test('old native app failure does not partially install the skill', async t => {
  const options = await fixture(t);
  await assert.rejects(install(options, { nativeSetup: () => { throw new Error('native_app_update_required'); } }), /native_app_update_required/u);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
});

test('native activation failure is not reported as success and can be retried', async t => {
  const options = await fixture(t);
  await assert.rejects(install(options, { nativeSetup: (_binary, enable) => {
    if (enable) throw new Error('activation_failed');
    return fakeNative([])(_binary, false);
  } }), /activation_failed/u);
  assert.equal((await install(options, { nativeSetup: fakeNative([]) })).mcp, 'enabled-and-registered');
});

test('TOML paths with spaces, Unicode and backslashes round trip', () => {
  for (const binary of ['C:\\Program Files\\AirDesk\\AirDesk.exe', '/Applications/한국어 "name"/AirDesk']) {
    assert.equal(parse(configAddition('', binary)).mcp_servers.airdesk.command, binary);
  }
});

test('invalid, sealed or disabled configurations fail without leaking source text', () => {
  assert.throws(() => configAddition('SECRET_VALUE = [invalid', '/AirDesk'), /^InstallError: invalid_existing_toml$/u);
  assert.throws(() => configAddition('mcp_servers = {}', '/AirDesk'), /config_requires_manual_merge/u);
  assert.throws(() => configAddition('[mcp_servers.airdesk]\ncommand="/AirDesk"\nargs=["--mcp-server"]\nenabled=false', '/AirDesk'), /existing_airdesk_config_conflict/u);
});

test('binary lookup rejects relative paths and wrong filenames', async () => {
  await assert.rejects(findBinary('./AirDesk'), /invalid_binary_path/u);
  await assert.rejects(findBinary('/bin/sh'), /expected_airdesk_executable/u);
  await assert.rejects(findBinary(undefined, 'win32'), /binary_path_required/u);
});

test('CLI help/version work without native startup', async () => {
  const cli = path.join(packageRoot, 'bin', 'cli.mjs');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--skip-mcp/u);
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(version.stdout.trim(), manifest.version);
});

test('CLI rejects malformed options before installation', () => {
  for (const args of [['install', '--binary'], ['install', '--no-such-option'], ['install', '--dry-run', '--dry-run'], ['install', 'constructor', 'ignored']]) {
    const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/cli.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /at file:|node:internal/u);
  }
});

test('missing AI terms stops before any installation writes', async t => {
  const options = await fixture(t);
  await assert.rejects(install(options, { nativeSetup: () => ({ ...fakeNative([])(options.binary, false), termsAccepted: false, termsRequired: true }) }), /ai_remote_access_terms_required/u);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
  await assert.rejects(fs.stat(options.config), { code: 'ENOENT' });
});

test('legacy controller with terminal OFF requires an app update before any write', async t => {
  const options = await fixture(t);
  await assert.rejects(install(options, { nativeSetup: () => ({
    ...fakeNative([])(options.binary, false), remoteTerminalEnabled: false,
  }) }), /native_app_update_required/u);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
  await assert.rejects(fs.stat(options.config), { code: 'ENOENT' });
});

test('compatible controller enables MCP without enabling incoming terminal hosting', async t => {
  const options = await fixture(t);
  const calls = [];
  const setup = fakeNative(calls);
  const result = await install(options, { nativeSetup: (binary, enabled) => ({
    ...setup(binary, enabled), remoteTerminalEnabled: false, localRemoteTerminalRequired: false,
  }) });
  assert.equal(result.mcp, 'enabled-and-registered');
  assert.deepEqual(calls.map(call => call.enabled), [false, true]);
});

test('native setup preserves only allowlisted recovery errors on nonzero exit', async t => {
  if (process.platform === 'win32') return t.skip('Unix executable fixture; injected preflight is covered on every platform');
  const options = await fixture(t);
  for (const [error, expected] of [['ai_remote_access_terms_required', 'ai_remote_access_terms_required'],
    ['mcp_settings_write_failed', 'mcp_settings_write_failed'], ['PRIVATE_SENTINEL', 'native_setup_failed']]) {
    await fs.writeFile(options.binary, `#!/usr/bin/env node\nconsole.log(JSON.stringify({error:${JSON.stringify(error)}})); process.exitCode=1;\n`, { mode: 0o700 });
    assert.throws(() => nativeSetup(options.binary), new RegExp(`^InstallError: ${expected}$`, 'u'));
  }
  await fs.writeFile(options.binary, '#!/usr/bin/env node\nconsole.log(JSON.stringify({mcpSetupVersion:1,clientMcpOnly:true,mcpServerEnabled:true,remoteTerminalEnabled:false,remoteTerminalChanged:false}));\n', { mode: 0o700 });
  assert.throws(() => nativeSetup(options.binary), /^InstallError: native_app_update_required$/u);
});

test('activation failure exposes bounded partial-install state', async t => {
  const options = await fixture(t);
  await assert.rejects(install(options, { nativeSetup: (_binary, enable) => {
    if (enable) throw new Error('PRIVATE_SENTINEL');
    return fakeNative([])(_binary, false);
  } }), error => error.partialInstall === true && error.installation.skillWritten === true && error.installation.configWritten === true);
});

test('old native MCP ON without terms metadata cannot be auto-enabled or installed', async t => {
  const options = await fixture(t);
  await assert.rejects(install(options, { nativeSetup: () => ({ mcpSetupVersion: 1, clientMcpOnly: true,
    mcpServerEnabled: true, remoteTerminalEnabled: false, remoteTerminalChanged: false }) }), /native_app_update_required/u);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
  await assert.rejects(fs.stat(options.config), { code: 'ENOENT' });
  assert.equal((await install({ ...options, skipMcp: true })).skill, 'installed');
});

test('safe Python bytecode cache does not break an unchanged install', async t => {
  const options = await fixture(t);
  const result = await install({ ...options, skipMcp: true });
  const cache = path.join(result.destination, 'scripts', '__pycache__');
  await fs.mkdir(cache);
  await fs.writeFile(path.join(cache, 'airdesk_mcp.cpython-313.pyc'), 'bytecode');
  assert.equal((await install({ ...options, skipMcp: true })).skill, 'unchanged');
  assert.equal(await fs.readFile(path.join(cache, 'airdesk_mcp.cpython-313.pyc'), 'utf8'), 'bytecode');
  await fs.writeFile(path.join(cache, 'notes.txt'), 'user work');
  await assert.rejects(install({ ...options, skipMcp: true, upgrade: true }), /existing_skill_conflict/u);
});

for (const version of ['0.1.0', '0.1.0-git', '0.1.1', '0.1.2', '0.1.3', '0.2.0', '0.3.0']) {
  test(`explicit upgrade recognizes official ${version} and retains the complete old directory`, async t => {
    const options = await fixture(t);
    options.skillsDir = path.join(options.root, ...({ '0.1.0': ['.agents', 'skills'],
      '0.1.0-git': ['.claude', 'skills'], '0.1.1': ['custom-discovery'],
      '0.1.2': ['.agents', 'skills'], '0.1.3': ['.agents', 'skills'],
      '0.2.0': ['.agents', 'skills'], '0.3.0': ['.claude', 'skills'] }[version]));
    const previous = JSON.parse(await fs.readFile(new URL(`./fixtures/releases/${version}.json`, import.meta.url), 'utf8'));
    const destination = path.join(options.skillsDir, 'remote-computer-use');
    for (const [name, data] of Object.entries(previous)) {
      const filename = path.join(destination, name);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, data);
    }
    await assert.rejects(install({ ...options, skipMcp: true }), /skill_upgrade_required/u);
    const plan = await install({ ...options, skipMcp: true, upgrade: true, dryRun: true });
    assert.equal(plan.skill, 'upgrade');
    assert.equal(await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8'), previous['SKILL.md']);
    let staged = false;
    const result = await install({ ...options, skipMcp: true, upgrade: true }, {
      onSkillStaged: async ({ stage, backup }) => {
        staged = true;
        assert.equal(await fs.readFile(path.join(stage, 'SKILL.md'), 'utf8'),
          await fs.readFile(path.join(packageRoot, 'skills/remote-computer-use/SKILL.md'), 'utf8'));
        const discovered = (await fs.readdir(options.skillsDir, { recursive: true }))
          .filter(name => path.basename(name) === 'SKILL.md');
        assert.deepEqual(discovered, [path.join('remote-computer-use', 'SKILL.md')]);
        assert.equal((await fs.stat(stage)).dev, (await fs.stat(destination)).dev);
        assert.equal(path.dirname(stage), path.dirname(backup));
      },
    });
    assert.equal(staged, true);
    assert.equal(result.skill, 'upgraded');
    assert.equal(result.targetVerified, false);
    for (const [name, data] of Object.entries(previous))
      assert.deepEqual(await fs.readFile(path.join(result.backup, name)), Buffer.from(data));
    assert.deepEqual((await fs.readdir(options.skillsDir, { recursive: true }))
      .filter(name => path.basename(name) === 'SKILL.md'), [path.join('remote-computer-use', 'SKILL.md')]);
    assert.deepEqual(await fs.readdir(path.dirname(result.backup)), [path.basename(result.backup)]);
    for (const name of skillFiles) assert.deepEqual(await fs.readFile(path.join(destination, name)),
      await fs.readFile(path.join(packageRoot, 'skills/remote-computer-use', name)));
    assert.equal((await install({ ...options, skipMcp: true, upgrade: true })).skill, 'unchanged');
  });
}

test('upgrade refuses even a one-byte customization and preserves it', async t => {
  const options = await fixture(t);
  const previous = JSON.parse(await fs.readFile(new URL('./fixtures/releases/0.1.1.json', import.meta.url), 'utf8'));
  const destination = path.join(options.skillsDir, 'remote-computer-use');
  for (const [name, data] of Object.entries(previous)) {
    const filename = path.join(destination, name); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, data);
  }
  await fs.appendFile(path.join(destination, 'SKILL.md'), '\nUser note\n');
  await assert.rejects(install({ ...options, skipMcp: true, upgrade: true }), /existing_skill_conflict/u);
  assert((await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8')).endsWith('User note\n'));
});

test('upgrade rechecks the official files after preflight before moving the old directory', async t => {
  const options = await fixture(t);
  const previous = JSON.parse(await fs.readFile(new URL('./fixtures/releases/0.1.1.json', import.meta.url), 'utf8'));
  const destination = path.join(options.skillsDir, 'remote-computer-use');
  for (const [name, data] of Object.entries(previous)) {
    const filename = path.join(destination, name); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, data);
  }
  await assert.rejects(install({ ...options, upgrade: true }, { nativeSetup: () => {
    appendFileSync(path.join(destination, 'SKILL.md'), '\nConcurrent user note\n');
    return fakeNative([])(options.binary, false);
  } }), /skill_changed_concurrently/u);
  assert((await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8')).endsWith('Concurrent user note\n'));
  assert.deepEqual(await fs.readdir(options.skillsDir), ['remote-computer-use']);
  assert.deepEqual((await fs.readdir(options.root)).filter(name => name.startsWith('.airdesk-skill-upgrade-')), []);
  await assert.rejects(fs.stat(options.config), { code: 'ENOENT' });
});

test('JSON client merge preserves other entries and refuses a conflicting AirDesk entry', () => {
  const original = { theme: 'unchanged', mcpServers: { other: { command: 'other' } } };
  const merged = JSON.parse(jsonConfiguration(JSON.stringify(original), '/trusted/AirDesk'));
  assert.equal(merged.theme, original.theme);
  assert.deepEqual(merged.mcpServers.other, original.mcpServers.other);
  assert.deepEqual(merged.mcpServers.airdesk, { command: '/trusted/AirDesk', args: ['--mcp-server'] });
  assert.throws(() => jsonConfiguration('{"mcpServers":{"airdesk":{"command":"other"}}}', '/AirDesk'), /existing_airdesk_config_conflict/u);
  assert.throws(() => jsonConfiguration('PRIVATE_SENTINEL invalid', '/AirDesk'), /^InstallError: invalid_existing_json$/u);
});

test('native AirDesk servers under another name are renamed to airdesk; proxies are preserved', () => {
  const proxy = { command: 'npx', args: ['-y', 'supergateway', '--streamableHttp', 'http://example.invalid/mcp'] };
  const original = { mcpServers: { 'default-server': { command: '/Applications/AirDesk.app/Contents/MacOS/AirDesk', args: ['--mcp-server'] },
    proxy, other: { command: 'other' } } };
  const merged = JSON.parse(jsonConfiguration(JSON.stringify(original), '/trusted/AirDesk'));
  assert.equal(merged.mcpServers['default-server'], undefined);
  assert.deepEqual(merged.mcpServers.airdesk, { command: '/trusted/AirDesk', args: ['--mcp-server'] });
  assert.deepEqual(merged.mcpServers.proxy, proxy);
  assert.deepEqual(merged.mcpServers.other, { command: 'other' });
  // An already-correct airdesk entry stays; only the duplicate alias is removed.
  const both = { mcpServers: { airdesk: { command: '/trusted/AirDesk', args: ['--mcp-server'] },
    legacy: { command: 'C:\\Program Files\\AirDesk\\AirDesk.exe', args: ['--mcp-server'] } } };
  assert.deepEqual(Object.keys(JSON.parse(jsonConfiguration(JSON.stringify(both), '/trusted/AirDesk')).mcpServers), ['airdesk']);
  assert.equal(jsonConfiguration(JSON.stringify({ mcpServers: { airdesk: both.mcpServers.airdesk, proxy } }), '/trusted/AirDesk'),
    JSON.stringify({ mcpServers: { airdesk: both.mcpServers.airdesk, proxy } }));
});

test('Codex aliases are removed as whole blocks, keeping comments and other servers', () => {
  const original = '# keep me\nmodel = "x"\n\n[mcp_servers.default-server]\ncommand = "/Applications/AirDesk.app/Contents/MacOS/AirDesk"\n' +
    'args = ["--mcp-server"]\n\n[mcp_servers.default-server.env]\nA = "1"\n\n# proxy stays\n[mcp_servers.proxy]\ncommand = "npx"\n' +
    'args = ["supergateway", "--streamableHttp", "http://example.invalid/mcp"]\n';
  const removed = removeCodexAliases(original, ['default-server']);
  assert.match(removed, /# keep me/u);
  assert.match(removed, /# proxy stays/u);
  const config = parse(removed + configAddition(removed, '/trusted/AirDesk'));
  assert.equal(config.mcp_servers['default-server'], undefined);
  assert.equal(config.mcp_servers.airdesk.command, '/trusted/AirDesk');
  assert.equal(config.mcp_servers.proxy.command, 'npx');
  assert.equal(config.model, 'x');
  // An alias defined inline cannot be removed as a block: the text is left unchanged.
  const inline = '[mcp_servers]\nlegacy = { command = "/x/AirDesk", args = ["--mcp-server"] }\n';
  assert.equal(removeCodexAliases(inline, ['legacy']), inline);
});

for (const client of ['claude-code', 'claude-desktop', 'generic']) {
  test(`${client} uses only the explicit JSON config and retains its prior contents as a backup`, async t => {
    const options = await fixture(t);
    const config = path.join(options.root, 'selected-client.json');
    const original = '{"mcpServers":{"other":{"command":"preserve"}},"custom":true}\n';
    await fs.writeFile(config, original);
    const result = await install({ ...options, client, config }, { nativeSetup: fakeNative([]) });
    assert.equal(await fs.readFile(result.configBackup, 'utf8'), original);
    const parsed = JSON.parse(await fs.readFile(config, 'utf8'));
    assert.equal(parsed.custom, true); assert.equal(parsed.mcpServers.other.command, 'preserve');
    assert.equal(parsed.mcpServers.airdesk.command, options.binary);
    const before = await fs.readFile(config);
    assert.equal((await install({ ...options, client, config }, { nativeSetup: fakeNative([]) })).skill, 'unchanged');
    assert.deepEqual(await fs.readFile(config), before);
    if (client === 'generic') await assert.rejects(install({ ...options, client, config: undefined }), /config_path_required/u);
  });
}

test('JSON client recreation after the original was moved reports its backup and partial mutation', async t => {
  const options = await fixture(t);
  await install({ ...options, skipMcp: true }); // Keep the skill unchanged to isolate config mutation.
  const config = path.join(options.root, 'selected-client.json');
  const original = '{"mcpServers":{"original":{"command":"preserve"}},"custom":true}\n';
  const recreated = '{"mcpServers":{"concurrent":{"command":"client-recreated"}}}\n';
  await fs.writeFile(config, original);
  const calls = [];
  let retainedBackup;
  await assert.rejects(install({ ...options, client: 'claude-code', config }, {
    nativeSetup: fakeNative(calls),
    beforeConfigPublish: async ({ filename, backup }) => {
      retainedBackup = backup;
      assert.equal(await fs.readFile(backup, 'utf8'), original);
      await fs.writeFile(filename, recreated, { flag: 'wx' });
    },
  }), error => {
    assert.equal(error.code, 'EEXIST');
    assert.equal(error.configMutated, true);
    assert.equal(error.configBackup, retainedBackup);
    assert.equal(error.partialInstall, true);
    assert.equal(error.installation.skillWritten, false);
    assert.equal(error.installation.configWritten, true);
    assert.equal(error.installation.configBackup, retainedBackup);
    return true;
  });
  assert.equal(await fs.readFile(config, 'utf8'), recreated);
  assert.equal(await fs.readFile(retainedBackup, 'utf8'), original);
  assert.deepEqual(calls.map(call => call.enabled), [false]);
  assert.deepEqual((await fs.readdir(options.root)).filter(name => name.includes('airdesk-install')), []);
});

test('CLI dry run never claims target installation or access was checked', async t => {
  const options = await fixture(t);
  const result = spawnSync(process.execPath, [path.join(packageRoot, 'bin/cli.mjs'), 'install', '--skip-mcp', '--dry-run', '--skills-dir', options.skillsDir], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /targetVerified": false/u);
  assert.match(result.stdout, /Confirm target installation, hosting and approved access before connecting/u);
  assert.doesNotMatch(result.stdout, /Target setup: AirDesk installed and access approved/u);
});

test('Claude Code uses its documented personal skill directory', () => {
  const home = path.resolve('/fixture');
  assert.equal(defaultSkillsDir('claude-code', home), path.join(home, '.claude', 'skills'));
  assert.equal(defaultSkillsDir('codex', home), path.join(home, '.agents', 'skills'));
});

const fixtureContext = root => ({ home: root, platform: 'darwin', env: {} });

test('every supported client resolves an absolute config and skill root under its home', () => {
  const home = path.resolve('/fixture');
  for (const id of clientIds) {
    const client = resolveClient(id, fixtureContext(home));
    assert(path.isAbsolute(client.skills) && client.skills.startsWith(home), id);
    if (id === 'generic') assert.equal(client.config, null);
    else assert(path.isAbsolute(client.config) && client.config.startsWith(home), id);
  }
  const at = id => resolveClient(id, fixtureContext(home));
  const under = name => path.join(home, name);
  assert.equal(at('claude-code').config, under('.claude.json'));
  assert.equal(at('cursor').config, under('.cursor/mcp.json'));
  assert.equal(at('cursor').skills, under('.cursor/skills'));
  assert.equal(at('windsurf').config, under('.codeium/windsurf/mcp_config.json'));
  assert.equal(at('gemini-cli').config, under('.gemini/settings.json'));
  assert.equal(at('vscode').config, under('Library/Application Support/Code/User/mcp.json'));
  assert.equal(at('opencode').config, under('.config/opencode/opencode.json'));
  assert.equal(at('codex').config, under('.codex/config.toml'));
  const codexHome = path.resolve('/c');
  const appData = path.resolve('/a');
  assert.equal(resolveClient('codex', { home, platform: 'linux', env: { CODEX_HOME: codexHome } }).config, path.join(codexHome, 'config.toml'));
  assert.equal(resolveClient('vscode', { home, platform: 'win32', env: { APPDATA: appData } }).config, path.join(appData, 'Code', 'User', 'mcp.json'));
});

test('client-specific JSON dialects use each client key and entry shape', () => {
  const binary = '/trusted/AirDesk';
  assert.deepEqual(JSON.parse(jsonConfiguration('{"servers":{"x":{"type":"http","url":"u"}}}', binary, 'vscode')).servers,
    { x: { type: 'http', url: 'u' }, airdesk: { type: 'stdio', command: binary, args: ['--mcp-server'] } });
  assert.deepEqual(JSON.parse(jsonConfiguration('', binary, 'copilot')).mcpServers.airdesk,
    { type: 'stdio', command: binary, args: ['--mcp-server'], tools: ['*'] });
  const opencode = JSON.parse(jsonConfiguration('{"$schema":"https://opencode.ai/config.json","mcp":{"legacy":{"type":"local","command":["/Applications/AirDesk.app/Contents/MacOS/AirDesk","--mcp-server"]}}}', binary, 'opencode'));
  assert.equal(opencode.$schema, 'https://opencode.ai/config.json');
  assert.deepEqual(opencode.mcp, { airdesk: { type: 'local', command: [binary, '--mcp-server'], enabled: true } });
  // Already-correct entries are left byte-identical; wrong shapes for the dialect conflict.
  const current = JSON.stringify({ mcp: { airdesk: { type: 'local', command: [binary, '--mcp-server'], enabled: true } } });
  assert.equal(jsonConfiguration(current, binary, 'opencode'), current);
  assert.throws(() => jsonConfiguration(JSON.stringify({ mcp: { airdesk: { command: binary, args: ['--mcp-server'] } } }), binary, 'opencode'),
    /existing_airdesk_config_conflict/u);
  assert.throws(() => jsonConfiguration(JSON.stringify({ servers: { airdesk: { type: 'http', url: 'x' } } }), binary, 'vscode'),
    /existing_airdesk_config_conflict/u);
  const added = JSON.stringify({ mcpServers: { airdesk: { type: 'stdio', command: binary, args: ['--mcp-server'], env: {} } } });
  assert.equal(jsonConfiguration(added, binary), added); // `claude mcp add` shape
  assert.throws(() => jsonConfiguration(JSON.stringify({ mcpServers: { airdesk: { command: binary, args: ['--mcp-server'], env: { A: '1' } } } }), binary),
    /existing_airdesk_config_conflict/u);
  assert.equal(isNativeAirdeskServer({ type: 'local', command: ['C:\\AirDesk\\AirDesk.exe', '--mcp-server'] }), true);
  assert.equal(isNativeAirdeskServer({ type: 'remote', url: 'http://x' }), false);
});

test('client selection accepts lists and detected clients, and rejects unknown ids', async t => {
  const { root } = await fixture(t);
  const context = fixtureContext(root);
  assert.deepEqual(await selectClients('cursor, claude-code,cursor', context), ['cursor', 'claude-code']);
  await assert.rejects(selectClients('cursor,nope', context), /unsupported_client/u);
  await assert.rejects(selectClients('detected', context), /no_supported_clients_detected/u);
  await fs.mkdir(path.join(root, '.cursor'));
  await fs.mkdir(path.join(root, '.gemini'));
  assert.deepEqual(await selectClients('detected', context), ['cursor', 'gemini-cli']);
});

test('detected install registers every present client, dedupes skill roots, and enables MCP once', async t => {
  const { root, binary } = await fixture(t);
  const context = fixtureContext(root);
  for (const marker of ['.cursor', '.codex', '.claude', '.config/opencode']) await fs.mkdir(path.join(root, marker), { recursive: true });
  await fs.writeFile(path.join(root, '.claude.json'), '{"numStartups":3,"mcpServers":{"other":{"command":"keep"}}}\n');
  await assert.rejects(install({ client: 'detected', binary, skillsDir: path.join(root, 'x') }, { context }), /option_requires_single_client/u);
  const plan = await install({ client: 'detected', binary, dryRun: true }, { context, nativeSetup: () => assert.fail('dry run') });
  assert.deepEqual(plan.clients.map(c => c.client), ['codex', 'claude-code', 'cursor', 'opencode']);
  const calls = [];
  const result = await install({ client: 'detected', binary }, { context, nativeSetup: fakeNative(calls) });
  assert.deepEqual(calls.map(c => c.enabled), [false, true]);
  assert.equal(result.mcp, 'enabled-and-registered');
  for (const dir of ['.agents/skills', '.claude/skills', '.cursor/skills', '.config/opencode/skills'])
    assert((await fs.stat(path.join(root, dir, 'remote-computer-use', 'SKILL.md'))).isFile(), dir);
  assert.equal(parse(await fs.readFile(path.join(root, '.codex', 'config.toml'), 'utf8')).mcp_servers.airdesk.command, binary);
  const claude = JSON.parse(await fs.readFile(path.join(root, '.claude.json'), 'utf8'));
  assert.equal(claude.numStartups, 3); assert.equal(claude.mcpServers.other.command, 'keep');
  assert.equal(claude.mcpServers.airdesk.command, binary);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.cursor', 'mcp.json'), 'utf8')).mcpServers.airdesk, { command: binary, args: ['--mcp-server'] });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.config', 'opencode', 'opencode.json'), 'utf8')).mcp.airdesk.command, [binary, '--mcp-server']);
  // Rerunning changes nothing.
  const again = await install({ client: 'detected', binary }, { context, nativeSetup: fakeNative([]) });
  assert(again.clients.every(c => c.skill === 'unchanged'));
});

test('a conflict in any selected client stops before any write', async t => {
  const { root, binary } = await fixture(t);
  const context = fixtureContext(root);
  await fs.mkdir(path.join(root, '.cursor'));
  await fs.writeFile(path.join(root, '.cursor', 'mcp.json'), '{"mcpServers":{"airdesk":{"command":"other"}}}');
  const calls = [];
  await assert.rejects(install({ client: 'claude-code,cursor', binary }, { context, nativeSetup: fakeNative(calls) }), /existing_airdesk_config_conflict/u);
  assert.deepEqual(calls, []);
  await assert.rejects(fs.stat(path.join(root, '.claude', 'skills')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(root, '.claude.json')), { code: 'ENOENT' });
});

// ---- Languages ----

const english = name => fs.readFile(path.join(packageRoot, 'skills/remote-computer-use', name));
const overlay = async (lang, name) => fs.readFile(path.join(packageRoot, 'locales', lang, name)).catch(() => english(name));

async function assertLinksStayInside(destination) {
  for (const name of skillFiles.filter(name => name.endsWith('.md'))) {
    const document = path.join(destination, name);
    for (const [, target] of (await fs.readFile(document, 'utf8')).matchAll(/\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)/gu)) {
      const reference = new URL(target, pathToFileURL(document));
      if (reference.protocol !== 'file:') continue;
      const relative = path.relative(destination, fileURLToPath(reference));
      assert(!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${name} links outside: ${target}`);
      assert((await fs.stat(fileURLToPath(reference))).isFile(), `${name} links to a missing file: ${target}`);
    }
  }
}

for (const lang of languages) {
  test(`${lang} install copies the ${lang} overlay over the English skill under the same name`, async t => {
    const options = await fixture(t);
    const result = await install({ ...options, skipMcp: true, lang });
    assert.equal(result.lang, lang);
    assert.equal(path.basename(result.destination), 'remote-computer-use');
    for (const name of skillFiles) assert.deepEqual(await fs.readFile(path.join(result.destination, name)), await overlay(lang, name), name);
    assert.match(await fs.readFile(path.join(result.destination, 'SKILL.md'), 'utf8'), /^---\nname: remote-computer-use\n/u);
    await assertLinksStayInside(result.destination);
    assert.equal((await install({ ...options, skipMcp: true, lang })).skill, 'unchanged');
  });
}

test('switching language needs --upgrade and retains the previous language as a backup', async t => {
  const options = await fixture(t);
  await install({ ...options, skipMcp: true, lang: 'en' });
  await assert.rejects(install({ ...options, skipMcp: true, lang: 'ko' }), /skill_upgrade_required/u);
  const result = await install({ ...options, skipMcp: true, lang: 'ko', upgrade: true });
  assert.equal(result.skill, 'upgraded');
  assert.equal(result.previousVersion, `${result.bundledVersion}-en`);
  assert.deepEqual(await fs.readFile(path.join(result.backup, 'SKILL.md')), await english('SKILL.md'));
  assert.deepEqual(await fs.readFile(path.join(result.destination, 'SKILL.md')), await overlay('ko', 'SKILL.md'));
  // A customized copy is never treated as another language.
  await fs.appendFile(path.join(result.destination, 'SKILL.md'), '\nnote\n');
  await assert.rejects(install({ ...options, skipMcp: true, lang: 'ja', upgrade: true }), /existing_skill_conflict/u);
});

test('unsupported languages are refused before any write', async t => {
  const options = await fixture(t);
  await assert.rejects(install({ ...options, skipMcp: true, lang: 'fr' }), /unsupported_language/u);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
});

test('language detection follows the locale and falls back to English', () => {
  assert.equal(detectLanguage({ LANG: 'ko_KR.UTF-8' }, 'en-US'), 'ko');
  assert.equal(detectLanguage({ LC_ALL: 'ja_JP.UTF-8', LANG: 'ko_KR.UTF-8' }, 'en-US'), 'ja');
  assert.equal(detectLanguage({ LANG: 'C.UTF-8' }, 'ja-JP'), 'ja');
  assert.equal(detectLanguage({ LANG: 'fr_FR.UTF-8' }, 'ko-KR'), 'en');
  assert.equal(detectLanguage({ AIRDESK_SKILL_LANG: 'ko', LANG: 'en_US' }, 'en-US'), 'ko');
  assert.equal(detectLanguage({}, 'de-DE'), 'en');
});

// ---- Online MCP ----

const refuseNative = { nativeSetup: () => assert.fail('online mode never launches AirDesk') };

test('online OAuth registers only the endpoint for Codex and never launches AirDesk', async t => {
  const options = await fixture(t);
  const original = '# keep\nmodel = "x"\n';
  await fs.mkdir(path.dirname(options.config));
  await fs.writeFile(options.config, original);
  const result = await install({ skillsDir: options.skillsDir, config: options.config, mode: 'online' }, refuseNative);
  assert.equal(result.mcp, 'online-registered');
  assert.equal(result.endpoint, onlineEndpoint);
  assert.match(result.signIn, /codex mcp login airdesk/u);
  const text = await fs.readFile(options.config, 'utf8');
  assert(text.startsWith(original));
  const server = parse(text).mcp_servers.airdesk;
  assert.deepEqual({ ...server }, { url: onlineEndpoint, startup_timeout_sec: 20, tool_timeout_sec: 120 });
  const again = await install({ skillsDir: options.skillsDir, config: options.config, mode: 'online' }, refuseNative);
  assert.equal(again.mcp, 'online-unchanged');
  assert.equal(await fs.readFile(options.config, 'utf8'), text);
});

test('online key auth references the environment variable and never writes a key', async t => {
  const options = await fixture(t);
  await install({ skillsDir: options.skillsDir, config: options.config, mode: 'online', auth: 'key' }, refuseNative);
  const text = await fs.readFile(options.config, 'utf8');
  assert.equal(parse(text).mcp_servers.airdesk.bearer_token_env_var, onlineKeyVariable);
  assert.doesNotMatch(text, /amk_/u);
  // An OAuth entry and a key entry are different registrations.
  await assert.rejects(install({ skillsDir: options.skillsDir, config: options.config, mode: 'online' }, refuseNative),
    /existing_airdesk_config_conflict/u);
});

test('online JSON entries follow each client dialect', async t => {
  const options = await fixture(t);
  const expected = {
    'claude-code': [{ type: 'http', url: onlineEndpoint },
      { type: 'http', url: onlineEndpoint, headers: { Authorization: 'Bearer ${AIRDESK_MCP_KEY}' } }, 'mcpServers'],
    'cursor': [{ url: onlineEndpoint }, { url: onlineEndpoint, headers: { Authorization: 'Bearer ${env:AIRDESK_MCP_KEY}' } }, 'mcpServers'],
    'vscode': [{ type: 'http', url: onlineEndpoint }, null, 'servers'],
    'gemini-cli': [{ httpUrl: onlineEndpoint }, null, 'mcpServers'],
    'opencode': [{ type: 'remote', url: onlineEndpoint },
      { type: 'remote', url: onlineEndpoint, oauth: false, headers: { Authorization: 'Bearer {env:AIRDESK_MCP_KEY}' } }, 'mcp'],
    'generic': [{ type: 'http', url: onlineEndpoint }, null, 'mcpServers'],
  };
  for (const [client, [oauth, key, table]] of Object.entries(expected)) {
    for (const [auth, entry] of [['oauth', oauth], ['key', key]]) {
      const config = path.join(options.root, `${client}-${auth}.json`);
      await fs.writeFile(config, '{"keep":1}');
      const run = install({ client, config, skillsDir: path.join(options.root, 'skills', client), mode: 'online', auth }, refuseNative);
      if (!entry) { await assert.rejects(run, /online_key_auth_unsupported/u); continue; }
      await run;
      const parsed = JSON.parse(await fs.readFile(config, 'utf8'));
      assert.equal(parsed.keep, 1);
      assert.deepEqual(parsed[table].airdesk, entry, `${client} ${auth}`);
    }
  }
});

test('online mode refuses clients that add remote servers only in their UI, before any write', async t => {
  const options = await fixture(t);
  const config = path.join(options.root, 'claude_desktop_config.json');
  await assert.rejects(install({ client: 'claude-desktop', config, skillsDir: options.skillsDir, mode: 'online' }, refuseNative),
    /online_client_unsupported/u);
  await assert.rejects(install({ client: 'windsurf', config, skillsDir: options.skillsDir, mode: 'online' }, refuseNative),
    /online_client_unsupported/u);
  await assert.rejects(fs.stat(options.skillsDir), { code: 'ENOENT' });
  await assert.rejects(fs.stat(config), { code: 'ENOENT' });
});

test('online mode never replaces a local native entry, and option combinations are checked', async t => {
  const options = await fixture(t);
  const config = path.join(options.root, 'claude.json');
  const local = JSON.stringify({ mcpServers: { airdesk: { command: options.binary, args: ['--mcp-server'] } } });
  await fs.writeFile(config, local);
  await assert.rejects(install({ client: 'claude-code', config, skillsDir: options.skillsDir, mode: 'online' }, refuseNative),
    /existing_airdesk_config_conflict/u);
  assert.equal(await fs.readFile(config, 'utf8'), local);
  await assert.rejects(install({ ...options, auth: 'key' }), /auth_requires_online_mode/u);
  await assert.rejects(install({ ...options, mode: 'online' }), /binary_requires_local_mode/u);
  await assert.rejects(install({ ...options, mode: 'cloud' }), /unsupported_mode/u);
  const plan = await install({ client: 'claude-code', config: path.join(options.root, 'new.json'), skillsDir: options.skillsDir,
    mode: 'online', dryRun: true }, refuseNative);
  assert.equal(plan.mcp, 'planned');
  assert.match(plan.signIn, /\/mcp/u);
  await assert.rejects(fs.stat(path.join(options.root, 'new.json')), { code: 'ENOENT' });
});

// ---- Packaging ----

function unzipEntries(archive) {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50);
    const size = archive.readUInt32LE(offset + 24), nameLength = archive.readUInt16LE(offset + 28);
    const crc = archive.readUInt32LE(offset + 16), local = archive.readUInt32LE(offset + 42);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = local + 30 + archive.readUInt16LE(local + 26);
    const data = archive.subarray(start, start + size);
    if (zlib.crc32) assert.equal(zlib.crc32(data), crc, name);
    entries.set(name, data);
    offset += 46 + nameLength;
  }
  return entries;
}

test('pack writes an uploadable skill zip and a plugin zip in the chosen language', async t => {
  const { root } = await fixture(t);
  const cli = path.join(packageRoot, 'bin/cli.mjs');
  const skillZip = path.join(root, 'skill.zip');
  const packed = spawnSync(process.execPath, [cli, 'pack', '--lang', 'ja', '--out', skillZip], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const skill = unzipEntries(await fs.readFile(skillZip));
  assert.deepEqual([...skill.keys()], skillFiles.map(name => `remote-computer-use/${name}`));
  assert.deepEqual(skill.get('remote-computer-use/SKILL.md'), await overlay('ja', 'SKILL.md'));
  // Never overwrite an existing file.
  assert.equal(spawnSync(process.execPath, [cli, 'pack', '--lang', 'ja', '--out', skillZip], { encoding: 'utf8' }).status, 1);
  const pluginZip = path.join(root, 'plugin.zip');
  assert.equal(spawnSync(process.execPath, [cli, 'pack', '--lang', 'ko', '--format', 'plugin', '--out', pluginZip]).status, 0);
  const plugin = unzipEntries(await fs.readFile(pluginZip));
  const manifest = JSON.parse(plugin.get('remote-computer-use-ko/.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'remote-computer-use-ko');
  assert.deepEqual(manifest.mcpServers.airdesk, { type: 'http', url: onlineEndpoint });
  assert.deepEqual(plugin.get('remote-computer-use-ko/skills/remote-computer-use/SKILL.md'), await overlay('ko', 'SKILL.md'));
});

test('committed marketplace plugins match the skill and overlays', () => {
  const result = spawnSync(process.execPath, [path.join(packageRoot, 'scripts/build-plugins.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

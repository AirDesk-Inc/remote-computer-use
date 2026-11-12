import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'smol-toml';
import { clientContext, clientIds, knownSkillRoots, resolveClient } from './clients.mjs';
import { BundleError, bundledSkill, languages, normalizeLanguage, onlineEndpoint, onlineKeyVariable, skillName } from './bundle.mjs';

export { clientIds, defaultSkillsDir, resolveClient } from './clients.mjs';
export { detectLanguage, languages, onlineEndpoint, onlineKeyVariable, packageRoot, skillFiles, skillName } from './bundle.mjs';

export const InstallError = BundleError;

// Online MCP entries per client dialect. `oauth` registers only the endpoint and
// lets the client run the MCP authorization flow; `key` references the API key
// through the client's own environment-variable syntax. A key is never written.
const keyHeader = reference => ({ Authorization: `Bearer ${reference}` });
export const onlineDialects = {
  claude: { oauth: () => ({ type: 'http', url: onlineEndpoint }),
    key: () => ({ type: 'http', url: onlineEndpoint, headers: keyHeader(`\${${onlineKeyVariable}}`) }) },
  cursor: { oauth: () => ({ url: onlineEndpoint }),
    key: () => ({ url: onlineEndpoint, headers: keyHeader(`\${env:${onlineKeyVariable}}`) }) },
  vscode: { oauth: () => ({ type: 'http', url: onlineEndpoint }) },
  gemini: { oauth: () => ({ httpUrl: onlineEndpoint }) },
  opencode: { oauth: () => ({ type: 'remote', url: onlineEndpoint }),
    key: () => ({ type: 'remote', url: onlineEndpoint, oauth: false, headers: keyHeader(`{env:${onlineKeyVariable}}`) }) },
  generic: { oauth: () => ({ type: 'http', url: onlineEndpoint }) },
  codex: { oauth: () => ({}), key: () => ({}) },
};

export function onlineEntry(client, auth = 'oauth') {
  const dialect = onlineDialects[client.online];
  if (!dialect) throw new InstallError('online_client_unsupported');
  if (!dialect[auth]) throw new InstallError(auth === 'key' ? 'online_key_auth_unsupported' : 'unsupported_auth');
  return dialect[auth]();
}

// JSON configuration dialects: where the server table lives and the entry each client expects.
const jsonFormats = {
  mcpServers: { key: 'mcpServers', entry: binary => ({ command: binary, args: ['--mcp-server'] }) },
  vscode: { key: 'servers', entry: binary => ({ type: 'stdio', command: binary, args: ['--mcp-server'] }) },
  copilot: { key: 'mcpServers', entry: binary => ({ type: 'stdio', command: binary, args: ['--mcp-server'], tools: ['*'] }) },
  opencode: { key: 'mcp', entry: binary => ({ type: 'local', command: [binary, '--mcp-server'], enabled: true }) },
};
// ~/.claude.json and similar client state files routinely exceed 1 MiB.
const maxJsonConfig = 16 * 1024 * 1024;
const maxTomlConfig = 1024 * 1024;
const nativeErrors = new Set(['ai_remote_access_terms_required', 'mcp_settings_write_failed',
  'policy_unavailable', 'mcp_disabled', 'mcp_gui_closed', 'remote_terminal_required']);
const releaseManifest = JSON.parse(await fs.readFile(new URL('./skill-releases.json', import.meta.url), 'utf8'));
const packageVersion = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const sha256 = data => createHash('sha256').update(data).digest('hex');
function requireConsentStatus(status) {
  if (!status || typeof status.termsAccepted !== 'boolean' || typeof status.termsRequired !== 'boolean' ||
      typeof status.termsVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(status.termsVersion))
    throw new InstallError('native_app_update_required');
  if (status.blockedReason === 'policy_unavailable') throw new InstallError('policy_unavailable');
  if (status.termsRequired || !status.termsAccepted || status.blockedReason === 'ai_remote_access_terms_required')
    throw new InstallError('ai_remote_access_terms_required');
}
function matchesRelease(files, release) {
  return files.size === Object.keys(release.files).length &&
    [...files].every(([name, data]) => release.files[name] === sha256(data));
}

async function statOrNull(filename) {
  try { return await fs.lstat(filename); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function findBinary(value, platform = process.platform) {
  if (!value && platform !== 'darwin') throw new InstallError('binary_path_required');
  let filename = value || '/Applications/AirDesk.app/Contents/MacOS/AirDesk';
  if (!path.isAbsolute(filename) || /[\x00-\x1f\x7f]/u.test(filename)) throw new InstallError('invalid_binary_path');
  if (path.basename(filename) === 'AirDesk.app') filename = path.join(filename, 'Contents', 'MacOS', 'AirDesk');
  if (!['AirDesk', 'AirDesk.exe'].includes(path.basename(filename))) throw new InstallError('expected_airdesk_executable');
  const info = await fs.stat(filename).catch(() => null);
  if (!info?.isFile()) throw new InstallError('airdesk_not_found');
  if (platform !== 'win32') await fs.access(filename, constants.X_OK).catch(() => { throw new InstallError('airdesk_not_executable'); });
  return filename;
}

export function nativeSetup(binary, enable = false) {
  // --mcp-server keeps older apps in stdio mode, never launching a GUI for an unknown setup flag.
  const args = ['--mcp-server', '--mcp-setup', ...(enable ? ['--enable-mcp'] : [])];
  const env = { ...process.env };
  for (const key of ['REPC_STATE_DIR', 'REPC_MCP_AUTH_TOKEN', 'REPC_BACKEND_URL',
    'AIRDESK_STATE_DIR', 'AIRDESK_MCP_AUTH_TOKEN', 'AIRDESK_BACKEND_URL']) delete env[key];
  const result = spawnSync(binary, args, {
    input: '', encoding: 'utf8', timeout: 10000, maxBuffer: 65536,
    stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false, env,
  });
  let status;
  try { status = JSON.parse(result.stdout); }
  catch { throw new InstallError(result.error || result.status !== 0 ? 'native_setup_failed' : 'native_app_update_required'); }
  // Preserve only known recovery codes, never arbitrary native stdout/stderr.
  if (nativeErrors.has(status?.error)) throw new InstallError(status.error);
  if (result.error || result.status !== 0) throw new InstallError('native_setup_failed');
  if (status?.mcpSetupVersion !== 1 || status.clientMcpOnly !== true ||
      typeof status.mcpServerEnabled !== 'boolean' || typeof status.remoteTerminalEnabled !== 'boolean' ||
      status.remoteTerminalChanged !== false) throw new InstallError('native_app_update_required');
  for (const name of ['termsAccepted', 'termsRequired', 'mcpConfigured']) {
    if (name in status && typeof status[name] !== 'boolean') throw new InstallError('native_app_update_required');
  }
  if ('localRemoteTerminalRequired' in status && typeof status.localRemoteTerminalRequired !== 'boolean')
    throw new InstallError('native_app_update_required');
  requireConsentStatus(status);
  if (enable && !status.mcpServerEnabled) throw new InstallError('native_mcp_not_enabled');
  return status;
}

// An MCP entry that is unmistakably the native AirDesk stdio server registered
// under another name (for example `default-server`). Remote proxies, URLs and
// other launchers are not identifiable as AirDesk and are always preserved.
// Normalize `{command, args}` and OpenCode's `{command: [cmd, ...args]}` launchers.
function launcher(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.url || entry.serverUrl || entry.httpUrl) return null;
  const type = entry.type === 'local' ? 'stdio' : entry.type;
  if (Array.isArray(entry.command)) return { command: entry.command[0], args: entry.command.slice(1), type, array: true };
  return { command: entry.command, args: entry.args, type, array: false };
}

export function isNativeAirdeskServer(entry) {
  const run = launcher(entry);
  if (!run || typeof run.command !== 'string' || !Array.isArray(run.args) || !run.args.includes('--mcp-server')) return false;
  if (run.type !== undefined && run.type !== 'stdio') return false;
  return ['AirDesk', 'AirDesk.exe'].includes(run.command.split(/[\\/]/u).pop());
}

function isExpectedEntry(entry, binary, format) {
  const run = launcher(entry);
  return !!run && run.array === (format === 'opencode') && run.command === binary &&
    JSON.stringify(run.args) === '["--mcp-server"]' && (!run.type || run.type === 'stdio') &&
    entry.disabled !== true && entry.enabled !== false && isEmpty(entry.env) && isEmpty(entry.environment);
}

// Clients such as `claude mcp add` write `"env": {}`; only a non-empty environment is a customization.
const isEmpty = value => value === undefined || (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);

function nativeAliases(servers) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
  return Object.keys(servers).filter(name => name !== 'airdesk' && isNativeAirdeskServer(servers[name]));
}

function standardWindowsAppRoot(context) {
  const local = context.env.LOCALAPPDATA;
  return context.platform === 'win32' && local && path.isAbsolute(local) ? path.resolve(local, 'AirDesk', 'app') : undefined;
}

const windowsPathKey = value => path.resolve(value).toLowerCase();
function installedWindowsApp(binary, root) {
  if (typeof binary !== 'string' || !path.isAbsolute(binary) || path.basename(binary).toLowerCase() !== 'airdesk.exe') return null;
  const folder = path.dirname(path.resolve(binary));
  const match = /^app-([0-9][0-9a-z.-]*)-(x64|arm64)$/iu.exec(path.basename(folder));
  return match && windowsPathKey(path.dirname(folder)) === windowsPathKey(root) ? { folder, arch: match[2].toLowerCase() } : null;
}

async function pathResolvesToItself(filename, allowMissing = false) {
  try { return windowsPathKey(await fs.realpath(filename)) === windowsPathKey(filename); }
  catch (error) { return allowMissing && error.code === 'ENOENT'; }
}

function commandTokenInToml(text) {
  const tables = [...text.matchAll(/^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*(?:airdesk|"airdesk"|'airdesk')[ \t]*\][ \t]*(?:#[^\r\n]*)?\r?$/gmu)];
  if (tables.length !== 1) return null;
  const offset = tables[0].index + tables[0][0].length;
  const body = text.slice(offset).split(/^[ \t]*\[/mu, 1)[0];
  const commands = [...body.matchAll(/^[ \t]*command[ \t]*=[ \t]*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')[ \t]*(?:#[^\r\n]*)?\r?$/dgmu)];
  if (commands.length !== 1) return null;
  return commands[0].indices[1].map(index => offset + index);
}

function commandTokenInJson(text, fields, array) {
  // The config has already passed JSON.parse. Walk only the required object
  // members and skip complete values in between to preserve all other bytes.
  const token = /\s*("(?:[^"\\]|\\.)*"|[{}\[\],:]|[^\s{}\[\],:"]+)/dgyu;
  const next = () => token.exec(text);
  for (const field of fields) {
    if (next()?.[1] !== '{') return null;
    let found = false;
    for (let key = next(); key && key[1] !== '}'; key = next()) {
      if (next()?.[1] !== ':') return null;
      if (JSON.parse(key[1]) === field) { found = true; break; }
      let depth = 0;
      do {
        const value = next()?.[1];
        if (!value) return null;
        if (value === '{' || value === '[') depth++;
        if (value === '}' || value === ']') depth--;
      } while (depth > 0);
      if (next()?.[1] !== ',') break;
    }
    if (!found) return null;
  }
  if (array && next()?.[1] !== '[') return null;
  const command = next();
  return command?.[1]?.startsWith('"') ? command.indices[1] : null;
}

async function retargetWindowsRegistration(original, binary, format, online, root) {
  if (online || !root || !binary || !original.trim()) return null;
  const target = installedWindowsApp(binary, root);
  if (!target) return null;
  const toml = format === 'codex';
  const dialect = jsonFormats[format];
  const key = toml ? 'mcp_servers' : dialect.key;
  const parseConfig = toml ? parse : JSON.parse;
  let config;
  try { config = parseConfig(original); } catch { return null; }
  const entry = config?.[key]?.airdesk;
  const previous = launcher(entry)?.command;
  const source = installedWindowsApp(previous, root);
  if (!source || source.arch !== target.arch) return null;
  const expected = toml ? { command: previous, args: ['--mcp-server'], startup_timeout_sec: 20, tool_timeout_sec: 60 } : dialect.entry(previous);
  if (Object.keys(entry).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([name, value]) => !sameValue(entry[name], value))) return null;
  if (previous === binary) return null; // Use the existing exact-path registration flow.
  if (windowsPathKey(previous) === windowsPathKey(binary)) return original;
  if (!await pathResolvesToItself(binary) || !await pathResolvesToItself(source.folder, true) ||
      !await pathResolvesToItself(previous, true)) return null;

  const array = format === 'opencode';
  const range = toml ? commandTokenInToml(original) : commandTokenInJson(original, [key, 'airdesk', 'command'], array);
  if (!range) throw new InstallError('config_requires_manual_merge');
  const [start, end] = range;
  if (array) entry.command[0] = binary; else entry.command = binary;
  const replacement = original.slice(0, start) + JSON.stringify(binary) + original.slice(end);
  try { if (sameValue(parseConfig(replacement), config)) return replacement; } catch { /* Preserve unrecognized layouts. */ }
  throw new InstallError('config_requires_manual_merge');
}

function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

// Remove `[mcp_servers.<alias>]` (and its subtables) as whole text blocks so
// comments and every other setting stay byte-identical. Returns the original
// text when any alias is not a self-contained block or when anything other
// than the aliases would change.
export function removeCodexAliases(original, aliases) {
  if (!aliases.length) return original;
  const before = parse(original);
  const names = aliases.map(name => `(?:${escapeRegExp(name)}|"${escapeRegExp(name)}"|'${escapeRegExp(name)}')`).join('|');
  const header = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${names})\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`, 'u');
  const anyHeader = /^\s*\[/u;
  const kept = [];
  let skipping = false;
  // Comment/blank lines at the end of a removed block belong to the next table.
  let trailing = [];
  for (const line of original.split(/(?<=\n)/u)) {
    if (anyHeader.test(line)) {
      const removing = header.test(line);
      if (skipping && !removing) kept.push(...trailing);
      trailing = [];
      skipping = removing;
    } else if (skipping) {
      if (/^\s*(?:#.*)?\r?\n?$/u.test(line)) trailing.push(line); else trailing = [];
      continue;
    }
    if (!skipping) kept.push(line);
  }
  const result = kept.join('');
  let after;
  try { after = parse(result); } catch { return original; }
  const expected = structuredClone(before);
  for (const alias of aliases) delete expected.mcp_servers[alias];
  return sameValue(after, expected) ? result : original;
}

// `online` is undefined for the native server, or `{ auth: 'oauth' | 'key' }` for the online gateway.
export function configAddition(original, binary, online) {
  if (Buffer.byteLength(original) > maxTomlConfig) throw new InstallError('config_too_large');
  let config;
  try { config = parse(original); }
  catch { throw new InstallError('invalid_existing_toml'); }
  const existing = config.mcp_servers?.airdesk;
  const keyVariable = online?.auth === 'key' ? onlineKeyVariable : undefined;
  if (existing !== undefined) {
    if (online && existing?.url === onlineEndpoint && existing.bearer_token_env_var === keyVariable &&
        existing.enabled !== false && !existing.command && !existing.http_headers && !existing.env_http_headers) return '';
    if (!online && existing?.command === binary && JSON.stringify(existing.args) === '["--mcp-server"]' &&
        existing.enabled !== false && !existing.env && !existing.env_vars?.length && !existing.url) return '';
    throw new InstallError('existing_airdesk_config_conflict');
  }
  // Online calls can wait up to 55 s at the gateway, plus transport time.
  const addition = '\n\n[mcp_servers.airdesk]\n' + (online
    ? `url = ${JSON.stringify(onlineEndpoint)}\n` + (keyVariable ? `bearer_token_env_var = ${JSON.stringify(keyVariable)}\n` : '') +
      'startup_timeout_sec = 20\ntool_timeout_sec = 120\n'
    : `command = ${JSON.stringify(binary)}\nargs = ["--mcp-server"]\n` +
      'startup_timeout_sec = 20\ntool_timeout_sec = 60\n');
  try { parse(original + addition); }
  catch { throw new InstallError('config_requires_manual_merge'); }
  return addition;
}

// `online` is an expected online entry object; without it the native stdio entry is registered.
export function jsonConfiguration(original, binary, format = 'mcpServers', online) {
  const dialect = jsonFormats[format];
  if (!dialect) throw new InstallError('unsupported_config_format');
  const key = dialect.key;
  if (Buffer.byteLength(original) > maxJsonConfig) throw new InstallError('config_too_large');
  let config;
  try { config = original.trim() ? JSON.parse(original) : {}; }
  catch { throw new InstallError('invalid_existing_json'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      (config[key] !== undefined && (!config[key] || typeof config[key] !== 'object' || Array.isArray(config[key]))))
    throw new InstallError('invalid_existing_json');
  const existing = config[key]?.airdesk;
  if (online) {
    if (existing !== undefined) {
      if (sameValue(existing, online)) return original;
      throw new InstallError('existing_airdesk_config_conflict');
    }
    config[key] = { ...config[key], airdesk: online };
    return JSON.stringify(config, null, 2) + '\n';
  }
  const aliases = nativeAliases(config[key]);
  if (existing !== undefined) {
    if (!isExpectedEntry(existing, binary, format)) throw new InstallError('existing_airdesk_config_conflict');
    if (!aliases.length) return original;
  }
  // Native AirDesk servers registered under another name move to `airdesk`.
  const servers = { ...config[key] };
  for (const alias of aliases) delete servers[alias];
  config[key] = { ...servers, airdesk: existing ?? dialect.entry(binary) };
  return JSON.stringify(config, null, 2) + '\n';
}

async function readConfig(filename, limit = maxJsonConfig) {
  const info = await statOrNull(filename);
  if (!info) return '';
  if (!info.isFile() || info.isSymbolicLink()) throw new InstallError('config_not_regular_file');
  if (info.size > limit) throw new InstallError('config_too_large');
  return fs.readFile(filename, 'utf8');
}

async function publishConfigReplacement(filename, original, replacement, hooks) {
  const temporary = `${filename}.airdesk-install-${randomUUID()}`;
  const backup = await statOrNull(filename) ? `${filename}.airdesk-backup-${randomUUID()}` : null;
  await fs.writeFile(temporary, replacement, { flag: 'wx', mode: 0o600 });
  let moved = false;
  try {
    if ((await readConfig(filename)) !== original) throw new InstallError('config_changed_concurrently_review_required');
    if (backup) {
      await fs.rename(filename, backup); moved = true;
      if ((await fs.readFile(backup, 'utf8')) !== original) throw new InstallError('config_changed_concurrently_review_required');
    }
    await hooks.beforeConfigPublish?.({ filename, backup });
    // Publish a complete file exclusively; preserve a config recreated by the client.
    await fs.link(temporary, filename);
  } catch (error) {
    if (moved) await fs.link(backup, filename).catch(() => {});
    // If the client recreated the config, report the retained original.
    if (moved) { error.configBackup = backup; error.configMutated = true; }
    throw error;
  } finally { await fs.unlink(temporary).catch(() => {}); }
  return backup;
}

// `online` is `{ auth, entry }` for the online gateway, undefined for the native server.
async function registerConfig(filename, binary, format, hooks, online, windowsRoot) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const lock = `${filename}.airdesk-install.lock`;
  await fs.mkdir(lock).catch(() => { throw new InstallError('config_busy'); });
  try {
    const original = await readConfig(filename, format === 'codex' ? maxTomlConfig : maxJsonConfig);
    const retargeted = await retargetWindowsRegistration(original, binary, format, online, windowsRoot);
    if (retargeted !== null) {
      if (retargeted === original) return { status: 'unchanged' };
      const backup = await publishConfigReplacement(filename, original, retargeted, hooks);
      return { status: 'registered', backup };
    }
    if (format !== 'codex') {
      const replacement = jsonConfiguration(original, binary, format, online?.entry);
      if (replacement === original) return { status: 'unchanged' };
      const migratedAliases = online ? []
        : nativeAliases(original.trim() ? JSON.parse(original)[jsonFormats[format].key] : undefined);
      const backup = await publishConfigReplacement(filename, original, replacement, hooks);
      return { status: 'registered', backup, ...(migratedAliases.length ? { migratedAliases } : {}) };
    }
    // Native AirDesk entries under another name are removed as whole blocks and
    // re-registered as `airdesk`; then publish atomically like the JSON path.
    let parsedOriginal;
    try { parsedOriginal = parse(original); } catch { throw new InstallError('invalid_existing_toml'); }
    const aliases = online ? [] : nativeAliases(parsedOriginal.mcp_servers);
    const migrated = removeCodexAliases(original, aliases);
    if (migrated !== original) {
      const replacement = migrated + configAddition(migrated, binary);
      const backup = await publishConfigReplacement(filename, original, replacement, hooks);
      return { status: 'registered', backup, migratedAliases: aliases };
    }
    const addition = configAddition(original, binary, online);
    if (!addition) return { status: 'unchanged' };
    // Append, never reserialize the user's configuration or remove comments/settings.
    await fs.appendFile(filename, addition, { mode: 0o600 });
    try { parse(await readConfig(filename)); }
    catch {
      const error = new InstallError('config_changed_concurrently_review_required');
      error.configMutated = true;
      throw error;
    }
    return { status: 'registered' };
  } finally { await fs.rmdir(lock); }
}

async function readTree(directory, prefix = '') {
  const result = new Map();
  for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new InstallError('skill_contains_symlink');
    if (entry.isDirectory()) {
      for (const [name, data] of await readTree(directory, relative)) result.set(name, data);
    } else if (entry.isFile()) {
      // Python's bytecode is not distributed skill content. Ignore only real
      // .pyc files below __pycache__; other extra files remain conflicts.
      if (relative.split('/').includes('__pycache__') && entry.name.endsWith('.pyc')) continue;
      const filename = path.join(directory, relative);
      if ((await fs.stat(filename)).size > 512 * 1024) throw new InstallError('existing_skill_conflict');
      result.set(relative, await fs.readFile(filename));
    }
    else throw new InstallError('skill_contains_special_file');
  }
  return result;
}

// `files` is the bundle to install. `alternates` are this package's bundles in the
// other languages: an unchanged one is recognized like an official release, so
// switching language needs --upgrade and retains the previous directory.
async function planSkill(skillsDir, files, upgrade, alternates = []) {
  const destination = path.join(skillsDir, skillName);
  const existing = await statOrNull(destination);
  if (!existing) return { destination, files, status: 'install' };
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new InstallError('existing_skill_conflict');
  const actual = await readTree(destination);
  if (actual.size !== files.size || [...files].some(([name, data]) => !actual.get(name)?.equals(data))) {
    const release = [...releaseManifest.releases, ...alternates].find(candidate => matchesRelease(actual, candidate));
    if (!release) throw new InstallError('existing_skill_conflict');
    if (!upgrade) throw new InstallError('skill_upgrade_required');
    return { destination, files, status: 'upgrade', release };
  }
  return { destination, files, status: 'unchanged' };
}

function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function createUpgradeWorkspace(destination) {
  const skillsDir = await fs.realpath(path.dirname(destination));
  // Keep every SKILL.md in staging/backups outside discovery roots, including
  // custom roots and a custom root nested inside a standard client root.
  const roots = await Promise.all([skillsDir, ...knownSkillRoots()]
    .map(directory => fs.realpath(directory).catch(() => path.resolve(directory))));
  let parent = path.dirname(skillsDir);
  while (roots.some(root => isWithin(root, parent))) {
    const next = path.dirname(parent);
    if (next === parent) throw new InstallError('skill_upgrade_storage_unavailable');
    parent = next;
  }
  const workspace = await fs.mkdtemp(path.join(parent, '.airdesk-skill-upgrade-'));
  try {
    if ((await fs.stat(workspace)).dev !== (await fs.stat(destination)).dev)
      throw new InstallError('skill_upgrade_storage_volume_mismatch');
    return workspace;
  } catch (error) {
    await fs.rmdir(workspace).catch(() => {});
    throw error;
  }
}

async function upgradeSkill(plan, hooks) {
  const lock = `${plan.destination}.airdesk-upgrade.lock`;
  await fs.mkdir(lock).catch(() => { throw new InstallError('skill_busy'); });
  let workspace, stage, backup;
  let moved = false;
  try {
    workspace = await createUpgradeWorkspace(plan.destination);
    backup = path.join(workspace, `${skillName}.backup-${plan.release.version}`);
    stage = path.join(workspace, 'staging');
    await fs.mkdir(stage, { mode: 0o700 });
    // Fill a private staging directory before any visible skill is moved.
    for (const [name, data] of plan.files) {
      const filename = path.join(stage, name);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, data, { flag: 'wx' });
    }
    await hooks.onSkillStaged?.({ destination: plan.destination, stage, backup });
    if (!matchesRelease(await readTree(plan.destination), plan.release)) throw new InstallError('skill_changed_concurrently');
    await fs.rename(plan.destination, backup); moved = true;
    if (!matchesRelease(await readTree(backup), plan.release)) throw new InstallError('skill_changed_concurrently');
    if (await statOrNull(plan.destination)) throw new InstallError('skill_changed_concurrently');
    await fs.rename(stage, plan.destination); // Publish the complete new tree.
    return backup;
  } catch (error) {
    if (moved && !(await statOrNull(plan.destination))) await fs.rename(backup, plan.destination).catch(() => {});
    if (moved && await statOrNull(backup)) error.recoveryBackup = backup;
    throw error;
  } finally {
    if (stage) await fs.rm(stage, { recursive: true, force: true });
    if (workspace) await fs.rmdir(workspace).catch(() => {}); // A retained backup keeps its private workspace.
    await fs.rmdir(lock);
  }
}

async function copySkill(plan, hooks) {
  if (plan.status === 'unchanged') return;
  if (plan.status === 'upgrade') return upgradeSkill(plan, hooks);
  await fs.mkdir(path.dirname(plan.destination), { recursive: true });
  const lock = `${plan.destination}.airdesk-upgrade.lock`;
  await fs.mkdir(lock).catch(() => { throw new InstallError('skill_busy'); });
  const copied = [];
  const directories = new Set();
  try {
    await fs.mkdir(plan.destination); // Exclusive reservation: never overwrite an existing skill.
    directories.add(plan.destination);
    // Publish the entrypoint last so a client does not discover a half-copied skill.
    for (const [name, data] of [...plan.files].sort(([a], [b]) => Number(a === 'SKILL.md') - Number(b === 'SKILL.md'))) {
      const filename = path.join(plan.destination, name);
      const directory = path.dirname(filename);
      await fs.mkdir(directory, { recursive: true });
      directories.add(directory);
      await fs.writeFile(filename, data, { flag: 'wx' });
      copied.push(filename);
    }
  } catch (error) {
    for (const filename of copied.reverse()) await fs.unlink(filename).catch(() => {});
    // Remove only empty directories we created, never recursively delete user data.
    for (const directory of [...directories].sort((a, b) => b.length - a.length)) await fs.rmdir(directory).catch(() => {});
    throw error;
  } finally { await fs.rmdir(lock); }
}

// `--client` accepts one id, a comma-separated list, or `detected` (every
// supported client whose own directory exists on this computer).
export async function selectClients(value = 'codex', context = clientContext()) {
  if (typeof value !== 'string' || !value.trim()) throw new InstallError('unsupported_client');
  if (value === 'detected' || value === 'all') {
    const found = [];
    for (const id of clientIds) {
      const marker = resolveClient(id, context).marker;
      if (marker && (await statOrNull(marker))?.isDirectory()) found.push(id);
    }
    if (!found.length) throw new InstallError('no_supported_clients_detected');
    return found;
  }
  const ids = [...new Set(value.split(',').map(id => id.trim()))];
  if (ids.some(id => !clientIds.includes(id))) throw new InstallError('unsupported_client');
  return ids;
}

async function validateConfig(original, binary, format, online, windowsRoot) {
  if (await retargetWindowsRegistration(original, binary, format, online, windowsRoot) !== null) return;
  return format === 'codex' ? configAddition(original, binary, online) : jsonConfiguration(original, binary, format, online?.entry);
}

// How each client finishes online sign-in after the endpoint is registered.
const onlineSignIn = {
  'claude-code': 'Run /mcp in Claude Code and choose airdesk to sign in.',
  'codex': 'Run: codex mcp login airdesk',
  'cursor': 'Open Cursor Settings > MCP and select airdesk to sign in.',
  'vscode': 'Start the airdesk server in VS Code; it opens the AirDesk sign-in page.',
  'gemini-cli': 'Run /mcp auth airdesk in Gemini CLI.',
  'opencode': 'Run: opencode mcp auth airdesk',
  'generic': 'Sign in through your client\'s MCP OAuth flow.',
};

export async function install(options = {}, dependencies = {}) {
  const context = dependencies.context || clientContext();
  const lang = normalizeLanguage(options.lang ?? 'en');
  const mode = options.mode ?? 'local';
  if (!['local', 'online'].includes(mode)) throw new InstallError('unsupported_mode');
  const auth = options.auth ?? 'oauth';
  if (!['oauth', 'key'].includes(auth)) throw new InstallError('unsupported_auth');
  if (options.auth && mode !== 'online') throw new InstallError('auth_requires_online_mode');
  if (mode === 'online' && options.binary) throw new InstallError('binary_requires_local_mode');
  const online = mode === 'online' && !options.skipMcp;
  const ids = await selectClients(options.client || 'codex', context);
  if (ids.length > 1 && (options.config || options.skillsDir)) throw new InstallError('option_requires_single_client');
  const single = ids.length === 1;
  const targets = ids.map(id => {
    const client = resolveClient(id, context);
    const configPath = options.config ? path.resolve(options.config) : client.config;
    if (!options.skipMcp && !configPath) throw new InstallError('config_path_required');
    let remote;
    try { remote = online ? { auth, entry: onlineEntry(client, auth) } : undefined; }
    catch (error) { if (!single) error.client = id; throw error; }
    return { client, configPath, online: remote, skillsDir: path.resolve(options.skillsDir || client.skills) };
  });
  const files = await bundledSkill(lang);
  const alternates = [];
  for (const other of languages.filter(code => code !== lang)) {
    const bundle = await bundledSkill(other);
    alternates.push({ version: `${packageVersion}-${other}`, files: Object.fromEntries([...bundle].map(([name, data]) => [name, sha256(data)])) });
  }
  // Plan every distinct skill root and validate every configuration before any write.
  const plans = new Map();
  for (const target of targets) {
    if (!plans.has(target.skillsDir)) plans.set(target.skillsDir, await planSkill(target.skillsDir, files, options.upgrade === true, alternates));
    target.plan = plans.get(target.skillsDir);
  }
  const common = { targetVerified: false, bundledVersion: packageVersion, lang, mode };
  const setup = dependencies.nativeSetup || nativeSetup;
  const binary = options.skipMcp || online ? null : await findBinary(options.binary);
  const windowsRoot = standardWindowsAppRoot(context);
  const configures = !!binary || online;
  if (configures) for (const target of targets) {
    try {
      await validateConfig(await readConfig(target.configPath, target.client.format === 'codex' ? maxTomlConfig : maxJsonConfig),
        binary, target.client.format, target.online, windowsRoot);
    } catch (error) {
      if (!single) { error.client = target.client.id; error.configPath = target.configPath; }
      throw error;
    }
  }
  const describe = target => ({ client: target.client.id, clientName: target.client.name, destination: target.plan.destination,
    configPath: configures ? target.configPath : undefined, skillDiscovery: target.client.skillDiscovery,
    ...(online ? { endpoint: onlineEndpoint, auth, signIn: auth === 'key' ? `Set ${onlineKeyVariable} in the environment that starts this client.`
      : onlineSignIn[target.client.id] ?? onlineSignIn.generic } : {}),
    ...(target.client.quitBeforeSetup ? { quitClientBeforeReload: true } : {}) });
  if (options.dryRun) {
    const planned = targets.map(target => ({ ...describe(target), skill: target.plan.status,
      installedVersion: target.plan.release?.version, mcp: configures ? 'planned' : 'skipped' }));
    return single ? { ...planned[0], ...common, dryRun: true } : { ...common, clients: planned, dryRun: true };
  }
  if (binary) {
    const preflight = setup(binary, false); // Before any installation writes.
    requireConsentStatus(preflight);
    // Older managed builds cannot start MCP with incoming shell hosting OFF.
    // Fail before writing, without enabling that unrelated permission.
    if (!preflight.remoteTerminalEnabled && preflight.localRemoteTerminalRequired !== false)
      throw new InstallError('native_app_update_required');
  }
  let skillWritten = false, configWritten = false, skillBackup, configBackup;
  const completed = [];
  try {
    const skillResults = new Map();
    for (const [skillsDir, plan] of plans) {
      const backup = await copySkill(plan, dependencies);
      skillWritten ||= plan.status !== 'unchanged';
      skillBackup ||= backup;
      skillResults.set(skillsDir, { status: plan.status === 'upgrade' ? 'upgraded' : plan.status === 'install' ? 'installed' : 'unchanged', backup });
    }
    const results = [];
    for (const target of targets) {
      let config = {};
      if (configures) {
        config = await registerConfig(target.configPath, binary, target.client.format, dependencies, target.online, windowsRoot);
        configWritten ||= config.status === 'registered'; configBackup ||= config.backup;
      }
      const skill = skillResults.get(target.skillsDir);
      results.push({ ...describe(target), skill: skill.status, previousVersion: target.plan.release?.version, backup: skill.backup,
        configBackup: config.backup, ...(config.migratedAliases?.length ? { mcpRenamedToAirdesk: config.migratedAliases } : {}),
        mcp: configures ? (config.status === 'registered' ? 'registered' : 'unchanged') : 'skipped' });
      completed.push(target.client.id);
    }
    let mcp = 'skipped';
    if (online) {
      // Nothing runs on this computer: the bridge PC executes online calls.
      mcp = results.some(result => result.mcp === 'registered') ? 'online-registered' : 'online-unchanged';
    } else if (binary) {
      setup(binary, true); // Explicit install only; never a recurring startup flag.
      mcp = 'enabled-and-registered';
      for (const result of results) result.mcp = mcp;
    }
    return single ? { ...results[0], ...common, installedVersion: packageVersion, mcp, dryRun: false }
      : { ...common, installedVersion: packageVersion, clients: results, mcp, dryRun: false };
  } catch (error) {
    configWritten ||= error.configMutated === true;
    configBackup ||= error.configBackup;
    error.partialInstall = skillWritten || configWritten;
    error.installation = { skillWritten, configWritten, skillBackup: skillBackup || error.recoveryBackup, configBackup,
      ...(single ? {} : { completedClients: completed }) };
    throw error;
  }
}

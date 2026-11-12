#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { clientIds, install, InstallError, resolveClient, selectClients } from '../lib/installer.mjs';
import { bundledSkill, detectLanguage, languageNames, languages, normalizeLanguage, onlineEndpoint, onlineKeyVariable,
  pluginFiles, pluginName, skillName, zip } from '../lib/bundle.mjs';

const help = `AirDesk Remote Computer Use

Usage: node bin/cli.mjs install [options]
       node bin/cli.mjs pack [--lang ko|ja|en] [--format skill|plugin] [--out FILE]
       node bin/cli.mjs clients

Run these examples from the official GitHub checkout. The current one-line
installer is at https://airdesk.co.kr/en/service#mcp.

install copies the skill in the chosen language and registers AirDesk MCP in the
selected coding agent(s).

  --lang LANG        Skill language: en, ko or ja. Asked in a terminal; otherwise
                     taken from the system locale (English when unknown).
  --mode MODE        local (default): native AirDesk on this computer, and the
                     installer enables only this controller's MCP mode.
                     Accept the current AI remote-access terms in AirDesk first.
                     online: ${onlineEndpoint}; calls run on your
                     bridge PC (AirDesk signed in with online MCP ON). No AirDesk
                     is needed on this computer.
  --auth AUTH        Online sign-in: oauth (default; the client opens AirDesk
                     sign-in) or key (the client reads ${onlineKeyVariable} from its
                     environment; the key is never written to a file)
  --binary PATH      Trusted installed AirDesk executable (.app accepted on macOS; local mode)
  --client NAME      Coding agent(s) to configure (default: codex). One id, a
                     comma-separated list, or "detected" for every supported
                     agent already present on this computer. Ids:
                     ${clientIds.join(', ')}
                     Run "clients" to see each one's config and skill paths.
  --skills-dir PATH  Skill parent directory override (single client only)
  --config PATH      MCP configuration file override (single client only;
                     required for generic)
  --upgrade          Upgrade an unchanged recognized official skill, or switch its
                     language, retaining a backup
  --skip-mcp         Copy only the skill; do not configure MCP
  --dry-run          Inspect the installation plan without writes or launching AirDesk
  --help             Show this help
  --version          Print package version

pack writes a zip for upload: --format skill (default) is the skill folder for
Claude (Settings > Capabilities > Skills) or ChatGPT; --format plugin is a
plugin archive with the online MCP server for plugin directories.

AirDesk must be installed on both computers. The installer configures MCP on
this controller. The target must approve access. Remote Terminal is a separate
target setting for shell work.
Screen/window/browser UI automation uses the bundled target agent-desktop engine. No remote task runs here.
First sign in to AirDesk and review/accept its AI remote-access terms in the app.
Custom skill files and conflicting MCP entries are preserved, never replaced.
`;

function parseOptions(args, names, flags) {
  const options = {};
  while (args.length) {
    const arg = args.shift();
    const takesValue = Object.hasOwn(names, arg);
    const key = takesValue ? names[arg] : Object.hasOwn(flags, arg) ? flags[arg] : undefined;
    if (!key || key in options) throw new InstallError('unknown_or_duplicate_option');
    if (takesValue) {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new InstallError('missing_option_value');
      options[key] = value;
    } else options[key] = true;
  }
  return options;
}

// Ask only in an interactive terminal; scripts and CI get the locale default.
async function chooseLanguage() {
  const detected = detectLanguage();
  if (!process.stdin.isTTY || !process.stdout.isTTY) return detected;
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const list = languages.map((code, index) => `${index + 1}) ${languageNames[code]} (${code})`).join('  ');
    for (;;) {
      const answer = (await prompt.question(`Skill language / 스킬 언어 / スキルの言語: ${list} [${detected}]: `)).trim().toLowerCase();
      if (!answer) return detected;
      const byNumber = languages[Number(answer) - 1];
      if (byNumber) return byNumber;
      if (languages.includes(answer)) return answer;
    }
  } finally { prompt.close(); }
}

try {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    process.stdout.write(help);
  } else if (args.length === 1 && args[0] === 'clients') {
    const detected = new Set(await selectClients('detected').catch(() => []));
    console.log(JSON.stringify(clientIds.map(id => {
      const client = resolveClient(id);
      return { client: id, name: client.name, detected: detected.has(id), mcpConfig: client.config, format: client.format,
        online: !!client.online, skillsDir: client.skills, skillDiscovery: client.skillDiscovery };
    }), null, 2));
  } else if (args.length === 1 && args[0] === '--version') {
    console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
  } else if (args[0] === 'pack') {
    args.shift();
    const options = parseOptions(args, { '--lang': 'lang', '--format': 'format', '--out': 'out' }, {});
    const lang = normalizeLanguage(options.lang) ?? await chooseLanguage();
    const format = options.format ?? 'skill';
    if (!['skill', 'plugin'].includes(format)) throw new InstallError('unsupported_pack_format');
    const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
    const entries = format === 'skill'
      ? [...await bundledSkill(lang)].map(([name, data]) => [`${skillName}/${name}`, data])
      : [...await pluginFiles(lang, version)].map(([name, data]) => [`${pluginName(lang)}/${name}`, data]);
    const out = path.resolve(options.out ?? `airdesk-${format === 'skill' ? skillName : pluginName(lang)}-${lang}-${version}.zip`);
    await writeFile(out, zip(entries), { flag: 'wx' }).catch(error => {
      throw new InstallError(error.code === 'EEXIST' ? 'output_exists' : 'installation_io_failed');
    });
    console.log(JSON.stringify({ format, lang, version, out, files: entries.length }, null, 2));
  } else {
    if (args.shift() !== 'install') throw new InstallError('expected_install_command');
    const options = parseOptions(args,
      { '--binary': 'binary', '--skills-dir': 'skillsDir', '--config': 'config', '--client': 'client',
        '--lang': 'lang', '--mode': 'mode', '--auth': 'auth' },
      { '--skip-mcp': 'skipMcp', '--dry-run': 'dryRun', '--upgrade': 'upgrade' });
    options.lang = normalizeLanguage(options.lang) ?? await chooseLanguage();
    const result = await install(options);
    console.log(JSON.stringify(result, null, 2));
    const online = result.mode === 'online';
    console.log(result.dryRun ? 'Controller installation plan generated; no settings were changed.'
      : result.mcp === 'skipped' ? 'Skill installation completed; MCP setup was skipped.'
      : online ? 'Online MCP registered. Reload the selected client(s) and sign in as shown in "signIn".'
      : 'Controller MCP setup completed. Reload the selected MCP client(s).');
    if ((result.clients || [result]).some(client => client.quitClientBeforeReload))
      console.log('Claude Desktop rewrites its configuration while running: quit it fully, then start it again.');
    if (online) {
      if (result.auth === 'key')
        console.log(`Create a key in AirDesk My Page > API keys and set ${onlineKeyVariable} in your shell profile or the client's environment. Never paste it into chat or commit it.`);
      console.log('Online calls run on your bridge PC: AirDesk must be running there, signed in, with AI remote computer use (MCP) and online MCP ON.');
    }
    console.log('Confirm target installation, hosting and approved access before connecting. Check the target’s Remote Terminal setting and terms for shell work.');
    if ((result.clients || [result]).some(client => ['manual-import', 'client-specific'].includes(client.skillDiscovery)))
      console.log('The portable skill was copied, but automatic skill discovery by this client is not verified. Load it through the client-supported skill workflow.');
  }
} catch (error) {
  // Parser/native errors may contain credentials or private configuration. Never print raw errors.
  const code = error instanceof InstallError ? error.message : 'installation_io_failed';
  console.error(JSON.stringify({ error: code, ...(error.client ? { client: error.client, configPath: error.configPath } : {}),
    partialInstall: error.partialInstall === true,
    ...(error.installation ? { installation: error.installation } : {}) }));
  if (code === 'ai_remote_access_terms_required')
    console.error('Open AirDesk, sign in, and review/accept the AI remote-access terms when enabling MCP. Then rerun this installer. Terms are never accepted automatically.');
  if (code === 'remote_terminal_required')
    console.error('Update AirDesk to a build that supports MCP with local incoming Remote Terminal hosting off.');
  if (code === 'no_supported_clients_detected')
    console.error('No supported coding agent was found. Run "clients" to see the supported ids, then pass --client explicitly.');
  if (code === 'invalid_existing_json')
    console.error('A client configuration is not plain JSON (for example it contains comments). Add the airdesk entry by hand; see the setup guide.');
  if (code === 'skill_upgrade_required')
    console.error('An unchanged official previous skill (or another language of this one) was found. Rerun with --upgrade to retain a backup and install this version.');
  if (code === 'online_client_unsupported')
    console.error(`This client adds remote MCP servers only through its own settings. Add ${onlineEndpoint} there (Claude Desktop and claude.ai: Settings > Connectors > Add custom connector).`);
  if (code === 'online_key_auth_unsupported')
    console.error('This client has no documented environment-variable syntax for MCP headers. Use --auth oauth.');
  if (code === 'existing_airdesk_config_conflict')
    console.error('An airdesk entry already exists with different settings (for example the local server when installing online). Remove or rename it first, then rerun.');
  if (code === 'unsupported_language')
    console.error(`Supported languages: ${languages.join(', ')}.`);
  console.error('Custom skill files and conflicting MCP entries are preserved. If partialInstall is true, inspect the reported controller state and backups before retrying. See the setup guide.');
  process.exitCode = 1;
}

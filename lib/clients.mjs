import os from 'node:os';
import path from 'node:path';

// Supported coding-agent clients: where each reads user-scope MCP servers and
// personal Agent Skills (SKILL.md folders). Paths follow each client's
// documented user-scope defaults.
//
// format:
//   codex      TOML  [mcp_servers.airdesk]
//   mcpServers JSON  { mcpServers: { airdesk: { command, args } } }
//   vscode     JSON  { servers: { airdesk: { type: 'stdio', command, args } } }
//   copilot    JSON  { mcpServers: { airdesk: { type: 'stdio', command, args, tools: ['*'] } } }
//   opencode   JSON  { mcp: { airdesk: { type: 'local', command: [cmd, ...args], enabled: true } } }
// skillDiscovery:
//   filesystem      the client discovers skills from `skills`
//   manual-import   the client imports skills through its UI
//   client-specific unknown; the portable copy is not proven discoverable
// online: the dialect of its remote (Streamable HTTP) entry for --mode online;
//   clients without one configure remote servers only through their UI.

export function clientContext({ home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  return { home, platform, env };
}

const xdg = ({ home, env }) => env.XDG_CONFIG_HOME || path.join(home, '.config');
const appData = ({ home, env }) => env.APPDATA || path.join(home, 'AppData', 'Roaming');

// Per-OS application data directory used by Electron apps (VS Code, Trae, Claude Desktop).
function appSupport(context, name) {
  if (context.platform === 'win32') return path.join(appData(context), name);
  if (context.platform === 'darwin') return path.join(context.home, 'Library', 'Application Support', name);
  return path.join(xdg(context), name);
}

const vscodeUser = context => path.join(appSupport(context, 'Code'), 'User');
const codexHome = ({ home, env }) => env.CODEX_HOME || path.join(home, '.codex');
const claudeHome = ({ home, env }) => env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
const geminiHome = ({ home, env }) => path.join(env.GEMINI_CLI_HOME || home, '.gemini');
const copilotHome = ({ home, env }) => env.COPILOT_HOME || path.join(home, '.copilot');
const opencodeHome = context => context.env.OPENCODE_CONFIG_DIR || path.join(xdg(context), 'opencode');
const agentsSkills = ({ home }) => path.join(home, '.agents', 'skills');
const under = (...parts) => ({ home }) => path.join(home, ...parts);

export const clientDefinitions = {
  'codex': {
    online: 'codex', name: 'Codex', format: 'codex',
    config: context => path.join(codexHome(context), 'config.toml'),
    skills: agentsSkills, marker: codexHome,
  },
  'claude-code': {
    online: 'claude', name: 'Claude Code', format: 'mcpServers',
    config: ({ home, env }) => path.join(env.CLAUDE_CONFIG_DIR || home, '.claude.json'),
    skills: context => path.join(claudeHome(context), 'skills'), marker: claudeHome,
  },
  'claude-desktop': {
    name: 'Claude Desktop', format: 'mcpServers', skillDiscovery: 'manual-import', quitBeforeSetup: true,
    config: context => path.join(appSupport(context, 'Claude'), 'claude_desktop_config.json'),
    skills: agentsSkills, marker: context => appSupport(context, 'Claude'),
  },
  'cursor': {
    online: 'cursor', name: 'Cursor', format: 'mcpServers',
    config: under('.cursor', 'mcp.json'), skills: under('.cursor', 'skills'), marker: under('.cursor'),
  },
  'windsurf': {
    name: 'Windsurf', format: 'mcpServers',
    config: under('.codeium', 'windsurf', 'mcp_config.json'),
    skills: under('.codeium', 'windsurf', 'skills'), marker: under('.codeium', 'windsurf'),
  },
  'gemini-cli': {
    online: 'gemini', name: 'Gemini CLI', format: 'mcpServers',
    config: context => path.join(geminiHome(context), 'settings.json'),
    skills: context => path.join(geminiHome(context), 'skills'), marker: geminiHome,
  },
  'antigravity': {
    name: 'Antigravity', format: 'mcpServers',
    config: under('.gemini', 'config', 'mcp_config.json'),
    skills: under('.gemini', 'config', 'skills'), marker: under('.gemini', 'config'),
  },
  'vscode': {
    online: 'vscode', name: 'VS Code (GitHub Copilot)', format: 'vscode',
    config: context => path.join(vscodeUser(context), 'mcp.json'),
    skills: context => path.join(copilotHome(context), 'skills'), marker: vscodeUser,
  },
  'copilot-cli': {
    name: 'GitHub Copilot CLI', format: 'copilot',
    config: context => path.join(copilotHome(context), 'mcp-config.json'),
    skills: context => path.join(copilotHome(context), 'skills'), marker: copilotHome,
  },
  'cline': {
    name: 'Cline', format: 'mcpServers',
    config: context => path.join(vscodeUser(context), 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
    skills: agentsSkills, marker: context => path.join(vscodeUser(context), 'globalStorage', 'saoudrizwan.claude-dev'),
  },
  'roo-code': {
    name: 'Roo Code', format: 'mcpServers',
    config: context => path.join(vscodeUser(context), 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'),
    skills: under('.roo', 'skills'), marker: context => path.join(vscodeUser(context), 'globalStorage', 'rooveterinaryinc.roo-cline'),
  },
  'opencode': {
    online: 'opencode', name: 'OpenCode', format: 'opencode',
    config: context => context.env.OPENCODE_CONFIG || path.join(opencodeHome(context), 'opencode.json'),
    skills: context => path.join(opencodeHome(context), 'skills'), marker: opencodeHome,
  },
  'kiro': {
    name: 'Kiro', format: 'mcpServers',
    config: under('.kiro', 'settings', 'mcp.json'), skills: under('.kiro', 'skills'), marker: under('.kiro'),
  },
  'qwen-code': {
    name: 'Qwen Code', format: 'mcpServers',
    config: ({ home, env }) => path.join(env.QWEN_HOME || path.join(home, '.qwen'), 'settings.json'),
    skills: ({ home, env }) => path.join(env.QWEN_HOME || path.join(home, '.qwen'), 'skills'),
    marker: ({ home, env }) => env.QWEN_HOME || path.join(home, '.qwen'),
  },
  'droid': {
    name: 'Factory Droid', format: 'mcpServers',
    config: under('.factory', 'mcp.json'), skills: under('.factory', 'skills'), marker: under('.factory'),
  },
  'trae': {
    name: 'Trae', format: 'mcpServers',
    config: context => path.join(appSupport(context, 'Trae'), 'User', 'mcp.json'),
    skills: under('.trae', 'skills'), marker: context => path.join(appSupport(context, 'Trae'), 'User'),
  },
  'codebuddy': {
    name: 'CodeBuddy', format: 'mcpServers',
    config: under('.codebuddy', 'mcp.json'), skills: under('.codebuddy', 'skills'), marker: under('.codebuddy'),
  },
  'qoder': {
    name: 'Qoder', format: 'mcpServers',
    config: under('.qoder', 'settings.json'), skills: under('.qoder', 'skills'), marker: under('.qoder'),
  },
  'devin': {
    name: 'Devin for Terminal', format: 'mcpServers',
    config: context => path.join(context.platform === 'win32' ? path.join(appData(context), 'devin') : path.join(xdg(context), 'devin'), 'mcp_config.json'),
    skills: context => path.join(context.platform === 'win32' ? path.join(appData(context), 'devin') : path.join(xdg(context), 'devin'), 'skills'),
    marker: context => context.platform === 'win32' ? path.join(appData(context), 'devin') : path.join(xdg(context), 'devin'),
  },
  // Any other local stdio client that reads `mcpServers` JSON: --config is required.
  'generic': { online: 'generic', name: 'Generic MCP client', format: 'mcpServers', skillDiscovery: 'client-specific', skills: agentsSkills },
};

export const clientIds = Object.keys(clientDefinitions);

export function resolveClient(id, context = clientContext()) {
  const definition = clientDefinitions[id];
  if (!definition) return null;
  return {
    id, name: definition.name, format: definition.format, online: definition.online ?? null,
    skillDiscovery: definition.skillDiscovery || 'filesystem',
    quitBeforeSetup: definition.quitBeforeSetup === true,
    config: definition.config ? path.resolve(definition.config(context)) : null,
    skills: path.resolve(definition.skills(context)),
    marker: definition.marker ? path.resolve(definition.marker(context)) : null,
  };
}

export function defaultSkillsDir(client = 'codex', home = os.homedir()) {
  return resolveClient(client, clientContext({ home }))?.skills ?? path.join(home, '.agents', 'skills');
}

// Every known skill discovery root, so staging and backups stay outside all of them.
export function knownSkillRoots(context = clientContext()) {
  return [...new Set(clientIds.map(id => resolveClient(id, context).skills))];
}

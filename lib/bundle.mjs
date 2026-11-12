import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The English skill under skills/ is canonical. A language overlay under
// locales/<lang>/ replaces individual files by the same relative path; every
// file it does not translate is the English original.
export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const skillName = 'remote-computer-use';
export const languages = ['en', 'ko', 'ja'];
export const languageNames = { en: 'English', ko: '한국어', ja: '日本語' };
export const skillFiles = [
  'SKILL.md', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'licenses/agent-desktop-LICENSE.txt',
  'agents/openai.yaml', 'assets/NOTICE.md',
  'assets/airdesk-symbol.svg', 'assets/airdesk-lockup.svg',
  'references/setup.md', 'references/screen-control.md', 'references/terminal.md',
  'references/windows-automation.md', 'references/browser-control.md', 'references/agent-desktop.md',
  'references/platform-windows.md', 'references/platform-macos.md', 'references/online.md',
  'scripts/airdesk_mcp.py',
];
// Only prose is translated. Licenses, notices, scripts and images stay byte-identical.
export const translatableFiles = skillFiles.filter(name => name.endsWith('.md') && !/^(LICENSE|THIRD_PARTY|licenses\/|assets\/)/u.test(name) || name === 'agents/openai.yaml');

export const onlineEndpoint = 'https://mcp.airdesk.co.kr/mcp';
export const onlineKeyVariable = 'AIRDESK_MCP_KEY';

export class BundleError extends Error {
  constructor(code) { super(code); this.name = 'InstallError'; }
}

export function normalizeLanguage(value) {
  if (value === undefined) return undefined;
  const code = String(value).trim().toLowerCase();
  if (!languages.includes(code)) throw new BundleError('unsupported_language');
  return code;
}

// ko_KR.UTF-8, ja-JP, en_US ... Anything else falls back to English.
export function detectLanguage(env = process.env, locale = Intl.DateTimeFormat().resolvedOptions().locale) {
  for (const value of [env.AIRDESK_SKILL_LANG, env.LC_ALL, env.LC_MESSAGES, env.LANG, locale]) {
    const code = typeof value === 'string' ? value.trim().toLowerCase().slice(0, 2) : '';
    if (languages.includes(code)) return code;
    if (value && !/^(c|posix)(\.|$)/iu.test(value)) break; // An explicit non-matching locale means English.
  }
  return 'en';
}

async function regularFile(filename) {
  const info = await fs.lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new BundleError('invalid_bundled_skill');
  return info ? fs.readFile(filename) : null;
}

/** The complete skill for one language, as relative path -> bytes, in skillFiles order. */
export async function bundledSkill(lang = 'en', root = packageRoot) {
  const code = normalizeLanguage(lang);
  const files = new Map();
  for (const name of skillFiles) {
    const localized = code === 'en' || !translatableFiles.includes(name) ? null
      : await regularFile(path.join(root, 'locales', code, name));
    const data = localized ?? await regularFile(path.join(root, 'skills', skillName, name));
    if (!data) throw new BundleError('invalid_bundled_skill');
    files.set(name, data);
  }
  return files;
}

export const pluginName = lang => lang === 'en' ? skillName : `${skillName}-${lang}`;
const pluginDescriptions = {
  en: 'AirDesk remote computer use (RCU): operate an authorized remote Windows/macOS computer through AirDesk online MCP, with the target OS agent-desktop guide applied on every connection.',
  ko: 'AirDesk 원격 컴퓨터 사용(RCU): AirDesk 온라인 MCP로 허가된 원격 Windows/macOS 컴퓨터를 조작하고, 연결마다 대상 OS의 agent-desktop 가이드를 적용합니다.',
  ja: 'AirDesk リモートコンピューター操作(RCU): AirDesk オンライン MCP で許可されたリモート Windows/macOS コンピューターを操作し、接続ごとに対象 OS の agent-desktop ガイドを適用します。',
};

/** A Claude Code / Agent Plugins compatible plugin: manifest, online MCP server and the localized skill. */
export async function pluginFiles(lang, version, root = packageRoot) {
  const code = normalizeLanguage(lang);
  const manifest = {
    name: pluginName(code),
    displayName: { en: 'AirDesk Remote Computer Use', ko: 'AirDesk 원격 컴퓨터 사용', ja: 'AirDesk リモートコンピューター操作' }[code],
    version,
    description: pluginDescriptions[code],
    author: { name: 'AirDesk-Inc', url: 'https://airdesk.co.kr' },
    homepage: 'https://github.com/AirDesk-Inc/remote-computer-use#readme',
    repository: 'https://github.com/AirDesk-Inc/remote-computer-use',
    license: 'MIT',
    keywords: ['airdesk', 'mcp', 'remote-desktop', 'computer-use', 'rcu'],
    mcpServers: { airdesk: { type: 'http', url: onlineEndpoint } },
  };
  const files = new Map([['.claude-plugin/plugin.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]]);
  for (const [name, data] of await bundledSkill(code, root)) files.set(`skills/${skillName}/${name}`, data);
  return files;
}

export function marketplace(version) {
  return {
    name: 'airdesk',
    owner: { name: 'AirDesk-Inc', url: 'https://airdesk.co.kr' },
    description: 'AirDesk remote computer use skills with the AirDesk online MCP server, in English, Korean and Japanese.',
    version,
    plugins: languages.map(code => ({
      name: pluginName(code), source: `./plugins/${pluginName(code)}`, description: pluginDescriptions[code],
      version, category: 'productivity', tags: ['airdesk', 'mcp', 'remote-desktop', code],
    })),
  };
}

// Minimal ZIP writer (stored entries, no compression) so `pack` needs no dependency.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [path, Buffer][]; timestamps are fixed so the archive is reproducible. */
export function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | 1 << 5 | 1;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(0o100644 << 16 >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

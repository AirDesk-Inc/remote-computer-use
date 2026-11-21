# Setup

## 1. Prepare the Controller and Target

| Requirement | Controller | Target |
| --- | --- | --- |
| Compatible AirDesk desktop app | Installed | Installed, running and sharing |
| AI remote computer use (MCP) | ON after the signed-in user accepts current AI terms | Incoming host access has its own approval |
| Remote Terminal | Incoming hosting can remain off | Supported, enabled and current host terms accepted for shell work |
| Desktop/browser actions | Current MCP catalog and an interactive remote window | Approved access, input permission and OS accessibility permission where needed |

Get AirDesk from the [official website](https://airdesk.co.kr). In the controller
app, sign in, read and accept the current AI remote-access terms, and enable
**AI remote computer use** (Korean **AI가 원격 컴퓨터 사용**). Older builds call
it **MCP server** or **MCP mode**. Older controller builds may require an update
to use one-shot setup with local incoming terminal hosting off.

The installer configures only the controller. Confirm target sharing and access
approval separately. For shell work, use `targetRemoteTerminal` in
`remote_list_computers` to distinguish unsupported hosting, a disabled setting
and missing consent. Absent and null fields mean unknown. For current session
shell ownership, inspect `remote_status.targetRemoteTerminal.sessionConnected`.
The desktop helper is bundled in the supported target app.

For native MCP/RCU remote-desktop work, the connection policy and the skill
explicitly use `video:true,showWindow:true`. A compatible native app must open a
real interactive remote window on the controller, with local mouse/keyboard
forwarding and the normal toolbar, subject to existing host input permissions;
an observation-only window does not satisfy this policy. Manual and AI input
share that window: pause AI input during user interaction, then re-observe after
handback before resuming. Native MCP/agent ownership (`agentControlMode`), session
IDs and cleanup are retained. Closing the real window ends its owned MCP session
and initiates owned-terminal/held-input cleanup; do not silently reconnect.

The window's automatic clipboard capture and sync remain disabled for MCP ownership.
Explicit clipboard tools, if advertised, are separate actions that work
independently of that sync. Window visibility does not enable audio; microphone,
overlay and recording settings are unchanged. Do not promise automatic clipboard
or audio. Headless (`video:true,showWindow:false`) or no-video (`video:false`,
which also suppresses the window) work requires the user's explicit request.
These are connection options, not installer settings or permission changes.
Discover the native schema first. If `showWindow` is missing or the build only
opens an observation-only window, stop desktop input and request a compatible app
update instead of silently omitting the option or using headless mode.
See [screen connection modes](screen-control.md#session-window).

## 2. Install the Skill

Ask your AI agent:

> Install https://github.com/AirDesk-Inc/remote-computer-use.git.
> Register AirDesk's native MCP server and enable AI remote computer use on this computer.
> Leave local Remote Terminal hosting unchanged.

The installer requires Node.js 22 or later. The [AirDesk website](https://airdesk.co.kr/en/service#mcp)
provides the current one-line installer. To use the commands in this guide,
clone the official GitHub repository and run them from its root.

```sh
git clone https://github.com/AirDesk-Inc/remote-computer-use.git
cd remote-coumputer-use
npm ci --ignore-scripts
node bin/cli.mjs install
```

The default (`--client codex`) installation copies the skill into
`~/.agents/skills/remote-computer-use`, preserves other Codex configuration, and
registers the installed AirDesk executable. The config defaults to
`$CODEX_HOME/config.toml` or `~/.codex/config.toml`. Other coding agents use
their own default skill folder and MCP file (see
[Select another MCP client](#select-another-mcp-client)); `--client detected`
configures every supported agent already present on the computer.

| Option | Effect |
| --- | --- |
| `--lang LANG` | Skill language: `en`, `ko` or `ja`. Asked in an interactive terminal; otherwise taken from the system locale, English when unknown. The installed folder is always `remote-computer-use`; tool names never change. |
| `--mode MODE` | `local` (default): native AirDesk on this computer. `online`: register `https://mcp.airdesk.co.kr/mcp` instead; see [Online MCP and Mobile](#online-mcp-and-mobile). |
| `--auth AUTH` | Online only. `oauth` (default) or `key` (the client reads `AIRDESK_MCP_KEY` from its environment). |
| `--binary PATH` | Absolute trusted AirDesk executable or macOS `.app` path; required on Windows (local mode). |
| `--client NAME` | One client id (default `codex`), a comma-separated list, or `detected`. Run `node bin/cli.mjs clients` for the ids, paths and detection. |
| `--skills-dir PATH` | Alternative parent skill directory (single client only). |
| `--config PATH` | Alternative configuration file: Codex TOML, or the client's JSON file (single client only; required for `generic`). |
| `--upgrade` | Upgrade an unchanged official release recognized by the bundled manifest, or switch an unchanged copy to another language. Retains the old directory as a backup. |
| `--dry-run` | Plan only; no AirDesk execution or writes. |
| `--skip-mcp` | Copy only the skill; do not register MCP or change AirDesk. |

Existing identical installs are kept, ignoring real Python `.pyc` cache files
inside `__pycache__`. The installer recognizes only the official releases listed
in the package's `lib/skill-releases.json` manifest: 0.1.0, its known Git
variant, 0.1.1, 0.1.2, 0.1.3, 0.2.0, 0.3.0, the official 0.4.0 through 0.4.11
checkouts, and this version in another language.
An unchanged install of a recognized release requires explicit
`--upgrade`; its per-file SHA-256 hashes must match exactly before replacement. The new
tree is staged completely, the old directory is retained as a named backup, and
publication uses a directory rename with rollback on failure. Staging and backups
live in a private hidden directory outside the selected skill discovery root
(also outside the standard Codex/Claude Code roots), so clients do not discover
old duplicate skills. The storage must share the skill's filesystem for atomic
renames; otherwise the upgrade stops without moving the old skill. The result
reports the exact retained backup path. Do not delete a
backup until you have checked the result. Custom/extra files, modified official
files, symlinks and conflicting AirDesk MCP entries are not overwritten.
For a skill-only upgrade use `install --upgrade --skip-mcp`.
Reload your MCP client after installation. Clients not listed can use
`--skip-mcp` and the manual configuration below.

On Windows, if a native registration still points to an earlier AirDesk version,
rerun `install` with `--binary` set to the exact new executable in the same
standard per-user AirDesk installation. The installer can update its standard
native entry. Custom commands, custom arguments, environment options and
online endpoints require separate review if they conflict with the selected app.

Automatic enabling requires an updated AirDesk build supporting the read-only
`--mcp-server --mcp-setup` query and one-shot
`--mcp-server --mcp-setup --enable-mcp` operation. The installer checks the native
capability before writing. It never directly edits AirDesk's settings or changes
terminal hosting. The recurring server command remains **only `--mcp-server`**:
MCP OFF is not silently reversed on restart. Older builds without current consent
metadata require an app update. Manual configuration does not establish consent
or make an old app compatible.

If preflight reports `ai_remote_access_terms_required`, it stops before skill or
configuration writes. Sign in and accept the terms in the app, then rerun.
An older native build without current consent metadata returns
`native_app_update_required` before skill/config writes, even if its old MCP
switch is ON. `--skip-mcp` may still copy the portable skill. If consent changes
between preflight and activation, `partialInstall` reports whether skill/config
writes occurred, with retained backup paths when available. Inspect that state
and retry after the stated recovery rather than deleting existing data.

### Select another MCP client

Codex retains append-only TOML registration and preserves unrelated bytes. Every
other supported agent uses a JSON file in that agent's own dialect:

| `--client` | Default MCP file | Entry written | Default skill folder |
| --- | --- | --- | --- |
| `claude-code` | `~/.claude.json` (user scope; `$CLAUDE_CONFIG_DIR` respected) | `mcpServers` | `~/.claude/skills` |
| `claude-desktop` | `claude_desktop_config.json` in the app data folder | `mcpServers` | manual import |
| `cursor` | `~/.cursor/mcp.json` | `mcpServers` | `~/.cursor/skills` |
| `windsurf` | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` | `~/.codeium/windsurf/skills` |
| `gemini-cli` | `~/.gemini/settings.json` | `mcpServers` | `~/.gemini/skills` |
| `antigravity` | `~/.gemini/config/mcp_config.json` | `mcpServers` | `~/.gemini/config/skills` |
| `vscode` | VS Code `User/mcp.json` | `servers` with `type: "stdio"` | `~/.copilot/skills` |
| `copilot-cli` | `~/.copilot/mcp-config.json` | `mcpServers` with `type: "stdio"`, `tools: ["*"]` | `~/.copilot/skills` |
| `cline` | VS Code `globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `mcpServers` | `~/.agents/skills` |
| `roo-code` | VS Code `globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `mcpServers` | `~/.roo/skills` |
| `opencode` | `~/.config/opencode/opencode.json` (`$OPENCODE_CONFIG` respected) | `mcp` with `type: "local"`, command array | `~/.config/opencode/skills` |
| `kiro` | `~/.kiro/settings/mcp.json` | `mcpServers` | `~/.kiro/skills` |
| `qwen-code` | `~/.qwen/settings.json` | `mcpServers` | `~/.qwen/skills` |
| `droid` | `~/.factory/mcp.json` | `mcpServers` | `~/.factory/skills` |
| `trae` | Trae `User/mcp.json` | `mcpServers` | `~/.trae/skills` |
| `codebuddy` | `~/.codebuddy/mcp.json` | `mcpServers` | `~/.codebuddy/skills` |
| `qoder` | `~/.qoder/settings.json` | `mcpServers` | `~/.qoder/skills` |
| `devin` | `~/.config/devin/mcp_config.json` | `mcpServers` | `~/.config/devin/skills` |
| `generic` | `--config PATH` (required) | `mcpServers` | `~/.agents/skills` (not verified) |

```sh
node bin/cli.mjs install --client detected --dry-run
node bin/cli.mjs install --client claude-code,cursor,gemini-cli
node bin/cli.mjs install --client claude-code --config /absolute/path/to/your/project/.mcp.json
```

`--client detected` selects agents whose own folder already exists; it never
creates configuration for an agent that is not installed. Paths are the agents'
documented defaults; confirm your agent reads that file, since this command does
not change client permissions, choose a project, or prove the client has loaded
MCP. Every selected file is parsed and checked before any write, and a conflict in
any one stops the run (the error names the `client` and `configPath`). Agents
that share a skill folder get a single copy. Existing JSON entries are preserved,
formatting is normalized, and an existing file is retained as a backup before an
exclusive complete-file publish. Files containing comments (JSONC) are refused
as `invalid_existing_json`; add the entry by hand. An `airdesk` entry that already
matches, including the `"env": {}` written by `claude mcp add`, is left unchanged.
A conflicting `airdesk` entry fails without replacement. The MCP server is always registered as `airdesk`. A native AirDesk server already registered under another name (command `AirDesk`/`AirDesk.exe` with `--mcp-server`, for example `default-server`) is renamed to `airdesk`, or removed as a duplicate when a correct `airdesk` entry exists; the result lists it in `mcpRenamedToAirdesk` and keeps a `configBackup`. Proxies, URLs and other launchers cannot be identified as AirDesk and are left unchanged. Quit Claude Desktop fully before installing; it rewrites its configuration while running. If the client
recreates the configuration during publication, its new
file is preserved, the old file remains at the reported `configBackup` path, and
`partialInstall:true` / `installation.configWritten:true` disclose the earlier
mutation even though registration failed. Inspect both files before retrying;
do not overwrite the client-created file with the backup automatically. Reload the
client and verify its tool catalog afterward. Claude Code may require approval of
the project's `.mcp.json`; keep that approval in place. Its personal skill copy
defaults to `~/.claude/skills`; Codex uses `~/.agents/skills`. Desktop/generic
selection configures MCP and copies a portable skill but does not install/import
that skill into the application's UI. Use the client's documented skill workflow
where supported, or `--skills-dir` for another filesystem discovery location.
The Python helper's `config --client <id>` prints the same shape for any
supported id without writing.

Invoking the skill depends on the client. Codex uses `$remote-computer-use`;
Claude Code skills are normally invoked as `/remote-computer-use` or selected by
description (confirm in your client's documentation). In any client, `rcu`/`RCU`
is only conversational shorthand and the MCP tool names do not change.

### Manual Installation

Clone the public repository to a location you control:

```sh
git clone https://github.com/AirDesk-Inc/remote-computer-use.git
```

The repository name intentionally matches that URL, including `coumputer`.
The skill name is correctly spelled `remote-computer-use`.

For Codex on macOS/Linux, from the cloned repository:

```sh
mkdir -p ~/.agents/skills
ln -s "$PWD/skills/remote-computer-use" ~/.agents/skills/remote-computer-use
```

If that destination already exists, inspect it first; do not overwrite it. Keep
the clone at that location while using a symlink. On Windows, copy the entire
`skills/remote-computer-use` folder into `%USERPROFILE%\.agents\skills\` (without
replacing an existing skill). Reload the client if it does not discover it.

Other Agent Skills-compatible clients may have different installation paths.
Installing a skill alone does not register or start the native MCP server.

### Skill-only alternative (skills CLI)

The [skills CLI](https://github.com/vercel-labs/skills) can copy just the skill:

```sh
npx skills add AirDesk-Inc/remote-computer-use --skill remote-computer-use
```

`--list` lists the repository's skills without installing. The default scope is
the current project; `-g` installs globally and `-a` selects the agent
client(s). This installs skill files only. It does **not** register the native
MCP server, enable AirDesk MCP mode, accept the AI terms or run the npm installer's
AirDesk setup checks. Complete steps 1 and 3 separately. The npm installer's
`--skip-mcp` also installs only skill files and skips native AirDesk checks.

## 3. Register Native Stdio MCP on the Controller

The command is the **installed AirDesk executable**, with exactly one argument:
`--mcp-server`. No URL, port, API token, or new HTTP listener is needed.

### Codex, macOS

Merge the following into `~/.codex/config.toml`, preserving other configuration:

```toml
[mcp_servers.airdesk]
command = "/Applications/AirDesk.app/Contents/MacOS/AirDesk"
args = ["--mcp-server"]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Alternatively, register the server with the CLI:

```sh
codex mcp add airdesk -- /Applications/AirDesk.app/Contents/MacOS/AirDesk --mcp-server
```

Use one registration method, not both. Keep tool approval controls enabled.

### Windows

Use the actual installed `AirDesk.exe` path. Current installers use
`%LOCALAPPDATA%\AirDesk\app`; a build can use a versioned subdirectory. Do not
assume a fixed version folder.
Find the trusted executable through the installed app's shortcut properties.
Recheck the path after an app update.

With Python 3.10+ installed, print a config using your real path:

```powershell
py -3 skills/remote-computer-use/scripts/airdesk_mcp.py config --client codex --binary "C:\absolute\path\to\AirDesk.exe"
```

The example path is a placeholder, not an installation location. The helper
checks that the file exists. It does not search PATH or select an arbitrary binary.

### Other Local MCP Clients

Print the exact entry for a supported agent with
`python3 scripts/airdesk_mcp.py config --client <id>`. Clients using the common
`mcpServers` JSON format can use:

```json
{
  "mcpServers": {
    "airdesk": {
      "command": "/Applications/AirDesk.app/Contents/MacOS/AirDesk",
      "args": ["--mcp-server"]
    }
  }
}
```

VS Code uses `"servers"` with `"type": "stdio"`; GitHub Copilot CLI adds
`"type": "stdio"` and `"tools": ["*"]`; OpenCode uses
`"mcp": {"airdesk": {"type": "local", "command": ["/path/to/AirDesk", "--mcp-server"], "enabled": true}}`;
Zed uses `"context_servers"`. Confirm your client's format/location in its own documentation. This is not a
claim that every MCP client supports this JSON shape or local stdio. A cloud-only
client cannot directly execute an app installed on your desktop. Do not expose
stdio through an unauthenticated network bridge.

## 4. Read-Only Check

Python is only needed for this optional helper, not for the skill or native MCP.
From the repository root on macOS:

```sh
python3 skills/remote-computer-use/scripts/airdesk_mcp.py doctor
```

Pass `--binary` on Windows or when AirDesk is installed elsewhere. A `.app` path
is also accepted on macOS. `config --client codex` or `config --client generic`
prints configuration without writing files or launching AirDesk.

`doctor` starts its own native stdio process, initializes MCP, lists tools, and
calls **only `remote_status`**. It does not list computers, connect, capture
screens, send input, open terminals, or enable settings. It closes its own child
process on completion/timeout, not the running AirDesk GUI or host service.

- Exit `0`: current consent, local flags and required tool schemas passed. **Not target approval.**
- Exit `1`: a report was produced but local prerequisites are not ready: missing
  required tools or schema, consent not accepted/verified, MCP OFF, or not signed in.
- Exit `2`: setup/protocol/timeout error (including an invalid binary path); a
  fixed error code is printed.
- Exit `130`: interrupted.

Reports allowlist local booleans, public terms version, blocked reason, tool
count and optional-group availability; raw server output/stderr is not printed.
The helper (and the installer's native setup call) removes inherited
`REPC_STATE_DIR`, `REPC_MCP_AUTH_TOKEN`, `REPC_BACKEND_URL` and the
`AIRDESK_STATE_DIR`, `AIRDESK_MCP_AUTH_TOKEN`, `AIRDESK_BACKEND_URL` overrides so
it checks the normal app profile. It does not verify code signatures: run only a
trusted installed executable.

**`targetVerified` is always false.** Verify target installation, host sharing,
approved access and AI remote computer use ON separately before connecting. A local
diagnostic cannot attest the target setting. If `terminalAdvertised` or
`terminalSupported` is false, ask the user to check target Remote Terminal.
These flags can also be false on unsupported/outdated hosts, so do not diagnose
OFF solely from a capability flag. After enabling, reconnect/recheck if needed.

## Online MCP and Mobile

Online MCP lets a client that cannot start a local process (Claude or ChatGPT on
the web or a phone, a cloud agent) use AirDesk through
`https://mcp.airdesk.co.kr/mcp`. Online connections use the target host directly.
See the [online connection guide](online.md).

1. **Prepare the AirDesk host or controller.** Direct mode is the online default.
   For direct mode, prepare the
   account-owned target with hosting, an interactive signed-in desktop, current
   AI terms, **AI remote computer use (MCP)** and **online MCP**. Confirm the
   grant offers `direct_host` in the live tool catalog and verify the target by
   direct discovery and connection.
2. **Target.** Confirm hosting, access approval, and permissions for the task.
   Follow the [direct-host gate](online.md#direct-host-without-a-bridge) for a
   direct session.
3. **Sign in from the client**, one of:
   - **Claude (web, desktop and mobile):** Settings → Connectors → Add custom
     connector, URL `https://mcp.airdesk.co.kr/mcp`, then Connect and approve
     in AirDesk. A connector added once is available in the mobile app. Upload
     the skill zip (below) under Settings → Capabilities → Skills.
   - **ChatGPT:** with developer mode on, add a custom MCP server with the same
     URL and OAuth, then approve in AirDesk.
   - **Coding agents:** `node bin/cli.mjs install --mode online
     --client <id>`. The result's `signIn` field says how that client finishes
     OAuth (for example `/mcp` in Claude Code or `codex mcp login airdesk`).
     Online entries are written for `codex`, `claude-code`, `cursor`, `vscode`,
     `gemini-cli`, `opencode` and `generic`; other clients add the URL in their
     own settings.
   - **API key instead of OAuth:** create a key under My Page → API keys (2FA
     required), set `AIRDESK_MCP_KEY` in the environment that starts the
     client, and install with `--mode online --auth key` (`codex`,
     `claude-code`, `cursor` and `opencode`). The installer writes only a
     reference to the variable, never the key.
4. For OAuth, sign in to AirDesk with the usual account requirements. Choose the
   scopes (`observe`, `input`), expiry and allowed computers, then approve in the
   browser. Revoke a grant or key in My Page at
   any time.

An `airdesk` entry already registered for local mode is not replaced; remove it
first (for example `claude mcp remove airdesk`) to switch a client to online.

### Skill zip and plugins

- `node bin/cli.mjs pack --lang ko` writes the skill folder as a
  zip for Claude or ChatGPT skill upload. `--format plugin` writes a plugin
  archive that also declares the online MCP server.
- Claude Code plugin marketplace: `/plugin marketplace add
  AirDesk-Inc/remote-computer-use`, then install `remote-computer-use`,
  `remote-computer-use-ko` or `remote-computer-use-ja`. Plugins use online MCP.

## Troubleshooting

| Result | Next step |
| --- | --- |
| `airdesk_not_installed_at_path` | Install AirDesk or provide its exact trusted path. |
| `required_tools_missing` | Confirm the MCP client is using the current AirDesk executable and has discovered its tools on a fresh connection. |
| Older AirDesk tools or `Transport closed` after an update | Start a fresh MCP client connection. If the executable and registration on disk are current in Codex, [refresh the live MCP connection](#refresh-a-stale-codex-mcp-connection). |
| `required_tool_schema_missing` | Update the app: required ref-click or interactive-window options are missing. |
| `ai_remote_access_terms_required` | Sign in and review/accept the current AI terms in AirDesk, then retry. Never edit receipts or auto-accept. |
| `terms_status_unavailable` | Update the native app/helper so consent status can be verified. |
| `policy_unavailable` | Resolve access to normal AirDesk settings; do not repeatedly toggle MCP or edit auth/settings files. |
| MCP flag false with current terms accepted | Enable AI remote computer use in AirDesk or explicitly rerun the authorized installer. |
| `remoteTerminalEnabled: false` locally | Incoming shell hosting is off on this controller. Outgoing MCP readiness is checked separately. |
| `skill_upgrade_required` | Use explicit `--upgrade` for an unchanged official release listed above; the old directory is backed up. |
| `skill_upgrade_storage_unavailable` / `skill_upgrade_storage_volume_mismatch` | No safe backup/staging location exists outside discovery on the same filesystem. Keep the old skill and choose a suitable `--skills-dir`; do not copy a backup into a discovery root. |
| `existing_skill_conflict` | Inspect user changes/extra files; do not force overwrite or delete them. |
| `native_app_update_required` | Update AirDesk. Skill-only copying/config output can prepare files but does not establish current consent or readiness. |
| `credentialAvailable: false` | Sign in through the controller app, restart MCP, retry. |
| `unsupported_protocol_version` | Update the app/helper; do not bypass negotiation. |
| `response_timeout` / invalid protocol | Restart the MCP process, verify app compatibility. Do not publish raw logs. |
| Target access cannot be verified | Ask its owner to confirm sharing/access; do not connect yet. |
| Target Remote Terminal OFF | For shell work, ask the owner to enable it in target hosting settings and recheck current terms. |
| Connection denied / host unavailable | Verify hosting, sharing approval, network and target settings in AirDesk. |
| Screenshot present, input unavailable | Check `inputReady`, selected display and permissions; do not spam input. |
| Desktop automation unsupported | Request a compatible AirDesk build with the bundled agent-desktop engine; stop the UI task. |

`controllerCapabilities` reports optional agent-desktop gestures, desktop tools
and debug logging. Required core tools include agent-desktop discovery, snapshots,
screenshots, click, typing and keyboard operations. The diagnostic checks their
presence and the ref-based click schema; it does not execute them on the target.
`targetVerified` remains false in every diagnostic result.

### Refresh a stale Codex MCP connection

An open chat can still have an earlier MCP connection after the AirDesk app,
registration, or skill on disk has been updated. Finish active MCP work before
restarting. In the Codex desktop app open **Settings → MCP servers** and select
**Restart**. A fresh chat in the same project is another way to try the current
registration. [Official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp)

In the chat that will do the work, check `/mcp` and the live tool catalog, then
call `remote_status` to confirm readiness. If the tools are still stale, report
the mismatch. After reconnecting to an approved target, use the returned
`sessionId` and a fresh snapshot for element refs. Discard IDs and refs from
the old connection.

Reference: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp),
[Codex skills](https://learn.chatgpt.com/docs/build-skills),
[Claude Code skills](https://code.claude.com/docs/en/skills),
[Claude Code MCP](https://code.claude.com/docs/en/mcp),
[Agent Skills specification](https://agentskills.io/specification),
[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

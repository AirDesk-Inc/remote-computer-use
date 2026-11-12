# Current automation contract

Screen, window and browser UI automation uses the bundled target agent-desktop
engine exclusively through `remote_desktop_*`. The former video-input,
UIA/Accessibility and CDP tool families have been removed without aliases.
The diagnostic now requires the core agent-desktop tools and a ref-based click
schema. Package tests cannot prove native OS permission or target execution.

The dated checkpoints below record earlier releases, including retired APIs;
they are not the current tool contract.

# Validation and Compatibility

## Automated Coverage

The standard-library test suite uses deterministic local MCP subprocess fixtures:

- Initialization order, protocol version, tool discovery and pagination.
- Exactly one allowed tool call: `remote_status`; no remote discovery or control.
- Each required flag OFF, missing/invalid flags, and missing tools.
- Controller MCP ON with local Remote Terminal OFF remains ready.
- Current consent is required separately from the saved switch; missing consent
  status is unverified, not ready. Blocked reasons are allowlisted.
- Required screenshot-bound pointer schemas and optional controller tool groups.
- Structured results and the legacy text-JSON fallback.
- JSON-RPC errors and tool-level errors without raw message disclosure.
- Invalid JSON/UTF-8, oversized messages, wrong response IDs, EOF, notifications,
  queue flood, timeouts, failed exits, and child-process cleanup.
- Ignoring injected test credentials/profile overrides.
- Configuration escaping, binary path checks, and no process launch for `config`.

Run from the repository root:

```sh
npm ci --ignore-scripts
npm test
npm run check:package
python3 -m unittest discover -s tests -v
```

The Node installer suite covers safe config merging, repeated installs,
conflicting existing data, dry-run/skill-only behavior, native compatibility and
enable failures, known terms errors before writes, bounded partial-install
recovery, official-release upgrades with backups, Python cache handling,
concurrent file edits, selected JSON clients, path escaping, and CLI validation.
Codex TOML remains append-only; JSON merges retain unrelated entries and a prior-file
backup. Desktop/generic skill import is not asserted by a successful MCP config write.
Tests use temporary files
and stub native setup; they do not change real AirDesk settings. The package
check validates the allowlisted archive contents and size without publishing.

CI is configured for Python 3.10 and 3.13 on macOS, Windows, and Linux. A configured
matrix is not evidence that those jobs have passed; inspect the actual Actions
run. Node.js 22/24 installer jobs cover the same OS matrix. Linux here tests
packaging/helpers, not a Linux AirDesk host.

## Initial Native Check

On 2026-10-24, the helper was run against the installed macOS AirDesk release:
MCP initialization, discovery of 25 tools, and the local status call succeeded.
The local MCP and Remote Terminal settings were OFF, so the diagnostic correctly
returned a non-ready result. Those settings were not changed. No account secrets,
target identities, or raw app state are included in this repository.

This proves compatibility of that installed build's local stdio/status contract.
It does **not** prove end-to-end remote screen, mouse, keyboard, terminal, Windows
UI Automation, or host permission enforcement. No remote session was opened as
part of publication. At that native checkpoint, target MCP was not a transport
prerequisite; the current skill policy below requires it ON. Approved host access and
Remote Terminal for shell tools are still required. Desktop/browser automation
uses approved host access and input permissions, independently of the shell setting.

## Target-OS Guides, 0.3.0

The 0.3.0 skill applies the Windows or macOS agent-desktop guide automatically
on every connection. Native AirDesk builds report `targetOs` and
`agentDesktopPlatformSkill` in `remote_connect`/`remote_status`; older builds
fall back to the `os` field of `remote_list_computers`. The skill confirms the
target's own `remote_desktop_skills_get name=platform` result before any input.

`references/platform-windows.md` and `references/platform-macos.md` summarize and
adapt the upstream `agent-desktop-windows` / `agent-desktop-macos` skills
(vercel-labs/agent-desktop, Apache License 2.0, revision `b43ac4f6`, identical to
upstream `main` when prepared) for AirDesk's MCP argument names, and add AirDesk
field notes observed on Windows 11 ARM64 on 2026-11-07/08. The core reference adds
the CLI-to-MCP translation, AirDesk's headed engine mode, disposition rules and an
index of upstream references fetched from the target. The `doctor` helper reports
`targetOsReporting` without changing readiness. The 0.2.0 npm archive integrity
was verified before its per-file hashes were added for explicit upgrades.

## Native Enhancements, 2026-10-25

At the 2026-10-25 source checkpoint the native registry exposed 32 tools; current
tool availability must be discovered rather than inferred from that historical
count. The focused tests at that checkpoint covered
screenshot bindings/automatic coordinate mapping, stale display/session/size
rejection, frame wait timeout, named chords, MCP revocation and terminal ownership.
A disposable sandboxed headless Chrome profile verifies actual CDP tab discovery,
navigation, DOM text input/click, password redaction and stale snapshot rejection.
The Mac native fixture tests worker framing/cancellation and uses a temporary
owned window to test AX discovery, password redaction and value updates when OS
Accessibility permission is available; permission-denial coverage is distinct.
These checks do not certify Windows runtime or installed two-computer acceptance.
Browser DOM requires an explicitly enabled target loopback debugging browser;
installing this skill does not enable browser debugging or update the native app.

## Source improvements, 2026-10-29

At that checkpoint the skill described PNG-bound click/drag/scroll, region zoom that
retains full-PNG coordinates, actual cursor telemetry, bounded key repeat/hold,
and Windows/macOS window coordinates separately. New tools require the matching
native app and negotiated target capability. Browser traversal exclusions, tab
activation, bounded semantic editing and persistent local/remote debug settings
are explicit. The observation-only window guidance at that checkpoint is
superseded by the interactive-window policy below. Native runtime behavior must
be verified separately from documentation/package checks.
This package change does not install a native app, modify in-app
consent, configure a real user profile, publish npm or prove two-computer input.

Official earlier npm archive files (0.1.0 and 0.1.1) were read from the public
registry and checked against their SHA-512 integrity values to generate the
shipped SHA-256 upgrade manifest (`lib/skill-releases.json`). A known 0.1.0 Git
source variant is separately identified. The complete previous skill directory
is retained during upgrades; customization is rejected
instead of overwritten.

## Interactive Window Policy, 2026-10-31

The default MCP/RCU remote-desktop policy and skill explicitly use
`video:true,showWindow:true`. Visible connections must open a real interactive
remote window with local mouse/keyboard forwarding and the normal toolbar,
subject to existing host input permissions, not an observation-only window.
Manual and AI input share it; pause AI input during user interaction and
re-observe after handback. Native MCP/agent ownership, returned session IDs,
owned-terminal/held-input cleanup and window-close session termination remain.
Headless/no-video modes require the user's explicit request; an older build must
not silently fall back or be treated as satisfying this policy.

Authentication, current consent, host/input permissions and the target's shell
terminal permission gate are unchanged. The window's automatic clipboard
capture/sync remains disabled for MCP ownership; explicit clipboard tools are
separate actions that work independently of that sync. Window visibility
does not enable audio; microphone, overlay and recording settings are unchanged.
Do not promise automatic clipboard or audio. This documentation/installed-skill
update does not change or verify native runtime behavior. Package checks cannot
prove an interactive window, manual input forwarding, toolbar behavior or native
ownership/cleanup; those require the opt-in checks below.

Native checkpoint (2026-10-31, separate from npm publication): the macOS source
implementation and signed installed app were updated. A fresh native stdio
session returned the interactive connection description, `interactiveWindow:true`,
`localInputReady:true`, input/video readiness and a STEAMDECK PNG. Focused input,
policy, clipboard, close, cursor, stdio and GUI-lifetime tests passed. The user
subsequently confirmed STEAMDECK remote interactions work. Repeated IDRs were
reported separately and remain under investigation; input acceptance does not
prove stable video recovery. No AI input was sent during the manual handoff.
Linux's no-display SDL idle fixture passed.
That checkpoint did not verify live Linux/Windows controller acceptance or any
npm registry publication, and this document makes no claim about the registry's
current status.

## Integrated agent-desktop

The skill documents the integrated `remote_desktop_*` tools in the
[agent-desktop guide](../skills/remote-computer-use/references/agent-desktop.md).
This repository's automated tests do not exercise the native engine, and the
diagnostic helper does not validate those tools.
Their availability, schemas, host permissions, ref lifetimes, transport limits and
teardown behavior depend on the native AirDesk builds and must be verified
against them, never inferred from this documentation or a package version.
Neither this skill nor the helper proves that a selected host has the engine.

## Opt-In Acceptance Checklist

Use an authorized target and a disposable app or document.

- [ ] Verify controller MCP and current AI terms with its incoming Remote Terminal off.
- [ ] Verify target-approved desktop automation with the target's controller MCP and Remote Terminal off.
- [ ] Verify a denied target shell with Remote Terminal off, then an approved shell with current host terms.
- [ ] Verify `targetRemoteTerminal.connected` in fresh discovery and `sessionConnected` in selected status when opening and closing an owned shell.
- [ ] Authenticate/approve the intended user; select the exact authorized target.
- [ ] Verify omitted connection options default to `video:true,showWindow:true`;
      verify the skill explicitly passes both true. Check separate video/window
      status, current session/display and a changing screenshot.
- [ ] Verify a real interactive remote window with the normal toolbar, not an
      observation-only window. With AI input paused, test the controller's physical
      mouse and keyboard under existing host input permissions. Hand back to AI,
      take a fresh observation and verify MCP input on the same owned session.
- [ ] Confirm native MCP/agent ownership and session ID continuity; closing the
      window must not leave a separate unowned/manual session.
- [ ] Verify the window's automatic clipboard capture/sync stays disabled for MCP
      ownership, and that the visible window does not auto-enable audio or change
      microphone/overlay/recording.
- [ ] Verify headless (`video:true,showWindow:false`) and no-video (`video:false`)
      modes only when the user explicitly requests those acceptance tests.
- [ ] Verify the target platform's native coordinate space on an authorized test control.
- [ ] Switch a display, wait for completion, and discard old coordinates.
- [ ] Test click, key, composed text and key/button release in a test document.
- [ ] Open/read/write/resize/close a terminal and verify a harmless command's
      shell exit status, not merely transport acknowledgment.
- [ ] On supported Windows/macOS targets, discover an app/window and use a fresh UI
      snapshot; check stale-ID and unsupported-control behavior.
- [ ] Disable MCP in the controller app and verify controls stop. Check target
      permission revocation separately; do not claim remote attestation.
- [ ] If `remote_desktop_*` tools are advertised, read the desktop/platform guides,
      then snapshot, act on a fresh ref and re-observe in a disposable app. Check
      that refs are rejected after disconnect, that `remote_desktop_*` clipboard
      access (if any) needs explicit task authorization, and the Windows
      spawned-app lifetime on disconnect.
- [ ] Connect a Windows target and a macOS target in turn. Check that
      `remote_connect` reports `targetOs`/`agentDesktopPlatformSkill`, that the
      target's `remote_desktop_skills_get name=platform` returns the same skill,
      and that no rules, refs or window IDs carry over between the two.
- [ ] Confirm owned terminal/session cleanup, including cancellation/timeouts.
- [ ] Close the owned real remote window and verify session end, held-input
      release and owned-terminal cleanup without automatic reconnect.

Record app/skill versions, OS, action, expected/observed result and limitations
without saving credentials, host/session IDs, personal screens, or private logs.

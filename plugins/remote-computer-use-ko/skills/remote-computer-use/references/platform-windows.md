# Windows Target Guide

Apply this guide automatically when the connected target is Windows:
`remote_connect`/`remote_status` report `targetOs: "windows"` and
`agentDesktopPlatformSkill: "agent-desktop-windows"` (older apps: the target's
`os` in `remote_list_computers`). Read [agent-desktop.md](agent-desktop.md) first.

The rules below summarize and adapt the upstream `agent-desktop-windows` skill
([vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop),
`skills/agent-desktop-windows`, Apache License 2.0; modified by AirDesk-Inc, see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md))
for AirDesk's MCP tools. The guide returned by
`remote_desktop_skills_get` with `name: "platform"` on the target is the
version-matched original and wins where they differ, except where the same
result's `airdeskHostGuidance` says otherwise: that text describes AirDesk's own
additions on that host and takes precedence. Field notes are AirDesk
observations, not upstream claims.

## Before the First Action

1. `remote_desktop_skills_get` `{name: "platform"}` must return
   `data.skill: "agent-desktop-windows"`. Any other value means the target is not
   the Windows host you think it is: stop and reconcile before acting.
2. `remote_desktop_status` should report `platform: "windows"` and
   `permissions.accessibility.state: "granted"`. Windows has no permission
   dialog; elevation (UIPI) boundaries are the only access control.
3. The target must be the signed-in user's interactive desktop. The sign-in
   screen, a locked desktop, UAC prompts and another user's session are not
   drivable; observation there fails or returns nothing.

## What Works How

| Group | MCP tools | Windows behavior |
| --- | --- | --- |
| Observe | `snapshot`, `find`, `get`, `is`, `screenshot` | Works. Surfaces: `window`, `focused`, Chromium modal as `sheet`, open menu as `menu` (no `menubar` surface). |
| Ref actions | `click`, `set_value`, `clear`, `select`, `check`, `uncheck`, `toggle`, `expand`, `collapse`, `scroll`, `scroll_to` | Semantic UI Automation calls. |
| Physical | `type`, `right_click`, `double_click`, `triple_click`, `focus`, `press`, `hover`, `drag`, `mouse_*` | Keystroke/pointer synthesis through `SendInput`. AirDesk runs them in headed mode; they can take the foreground of the visible remote desktop. |
| Held input | `key_down`, `key_up`, `mouse_down`, `mouse_up` | Supported on current AirDesk Windows hosts as standalone tools, on the signed-in user's normal desktop. The upstream platform guide's "Fails closed on every platform with `ACTION_NOT_SUPPORTED`" row describes the engine CLI and `remote_desktop_batch` only; `airdeskHostGuidance` overrides it for these tools. See [held input](agent-desktop.md#held-input). |
| Window inventory | `list_windows` (not `list_windows_resilient`) | `remote_desktop_list_windows_resilient` is macOS-only. Current controllers refuse it for a Windows target with `platform_not_supported` before contacting the host; older hosts return `PLATFORM_NOT_SUPPORTED`. |
| Apps/windows | `launch`, `close_app`, `list_apps`, `list_windows`, `focus_window`, `restore`, `minimize`, `maximize`, `move_window`, `resize_window` | Works; see launch rules below. |
| Shell | `open_system_surface` | `start-menu`, `taskbar`, `system-tray`, `system-tray-overflow`, `action-center` (not `quick-settings`). |

All tool names above carry the `remote_desktop_` prefix and the `sessionId` argument.

## Rules

- **Refs must be unique in the window.** A ref resolves only if exactly one live
  element still matches its role, native id, name and description, counted over
  the whole window (not just a skeleton cut). Identical twins (several `Delete`
  buttons) are refused with `AMBIGUOUS_TARGET` before anything is sent. Act on a
  unique control; pick a twin only with `mouse_click` `{xy}` after a fresh
  screenshot, and only when that is clearly within the task.
- **Minimized windows are not drivable.** Every element reports `offscreen`.
  `restore` the window (`window_id` from `list_windows`), then snapshot again.
  Do not call `focus_window` by reflex; it steals the remote user's foreground.
- **Text: prefer `set_value`.** `set_value` writes through the UIA value pattern
  and verifies the element value. `type` is keystroke synthesis: use it only when
  the app needs real key events, then read back with `get`. Treat anything but
  `delivered_verified` as unverified (`verification_reason: postcondition_mismatch`
  means the field holds other text).
- **`press` goes to the foreground window.** It has no per-process targeting.
  Confirm with `list_windows` that the intended window has `is_focused: true`
  before any destructive combo (`ctrl+w`, `ctrl+a`+`delete`, `return` on a dialog).
- **Blocked combos** (`alt+f4`, `win+l`, `win+d`, `alt+tab`, `win+r`, `win+x`,
  `win+e`, `ctrl+shift+esc` and supersets) are refused without `force`. Do not pass
  `force` unless the user asked for that exact shortcut. `cmd`/`meta` mean the
  Windows key; copy is `ctrl+c`.
- **Chromium/Electron trees read thin before they settle.** Raise `timeout_ms` on
  `snapshot`/`find` instead of concluding the tree is empty. A covered Chromium
  window can stay thin until it is uncovered.
- **Stateful actions run once, then verify.** `ACTION_FAILED` with
  `details.kind: "post_action_verification"` means the action landed but the
  readback differs: read `details.post_state`, do not retry.

## Launch and App Identity

- In direct mode, use an installed app name that the host recognizes, such as
  a registered Start menu app or a supported system GUI executable name.
  Follow the target's direct app launch policy. [Online MCP guide](online.md)
- In native mode, `launch` accepts an absolute path or a bare executable name
  under System32 or the Windows directory (`notepad`, `calc.exe`). Use
  `list_apps` or `list_windows` to find apps that already run.
- If several instances already run, `launch` returns `AMBIGUOUS_TARGET` and
  `no_attach` fails with "Application is already running". For a browser that is
  already open, use its existing window (new tab with `press ctrl+t`) instead of
  launching another instance.
- Processes started directly by the engine belong to its Job Object and can
  close when the AirDesk session disconnects. Do not leave unsaved work in them.
- Do not use `launch`'s `cdp` argument: AirDesk has no CDP client and it opens a
  debugging port on the target. Use the accessibility path for web contents.

## Field Notes (AirDesk, Windows 11 ARM64, 2026-11-07/08)

- **Notepad restores old tabs.** Windows 11 Notepad reopens previous documents, so
  `launch notepad` can focus an existing document. For new text, `press ctrl+n`
  and target the new tab's editor (`role: "textfield"`; its name is localized,
  for example `텍스트 편집기` / `Text editor`). Close only tabs you created.
- **`focus_window` can report failure after succeeding.** It returned
  `ACTION_FAILED` "Window focus did not settle" while `list_windows` already
  showed the window with `is_focused: true`. Check `list_windows`; never send
  keys based on the error alone. If Windows leaves the target in the background,
  bring the observed window forward in the visible remote session when authorized,
  then read back `is_focused` before sending keys.
- **AirDesk host foreground fallback (host builds after 2026-11-12).** When
  another app holds the foreground, the engine refuses headed `type`, `press`,
  `focus`, `clear`, `click` variants and `focus_window` with `ACTION_FAILED`
  "Target window did not become foreground before headed delivery"
  (`not_delivered`, `retry: safe`). The host then passes foreground rights to the
  engine once (no-op input event + `AllowSetForegroundWindow`) and replays the
  same call once; the engine still checks the window identity. If the error is
  still returned, Windows refused the grant: do not loop. Click the target's
  title bar with `mouse_click` only when authorized, then read back
  `is_focused`. `_meta["kr.co.airdesk/host_fallback"]` lists what the host tried.
  `remote_desktop_batch` is never replayed.
- **`focus_window` "did not settle" is read back on the host.** The host lists
  windows twice; if exactly the requested window (same id, pid and process
  instance) is focused, the result is success with
  `data.airdesk_focus_readback.verified: true`, including the already-focused
  no-op. The superseded engine refusal appears only as
  `engine_result: {code, superseded: true}`, not as an error. Otherwise the
  original error is returned unchanged.
- **`type` into an element without keyboard focus.** "Target element lost focus
  before physical input delivery" with `not_delivered` makes the host call
  `focus` (UIA SetFocus) on the same `ref_id` once and replay `type` once. It
  does not apply to `interval_ms` typing or a partly delivered `type`. If the
  element refuses SetFocus, the original error is returned: click inside the
  field first, then snapshot again.
- **Korean `type` was once reordered.** Right after launching Notepad, a mixed
  Korean/ASCII `type` produced swapped words with
  `postcondition_mismatch`; repeated runs were exact. Use `set_value` for exact
  text, or `get` after `type` and correct only after a fresh read.
- **Clearing with `set_value ""` may need the foreground.** It fell back to a
  physical clear and failed with "Target window did not become foreground". After
  confirming focus, use `press ctrl+a` then `press delete`, or `clear`.
- **Restoring a busy window can time out.** `restore` on a minimized browser
  playing video returned `automation_result_unknown`, yet the window was
  restored. Observe with `list_windows` before any retry.

## Upstream References (read before use)

This guide does not summarize the topics below. Read the reference first:

- **Any `xy` coordinate** (`mouse_click`, `mouse_move`, `mouse_wheel`, `drag`
  with `from_xy`/`to_xy`): DPI-scaled coordinates in `troubleshooting`.
- **Saving a document without keyboard input**, a `set_value` the app reshapes,
  `INTERNAL: "private file parent is owned by a foreign principal"`, a UWP app
  that reads as `ApplicationFrameHost`, COM apartment errors: `troubleshooting`.
- **An elevated (administrator) target or protected process:**
  `permissions-and-elevation`.
- **Start menu, taskbar, tray, Action Center notifications, cursor overlay:**
  `shell-and-overlay`.
- **A thin Chromium/Electron/WPF tree or unnamed web content:**
  `chromium-and-electron`.

| Symptom or task | `remote_desktop_skills_get` arguments |
| --- | --- |
| Empty/tiny tree, `PERM_DENIED`/`E_ACCESSDENIED`, DPI coordinates, action verification, saving a document | `{name: "platform", reference: "troubleshooting"}` |
| Elevated target, blocked combos, protected processes, interaction lease | `{name: "platform", reference: "permissions-and-elevation"}` |
| Chromium/Electron/WPF settle, unnamed web content | `{name: "platform", reference: "chromium-and-electron"}` |
| Start menu, taskbar, tray, notifications, cursor overlay, UWP identity | `{name: "platform", reference: "shell-and-overlay"}` |

# macOS Target Guide

Apply this guide automatically when the connected target is macOS:
`remote_connect`/`remote_status` report `targetOs: "macos"` and
`agentDesktopPlatformSkill: "agent-desktop-macos"` (older apps: the target's
`os` in `remote_list_computers`). Read [agent-desktop.md](agent-desktop.md) first.

The rules below summarize and adapt the upstream `agent-desktop-macos` skill
([vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop),
`skills/agent-desktop-macos`, Apache License 2.0; modified by AirDesk-Inc, see
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md))
for AirDesk's MCP tools. The guide returned by
`remote_desktop_skills_get` with `name: "platform"` on the target is the
version-matched original and wins where they differ. Field notes are AirDesk
observations, not upstream claims.

## Before the First Action

1. `remote_desktop_skills_get` `{name: "platform"}` must return
   `data.skill: "agent-desktop-macos"`. Any other value means the target is not
   the Mac you think it is: stop and reconcile before acting.
2. `remote_desktop_permissions` (no arguments) reads Accessibility, Screen
   Recording and Automation without prompting. The engine runs as a child of the
   target's AirDesk.app, so AirDesk.app needs Accessibility (macOS 27+: Device
   Control and Data Access); if System Settings lists the `agent-desktop` helper
   separately, it needs the grant too. AirDesk uses Screen Recording to share
   this Mac's screen and capture screenshots. Automation shows `unknown` when
   macOS would have to prompt.
3. `guide: true` opens System Settings with a drag-in panel on the **target's
   screen**, and `request: true` shows system prompts there. Use them only when
   the target's owner is present and asked for it. The owner grants access in
   Privacy & Security. While AI remote computer use is enabled on the Mac,
   **Review macOS permissions** in AirDesk Share or Settings reopens the guide.
   Refresh the status after granting access and restart AirDesk if needed.

## What Differs on macOS

- **Headed by default.** AirDesk runs the engine headed, so `click`,
  `right_click`, `type`, `clear` and `scroll` use physical paths first: they focus
  the exact owning window and verify the hit target before delivery. Clicks on
  items of an app's native menu bar call `AXPress` without moving the pointer.
  `expand`, `collapse`, `set_value`, `select`, `toggle`, `check`, `uncheck`,
  `focus` and `scroll_to` stay semantic. Raw `xy` input never changes focus.
- **Judge delivery by observation.** AX return codes do not prove an effect
  (Finder reports success from an `AXConfirm` that does nothing). Snapshot again
  or use `get`/`is`.
- **Surfaces.** `surface: "menubar"` for File/Edit/View menus,
  `"menu-bar-extras"` for status items (no `app` = system items such as Wi-Fi and
  Clock), `"dock"` for the Dock, `"sheet"`/`"alert"`/`"popover"` for overlays.
  While an overlay is open, refs from the window behind it are the wrong target.
  A menu-bar-only app is observable through its process:
  `snapshot` `{app: "Control Center"}`.
- **Menus.** `select` `{ref_id, value}` for combo boxes and menu buttons
  (dismiss any open menu first). If `right_click` returns `APP_UNRESPONSIVE` with
  `retry: unsafe`, the menu may be open. Inspect the
  [current context menu](#context-menus) before any further input.
- **Identity.** `launch` accepts a display name (`"TextEdit"`, `"System
  Settings"`) or a bundle ID. Other tools take the display name through `app`.
  `window_id` values such as `w-4521` stay valid for the life of the window.
- **Native-address refs.** A ref returns to the exact element it was captured
  from, so identical twins each keep their own ref. A removed element is
  `STALE_REF` (`retained_object_stale`) and never falls back to a look-alike.
- **Keys.** The primary modifier is `cmd` (`press` `{combo: "cmd+s"}`). Quit
  combos (`cmd+q`, `cmd+shift+q`, `cmd+alt+esc`, ...) return `POLICY_DENIED`
  without `force`; quit apps with `close_app` instead and only when authorized.
- **Chromium/Electron.** Web accessibility is switched on automatically. For a
  dense app, `snapshot` `{app, skeleton: true, interactive_only: true,
  compact: true}`, then drill with `root`. Do not use `launch`'s `cdp`
  argument: AirDesk has no CDP client.

## AirDesk Additions for macOS

- **Unstable global window list.** `list_windows` without `app` can return
  `TIMEOUT` with `global_window_inventory_unstable` / `global_window_owner_churn`.
  Pass `app`, or use `remote_desktop_list_windows_resilient` (macOS only,
  `timeout_ms >= 2000`). A recovered list does not prove the engine can use those
  window IDs in `snapshot`/`find`.
- **Sheet and dialog buttons.** A physical `click` on an open/save sheet button
  can be refused with "Physical input target has no verified owning window"
  (`delivery: not_delivered`). Use `remote_desktop_semantic_click` with the same
  ref: an explicit headless `AXPress` that never moves the pointer. A failed or
  unknown result is not proof the button was not pressed; snapshot first.
- **Open and Save file sheets.** A deep `find` or snapshot can exhaust its
  traversal budget inside the file browser before reaching the footer. Use
  `remote_desktop_snapshot` on the observed parent `window_id` with
  `surface:"sheet"`, `max_depth:1`, `skeleton:false`, `compact:false`, and
  `interactive_only:false`. Identify the intended button by its current label
  and unique ref. If authorized, use `remote_desktop_semantic_click` once on
  that ref and observe the same parent window to confirm the result. An
  app-scoped Escape can report delivery while the file sheet stays open.
- **Incomplete `list_surfaces`.** Call it with the exact `app` name. If an
  `APP_UNRESPONSIVE` error includes `details.observed_window_surfaces`, use a
  listed `window_id` to snapshot its reported surface type and verify the intended
  overlay. These are positive observations and the inventory remains incomplete.
  If the evidence is missing or the result is empty, inspect the exact parent
  window with a shallow snapshot when its ID is known.
- **Ambiguous app in `list_surfaces`.** Prefer the known unique canonical
  `app` name when available. An exact name can match multiple processes even
  when only one window is visible. For a read-only ordinary surface lookup
  after `AMBIGUOUS_TARGET`, use global `remote_desktop_list_windows` within
  the approved scope. Require exactly one `is_focused: true` window and match
  its `id`, `pid` and nonempty `process_instance` to the intended window.
  Then call `remote_desktop_list_surfaces` with the same `sessionId` and omit
  `app`. On success, match `data.pid` to the observed PID and immediately
  recheck the same exact focused window in the global list. Discard the result
  if any identity or focus check fails. The focused lookup omits AirDesk's
  app-scoped sheet and popup evidence.
  AirDesk macOS 1.0.71 returned `APP_NOT_FOUND` for this lookup even with a
  uniquely verified focused window. The explicit canonical `app` worked for
  the same target. If the focused lookup fails, keep focus in place and use
  an exact-parent shallow snapshot where applicable, or report the limit.

### Context menus

On the approved macOS target, call `remote_desktop_snapshot` with the current
`sessionId`, the exact discovered `app` name and `surface: "menu"`. For this
app-scoped lookup omit `window_id` and `root`. An app-scoped
`remote_desktop_list_surfaces` can also return popup evidence.

- Look for `observed_popup_window` in `data` on a successful menu snapshot or
  surface list, or in `error.details` on a menu snapshot error. An enclosing
  `complete: false` marks incomplete engine coverage. A snapshot can report
  `ELEMENT_NOT_FOUND` while carrying this evidence.
- When `accessibility` is `verified`, inspect `ax_menu.items` for the unique
  intended enabled item. Even when `ax_menu.complete` is false, individual
  items can carry an `item_ref`. Use the exact `item_ref` from the latest
  observation in the current session with the advertised standalone
  `remote_desktop_press_context_menu_item` `{sessionId, item_ref}`. The host
  checks the visible popup and presses the item once through Accessibility.
  Keep this call out of `remote_desktop_batch` and pass popup item refs only
  to this tool.
- Observe the app after the press. For uncertain delivery, inspect the
  resulting state and stop if you cannot determine the effect. Do not
  automatically repeat the press. If a ref expires before delivery, make a
  fresh observation and identify the item again.
- When the popup evidence contains geometry only (`accessibility: "unverified"`),
  inspect a fresh screenshot of the authorized display. The popup bounds
  alone do not identify a control. If the intended item or its actionable
  ref cannot be verified, report that limit without sending fallback input.

## Upstream References (read before use)

This guide does not summarize Notification Center actions (`--expected-app`,
`--expected-title`, `wait --notification`), punctuation key names in combos, the
cursor overlay's macOS limits, or the step-by-step fixes for each error. Read the
core `commands-system` reference before notification, clipboard or overlay work,
and the platform `troubleshooting` reference for any error below:

| Symptom or task | `remote_desktop_skills_get` arguments |
| --- | --- |
| `PERM_DENIED`, empty/sparse tree, slow snapshot, `ACTION_FAILED`, `POLICY_DENIED`, right-click menus, `select`, Notification Center, shortcut does nothing | `{name: "platform", reference: "troubleshooting"}` |

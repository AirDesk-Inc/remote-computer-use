# Remote Browser UI

Use the target-side [agent-desktop workflow](agent-desktop.md) for browser tabs,
address bars, forms and page accessibility. Check controller MCP and the target's
approved access and input permissions. Discover the browser window, take a fresh
snapshot and use the engine's refs and supported actions. Read the platform guide
when a browser exposes a thin accessibility tree; do not silently enable browser
debugging or change OS permissions.

On Safari, an HTML select timeout can leave a page context menu open. Inspect the
visible menu and reread the selected value before another action. An HTML
disclosure may be visible in a snapshot without an actionable ref. Use only a
targeted workflow supported by the live catalog and verify the resulting state.

When advertised, `remote_desktop_safari_list_controls` lists HTML details and
select controls in the current page of the exact focused Safari `window_id`.
Filter by `kind` or exact accessibility `label` when useful. Use a
`control_ref` from that window's latest list with
`remote_desktop_safari_set_disclosure` (`expanded`) or
`remote_desktop_safari_select_option` (exact visible option label as `value`).
Both actions also accept an observed `dom_id` in place of `control_ref`. A DOM
ID can come from `native_id.kind: ax_dom_identifier` in a current snapshot or
from the task's known HTML. Begin selection with other menus closed.
Refresh the list after navigation, reference expiry, or reconnection. Read
the state after every action, including any result with uncertain delivery.

AirDesk no longer exposes its separate `remote_browser_*` CDP/DOM tools. Do not
send their old tab IDs or element IDs to agent-desktop. If the browser does not
expose an operation supported by the engine, explain the limitation and stop
that part of the task. Never substitute a local browser or a shell bypass.

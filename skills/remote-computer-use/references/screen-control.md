# Screen and Input

Use [agent-desktop.md](agent-desktop.md) for screenshots, display discovery, pointer and keyboard input. Follow the live `remote_desktop_*` schemas and the remote platform guide. The former `remote_screenshot`, `remote_click` and related video-input tools are removed; no compatibility aliases are provided.

## Session Window

Visible native MCP connections open a **real interactive remote
window** on the **controller**, with local mouse/keyboard forwarding and the normal toolbar,
subject to existing host input permissions. An observation-only window does not
satisfy this policy. Native MCP/agent ownership (`agentControlMode`), returned
session IDs and owned-resource cleanup remain in force; this is not a separate
unowned manual session.

Manual and AI input share the same window. Pause AI input while the user
interacts; resume only after handback and a fresh screenshot/status check.
Do not assume the native app automatically arbitrates simultaneous input.

Automatic clipboard capture/sync in the window stays disabled for MCP ownership, even
with the normal toolbar visible. Explicit clipboard tools (see
[agent-desktop.md](agent-desktop.md)) are separate actions requiring task
authorization; they do not depend on, or turn on, that sync. Window visibility
does not enable audio; microphone, overlay and recording settings are unchanged.
Do not promise automatic clipboard or audio.

| Connection mode | Arguments | Result |
| --- | --- | --- |
| Native interactive desktop | Set `video:true,showWindow:true`. | Video and a real remote window with local mouse/keyboard and the normal toolbar. |
| User-requested headless | `video:true,showWindow:false` | Video and screenshot tools remain available without a window. |
| User-requested no-video | `video:false` | No video or window, regardless of `showWindow`. |
| Online direct host | `mode:"direct_host"` with an exact authorized `hostId` | Snapshots and screenshots from the target's agent-desktop tools. Status uses the returned `sessionId`. |

For online direct mode, follow [direct-host discovery and connection](online.md#direct-host-without-a-bridge).
The window behavior below applies to local mode. Use headless or
no-video local mode only when the user explicitly requests it. Controller `remote_status` reports `videoEnabled`
and `showVideoWindow` separately; neither replaces inspection of an actual frame.
Neither flag proves local input forwarding or the normal toolbar works.
Discover the installed server's schema first. If `showWindow` is missing or the
native build only opens an observation-only window, stop desktop input and
request a compatible app update. Do not silently omit the option or fall back
to headless mode; installing a skill does not update the native app.

Closing the real remote window ends its owned MCP session and initiates cleanup
of its owned terminals and held inputs, like disconnecting. Stop using that
`sessionId` and check whether terminal closure is acknowledged or still pending.
Do not silently reopen a window the user closed. Headless sessions still require
explicit `remote_disconnect` cleanup when the task is complete.

# Online MCP

Read this before the first tool call whenever the AirDesk server is the online
gateway, not the native stdio process. Everything in [SKILL.md](../SKILL.md)
still applies; this file adds what differs online.

## How Online Mode Works

- Endpoint: `https://mcp.airdesk.co.kr/mcp`, stateless Streamable HTTP.
- Calls do not run on the phone, browser or cloud agent that sends them. The
  gateway relays each call to a **bridge PC**: a computer of the same account
  that acts as the *controller*. Its owner signs in to AirDesk, accepts the
  current AI terms and turns on **AI remote computer use (MCP)** and **online MCP**.
- With AirDesk 1.0.71 or later installed on Windows, `AirdeskService` runs the
  bridge while a user is signed in to the active Windows console session.
  Closing the AirDesk window leaves the bridge available. Windows sign-out or
  stopping the service ends it.
- On macOS, portable Windows and older Windows versions of AirDesk, the
  AirDesk app runs the bridge and must stay running.
- You are in online mode when the catalog has no `local_*` tools, or the
  `initialize` instructions describe the online gateway. Do not assume a mode
  from the client name.

## Sign-in

- **OAuth** (preferred): Claude and ChatGPT connectors, Claude Code, Codex
  (`codex mcp login airdesk`), VS Code, Cursor, OpenCode and Gemini CLI open the
  AirDesk consent page. Sign in to AirDesk, complete any 2FA required for account
  sign-in, choose the scopes, expiry, allowed computers and optional bridge PC,
  then approve in the browser.
- **API key**: the account owner creates an `amk_...` key under My Page → API
  keys (2FA required) and provides it through the environment variable
  `AIRDESK_MCP_KEY` or the client's secret prompt.
- Never ask for a key, password or 2FA code in chat. Never print, store, log or
  forward one. If the server answers `MCP_KEY_INVALID`, ask the user to sign in
  again or replace the key in their client; do not retry in a loop.

## Scopes

| Scope | Allows |
| --- | --- |
| `observe` | Discovery, status, connecting by `hostId`, screenshots, snapshots, find/get/is, lists including `remote_desktop_safari_list_controls`, wait, `remote_performance_diagnostics` |
| `input` | Every other `remote_desktop_*` action (click, type, press, drag, scroll, launch of a bare app name, clipboard, permissions, trace export, session tools, cursor overlay), `remote_debug_mode`, connecting by a nine-digit remote ID |
| `terminal` | `terminal_*`, launching a shell or script host or any launch with `args` |

`tools/list` shows the tools available to the grant. The updated online catalog
lists `remote_desktop_batch` for `observe` grants. The gateway checks the required
scope of each nested command, so an observation-only batch needs `observe` and a
batch with an input or terminal command needs the corresponding scope. If the
current gateway does not advertise batches for this grant, call the individual
tools that it lists. `MCP_SCOPE_REQUIRED` names the missing scope. Tell the user
which scope the task needs and let them reauthorize or create a new key. Never
reach the same effect through a lower-scope tool, for example by typing commands
into a GUI terminal with `input` only.

## Additional Gate for the Bridge PC

Before the first `remote_connect`, `remote_status` must show the SKILL's
controller booleans as true. These describe the **bridge PC**. Then:

- `BRIDGE_OFFLINE`: the gateway could not reach the bridge. Ask the owner to
  check that the PC is awake and meets the applicable requirements above.
  On an installed Windows service build, check the console session and
  `AirdeskService`. For an app-owned bridge, check that AirDesk is running.
  The call is free. Do not poll. Retry after the owner confirms readiness.
- `BRIDGE_AMBIGUOUS`: several bridge PCs are online and the grant is not pinned
  to one. Ask the user to pin a PC in the consent or key form.
- `MCP_MODE_DISABLED` / `MCP_ONLINE_DISABLED`: MCP mode or online MCP is OFF, or
  the account does not have online MCP yet. Ask the owner; never toggle it.
- The bridge PC owner can turn tools off for online calls. The default is
  `remote_desktop_launch`, so a launch normally answers `BRIDGE_REJECTED` "This
  tool is turned off on this PC for online MCP." Ask the owner instead of
  imitating the tool through other input (Start menu, Run dialog, shortcuts).
- Target host approval and Remote Terminal admission follow the local rules.
  Use the authorized target's `targetRemoteTerminal` report for shell readiness.

## Online Restrictions

- **Forced shortcuts.** `force:true` on `remote_desktop_press` or
  `remote_desktop_key_down` returns `BRIDGE_REJECTED` in online mode. The same
  rule applies to calls inside `remote_desktop_batch` and to `terminal` grants.

- **Window required.** `remote_connect` must keep `video:true` and
  `showWindow:true`; `false` answers `WINDOW_REQUIRED`. Headless work is not
  available online. The remote window opens **on the bridge PC**, not on the
  user's phone. If the user is away from the bridge PC, say that someone there
  can see and use that window, and rely on screenshots and snapshots for your
  own observation.
- **Denied arguments.** The updated online tool schemas omit `output_path`,
  `out`, `image`, `file_url`, `pointer_image`, `cwd`, `env` and `cdp`.
  The gateway continues to reject these arguments for every scope, including
  inside a batch (`MCP_ARGUMENT_NOT_ALLOWED`). Return data inline and do not
  look for another way to write files.
- **Device restrictions.** The user can limit a grant to selected target
  computers, pin a bridge PC, or both. With a target list, use an exact
  `hostId` from `remote_list_computers`, which shows only allowed targets.
  A nine-digit remote ID or an unlisted host returns `MCP_HOST_NOT_ALLOWED`.
  For an existing session or its terminal, the gateway checks the recorded
  host and bridge against the applicable restrictions. A mismatch or missing
  required identity returns `MCP_SESSION_NOT_OWNED`. Status and discovery omit
  sessions outside the caller's grant or network.
- **Reconnect after a network change.** Each bridge has one active remote
  session. A session ID is bound to the opening network when known. If a switch
  between Wi-Fi and mobile data causes `MCP_SESSION_NOT_OWNED`, check
  `remote_status` and rediscover the approved target. With a restricted grant,
  automatic cross-network cleanup can retire
  an earlier session only when its confirmed host matches the exact requested
  `hostId` and its recorded bridge matches the verified bridge selected for
  the reconnect. Unrestricted grants can clean up other cross-network sessions
  on the account. If ownership is unclear or another client is using a
  session, let the owner resolve it before reconnecting. Use the new
  `sessionId` and observe again before using terminal IDs or element refs.

## Time, Size and Cost

- Each call has about 55 seconds. `BRIDGE_TIMEOUT` and `REGION_UNAVAILABLE` do
  not prove that nothing happened: observe before repeating any mutation.
- Results up to about 5 MiB are returned inline. Prefer `remote_desktop_snapshot`
  and `find` over screenshots; request screenshots no larger than needed.
- Calls are metered except `remote_list_computers`, `remote_status`,
  `remote_disconnect` and `tools/list`. A batch counts each command. Free plans
  include 500 calls a month, Pro 5,000, Teams 5,000 per seat.
- `RATE_LIMITED`, `QUOTA_EXHAUSTED` and `MCP_BUSY` carry a retry time. Wait at
  least that long, at most a few times, and tell the user when the monthly quota
  or `MCP_SPEND_CAP` stops the task.
- `MCP_RESULT_DELIVERED` means a repeated request already returned its result
  once. Observe the current state instead.

## Error Codes

| Code | Meaning | Do |
| --- | --- | --- |
| `MCP_KEY_INVALID` (401) | Missing, expired or revoked sign-in | Ask the user to sign in again |
| `MCP_SCOPE_REQUIRED` (403) | Grant lacks `scope` | Ask for the named scope |
| `MCP_ONLINE_DISABLED` (403) | Online MCP not available for the account | Stop and explain |
| `BRIDGE_OFFLINE` / `BRIDGE_AMBIGUOUS` | No bridge PC / several unpinned | See the bridge PC gate |
| `WINDOW_REQUIRED` | Headless connect attempted | Reconnect with the window |
| `MCP_ARGUMENT_NOT_ALLOWED` | Denied argument | Remove it; return data inline |
| `MCP_HOST_NOT_ALLOWED` | Computer outside the grant | Ask the user |
| `MCP_SESSION_NOT_OWNED` | Session ended, network changed, or the grant cannot use it | Check status, target and bridge before an authorized reconnect |
| `already_connected` | The selected bridge already has a session | Have the owner resolve a session you did not open |
| `BRIDGE_REJECTED` | Bridge PC refused (deny list, argument, account) | Report the message; ask the owner |
| `BRIDGE_TIMEOUT` / `REGION_UNAVAILABLE` | No answer in time | Observe before any retry |
| `RATE_LIMITED` / `QUOTA_EXHAUSTED` / `MCP_BUSY` / `MCP_SPEND_CAP` | Limits | Wait or stop as described above |

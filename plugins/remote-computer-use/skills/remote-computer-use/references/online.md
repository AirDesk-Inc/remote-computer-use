# Online MCP

Read this before the first tool call whenever the AirDesk server is the online
gateway, not the native stdio process. Everything in [SKILL.md](../SKILL.md)
still applies; this file adds what differs online.

## How Online Mode Works

- Connect to `https://mcp.airdesk.co.kr/mcp` using stateless Streamable HTTP.
- **Bridge** is the default online mode. The bridge PC belongs to the account
  and acts as the controller with a visible remote desktop window. Its owner
  signs in to AirDesk, accepts the current AI terms and turns on **AI remote
  computer use (MCP)** and **online MCP**.
- **Direct host** (`direct_host`) sends authenticated desktop tool requests and
  results through the gateway to the selected AirDesk target. It uses the
  same endpoint and account credentials without a separate bridge PC.
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
  `AIRDESK_MCP_KEY` or the client's secret prompt. Configure the remote MCP
  client to send the key as `Authorization: Bearer <key>` on requests. Use a
  secret reference in client configuration and keep the key out of the URL.
- Never ask for a key, password or 2FA code in chat. Never print, store, log or
  forward one. If the server answers `MCP_KEY_INVALID`, ask the user to sign in
  again or replace the key in their client; do not retry in a loop.

## Direct Host Without a Bridge

1. Confirm the task and the exact target with the user. The target must be an
   account-owned computer allowed by the key or OAuth grant. AirDesk hosting,
   an interactive signed-in desktop, current AI terms, **AI remote computer
   use (MCP)**, **online MCP**, and the target's task-specific permissions all
   apply. Use `observe` for discovery and inspection and `input` for UI changes.
2. Use `tools/list` to check that `remote_list_computers` and `remote_connect`
   advertise `mode: "direct_host"` for this grant. Rollout and host versions
   affect availability. If the option is absent, report that direct mode is
   unavailable for this grant. The prior bridge pin applies to bridge calls.
3. List with `{"mode":"direct_host"}`. In `structuredContent.computers`, choose
   the exact authorized `hostId` with `online: true` and `canConnect: true`.
   Use it for `remote_connect` with
   `mode: "direct_host"`. Direct discovery and connection use `hostId` rather
   than a nine-digit remote ID. Omit `video`, `showWindow`, `fps`, `codec`,
   `width` and `height`.
4. Check the connect result's `structuredContent` for `connected: true` and
   `capabilities.desktop: true`. Keep the returned `sessionId` and opening
   credential. Read
   `remote_status` with that ID after connecting. Check `connected` and
   `mode: "direct_host"`. A bare status call describes the bridge. Direct
   status has no controller-window or video readiness flags. Use the connect
   result's `targetOs` to apply the [target OS guide](../SKILL.md#apply-the-target-os-guide-automatic),
   then obtain a fresh snapshot before input. Disconnect the owned session
   with `remote_disconnect` when finished.

Example tool arguments. Substitute the exact ID from each preceding result.

```text
remote_list_computers {"mode":"direct_host"}
remote_connect {"mode":"direct_host","hostId":"<allowed-host-id>"}
remote_status {"sessionId":"<returned-session-id>"}
remote_desktop_snapshot {"sessionId":"<returned-session-id>"}
remote_disconnect {"sessionId":"<returned-session-id>"}
```

Direct mode provides agent-desktop snapshots and screenshots of the target's
actual desktop. It opens no controller window or video stream. Shared and team
hosts and `terminal_*` calls are unavailable in direct mode. Use the live
schema and the target's response to check each tool. Supported targets keep
held-key and button down/up as standalone calls owned by the session and check
each step of a direct batch individually. On supported Windows builds, direct
launch accepts the installed system apps `notepad`, `calc` and `mspaint` with
no launch arguments. A host tool block still applies.

An unavailable target or grant can produce `BRIDGE_OFFLINE` even for a direct
call. Check the target's AirDesk service, signed-in desktop and direct discovery.
For `MCP_SESSION_NOT_OWNED`, use the opening credential and the current session
ID. A timeout or `OUTCOME_UNKNOWN` requires a fresh observation before retry;
if the session was retired, obtain authorization before reconnecting. Ask the
user before switching an explicitly requested direct task to bridge mode.

## Scopes

| Scope | Allows |
| --- | --- |
| `observe` | Discovery, status, connecting by `hostId`, screenshots, snapshots, find/get/is, lists, wait, bridge performance diagnostics |
| `input` | UI mutations and other input-scoped `remote_desktop_*` tools. In bridge mode, this also covers debugging changes and connecting by a nine-digit remote ID. |
| `terminal` | Bridge `terminal_*`, a launch through a shell or script host, or a bridge launch with `args` |

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

- **Bridge window required.** Bridge `remote_connect` must keep `video:true` and
  `showWindow:true`; `false` answers `WINDOW_REQUIRED`. Headless work is not
  available through the bridge. The remote window opens on the bridge PC. If
  the user is away from the bridge PC, say that someone there
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
- **Bridge reconnect after a network change.** Each bridge has one active remote
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
| `BRIDGE_OFFLINE` | Selected direct host or required bridge unavailable | Check the affected computer's readiness |
| `BRIDGE_AMBIGUOUS` | Several unpinned bridge PCs | See the bridge PC gate |
| `WINDOW_REQUIRED` | Bridge connect omitted its visible window | Reconnect with the window |
| `MCP_ARGUMENT_NOT_ALLOWED` | Denied argument | Remove it; return data inline |
| `MCP_HOST_NOT_ALLOWED` | Computer outside the grant | Ask the user |
| `MCP_SESSION_NOT_OWNED` | Session ended or the grant cannot use it. Bridge sessions can also fail after a network change. | Check the session and its selected mode before an authorized reconnect |
| `already_connected` | The selected bridge already has a session | Have the owner resolve a session you did not open |
| `BRIDGE_REJECTED` / `TOOL_DISABLED` | Gateway or host policy refused the operation | Report the reason and respect the target owner's settings |
| `BRIDGE_TIMEOUT` / `REGION_UNAVAILABLE` | No answer in time | Observe before any retry |
| `RATE_LIMITED` / `QUOTA_EXHAUSTED` / `MCP_BUSY` / `MCP_SPEND_CAP` | Limits | Wait or stop as described above |

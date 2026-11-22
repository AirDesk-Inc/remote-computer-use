# Online MCP

Read this before the first tool call whenever the AirDesk server is the online
gateway, not the native stdio process. Everything in [SKILL.md](../SKILL.md)
still applies; this file adds what differs online.

## How Online Mode Works

- Connect to `https://mcp.airdesk.co.kr/mcp` using stateless Streamable HTTP.
- **Direct host** (`direct_host`) is the default online mode. It sends desktop
  tool requests and results through the gateway to the selected account-owned
  AirDesk target without a separate bridge PC.
- You are in online mode when the catalog has no `local_*` tools, or the
  `initialize` instructions describe the online gateway. Do not assume a mode
  from the client name.

## Sign-in

- **OAuth** (preferred): Claude and ChatGPT connectors, Claude Code, Codex
  (`codex mcp login airdesk`), VS Code, Cursor, OpenCode and Gemini CLI open the
  AirDesk consent page. Sign in to AirDesk, complete any 2FA required for account
  sign-in, choose the scopes, expiry, allowed computers,
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
   unavailable for this grant.
3. List with `{"mode":"direct_host"}`. In `structuredContent.computers`, choose
   the exact authorized `hostId` with `online: true` and `canConnect: true`.
   When `structuredContent.nextCursor` is present, call `remote_list_computers`
   again with that value as `cursor` using the same key or grant. Continue until
   there is no `nextCursor`, including when a page has no computers.
   Use it for `remote_connect` with
   `mode: "direct_host"`. Direct discovery and connection use `hostId` rather
   than a nine-digit remote ID. Omit `video`, `showWindow`, `fps`, `codec`,
   `width` and `height`.
4. Check the connect result's `structuredContent` for `connected: true` and
   `capabilities.desktop: true`. Keep the returned `sessionId` and opening
   credential. Read
   `remote_status` with that ID after connecting. Check `connected` and
   `mode: "direct_host"`. Status without a session ID cannot identify a direct
   session. Direct
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
hosts are unavailable in direct mode. `terminal_*` works in direct mode only
when the grant has `terminal` scope and the connect result reports
`capabilities.terminal: true`, which requires the target's Remote Terminal
setting ON with its current terms accepted. Otherwise do not attempt shell
work. Launching through a shell or script host stays unavailable online. A
terminal belongs to its direct session and closes with it; see
[Remote Terminal](terminal.md). Use the live
schema and the target's response to check each tool. Supported targets keep
held-key and button down/up as standalone calls owned by the session and check
each step of a direct batch individually.

An unavailable target or grant can produce `BRIDGE_OFFLINE` even for a direct
call. Check the target's AirDesk service, signed-in desktop and direct discovery.
For `MCP_SESSION_NOT_OWNED`, use the opening credential and the current session
ID. A timeout or `OUTCOME_UNKNOWN` requires a fresh observation before retry;
if the session was retired, obtain authorization before reconnecting.

### Direct App Launch

Use standalone `remote_desktop_launch` with `input` scope when the target
supports it. Supply an installed app name the target can resolve. macOS also
accepts a bundle ID. Omit paths, launch arguments, working directories, and
environment variables.

On supported hosts, the owner sets **Launch allowlist** and **Launch blocklist**
under **Direct MCP app launch**. Enter real process names separated by commas
or semicolons. macOS also accepts bundle IDs in those lists. Leave the allowlist
empty (no `*`) to permit every installed app AirDesk can resolve. A matching
blocklist entry always takes priority. The target checks the resolved app
identity and applies any block on the launch tool.

## Scopes

| Scope | Allows |
| --- | --- |
| `observe` | Discovery, status, connecting by `hostId`, screenshots, snapshots, find/get/is, lists and wait |
| `input` | UI mutations and other input-scoped `remote_desktop_*` tools.  |
| `terminal` | `terminal_*` on a direct session whose connect result reports `capabilities.terminal: true`. Shell or script-host launches stay unavailable online. |
| `files` | Send an authorized file to the temporary inbox of the connected target PC. |

`tools/list` shows the tools available to the grant. The updated online catalog
lists `remote_desktop_batch` for `observe` grants. The gateway checks the required
scope of each nested command, so an observation-only batch needs `observe` and a
batch with an input or terminal command needs the corresponding scope. If the
current gateway does not advertise batches for this grant, call the individual
tools that it lists. `MCP_SCOPE_REQUIRED` names the missing scope. Tell the user
which scope the task needs and let them reauthorize or create a new key. Never
reach the same effect through a lower-scope tool, for example by typing commands
into a GUI terminal with `input` only.

## Send a File to the Target PC

Verify that `tools/list` includes `remote_file_receive` and that
`remote_connect` returns `structuredContent.capabilities.files: true` before
uploading. The account owner must select **File transfer** (`files`) when
issuing an API key or approving OAuth. Use it only for files the user has
authorized you to send to the selected target. The agent needs access to the
file bytes and an HTTPS client that uses the session's opening grant and network.
If either is unavailable, explain the limitation.

1. Open the approved direct session and keep its `sessionId`. Free supports
   **3 MiB** per file. Pro, Teams and Enterprise support **30 MiB** per file.
   Measure the original bytes before encoding.
2. Send `POST https://mcp.airdesk.co.kr/mcp/files` with
   `Authorization: Bearer <credential>` and `Content-Type: application/json`.
   For a nonempty file up to 3 MiB, send `{ sessionId, filename, sha256, data }`.
   Use a basename for `filename`, the lowercase hexadecimal SHA-256 of the
   full file for `sha256`, and standard Base64 of the bytes for `data`.
3. For a file over 3 MiB on a supported plan, send the same fields for each
   part in order, adding `totalBytes` for the full size and a zero-based
   `index`. Each part carries 3 MiB of raw bytes except the last. Encode each
   part separately and keep the same full-file `sha256`. Start without a
   `fileId` and include the returned `fileId` in each subsequent request.
4. When the upload returns `201` and `receivedParts` equals `totalParts`,
   call `remote_file_receive` with `{ sessionId, fileId }` as a standalone
   tool. Check its `structuredContent.path` before using that target path
   in a file picker, for example when attaching an image to a blog post.

AirDesk keeps file bytes in private S3 and delivers them to the target over
authenticated HTTPS. The host verifies the assembled file and saves it in a
private temporary folder. S3 objects and the local copy are each eligible for
automatic cleanup 24 hours after creation. If AirDesk is stopped when the
local file expires, it cleans up on the next start.

For an upload `413`, check the plan limit and part size. For `401` or `403`,
check the credential, `files` scope and session access. For `409`, check the
target's capability, the active session and the part sequence. Honor
`Retry-After` on `429`. If receiving times out, inspect the target before
retrying to avoid creating a second copy.

## Online Restrictions

- **Forced shortcuts.** `force:true` on `remote_desktop_press` or
  `remote_desktop_key_down` returns `BRIDGE_REJECTED` in online mode. The same
  rule applies to calls inside `remote_desktop_batch` and to `terminal` grants.

- **Denied arguments.** The updated online tool schemas omit `output_path`,
  `out`, `image`, `file_url`, `pointer_image`, `cwd`, `env` and `cdp`.
  The gateway continues to reject these arguments for every scope, including
  inside a batch (`MCP_ARGUMENT_NOT_ALLOWED`). Use the dedicated [file transfer
  workflow](#send-a-file-to-the-target-pc) to deliver an authorized file.
- Use the exact allowed account-owned host ID from discovery. The opening grant owns the direct session.

## Time, Size and Cost

- Each call has about 55 seconds. `BRIDGE_TIMEOUT` and `REGION_UNAVAILABLE` do
  not prove that nothing happened: observe before repeating any mutation.
- A direct session closes after about 15 minutes without a call, together with
  anything it owns, including its terminals and commands still running in them. For long work, keep calls spaced within that window. If the
  session closed, `MCP_SESSION_NOT_OWNED` follows: connect again and observe the
  target before repeating any mutation.
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
| `MCP_DIRECT_UNAVAILABLE` | Direct mode is unavailable for this grant | Explain and stop. |
| `BRIDGE_OFFLINE` | Target unavailable | Check the target readiness |
| `MCP_ARGUMENT_NOT_ALLOWED` | Denied argument | Remove it; return data inline |
| `MCP_HOST_NOT_ALLOWED` | Computer outside the grant | Ask the user |
| `MCP_SESSION_NOT_OWNED` | Session ended or grant cannot use it | Check the session and target |
| `already_connected` | Target already has a session | Have the owner resolve it |
| `BRIDGE_REJECTED` / `TOOL_DISABLED` | Gateway or host policy refused the operation | Report the reason and respect the target owner's settings |
| `BRIDGE_TIMEOUT` / `REGION_UNAVAILABLE` | No answer in time | Observe before any retry |
| `RATE_LIMITED` / `QUOTA_EXHAUSTED` / `MCP_BUSY` / `MCP_SPEND_CAP` | Limits | Wait or stop as described above |

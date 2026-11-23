# Publishing to the MCP Registry

[`server.json`](../server.json) describes AirDesk's hosted remote desktop MCP
endpoint for the official [MCP Registry](https://registry.modelcontextprotocol.io).
It is a remote-only entry: the npm package in this repository is an installer for
the skill and the native server, not a stdio MCP server, so it is not listed under
`packages`.

## Before publishing

- `https://mcp.airdesk.co.kr/mcp` is publicly reachable and serves `tools/list`
  with titles and annotations.
- OAuth discovery (`/.well-known/oauth-protected-resource`) works from a real
  client.
- `https://airdesk.co.kr/en/mcp` is deployed (it is the `websiteUrl`).
- Bump `version` in `server.json` for every published metadata change; the
  Registry rejects republishing an existing version.

## Publish

The `io.github.AirDesk-Inc/*` namespace requires GitHub authentication by an
**owner** of the `AirDesk-Inc` organization.

```sh
# Install mcp-publisher from https://github.com/modelcontextprotocol/registry/releases
mcp-publisher login github
mcp-publisher publish
```

Verify the entry:

```sh
curl "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.AirDesk-Inc/remote-computer-use"
```

A domain namespace such as `kr.co.airdesk/remote-desktop` is also possible with
`mcp-publisher login http --domain=airdesk.co.kr`, which needs a public key
served at `https://airdesk.co.kr/.well-known/mcp-registry-auth`. Do not change
namespaces after publication without a migration plan; directories key entries
by name.

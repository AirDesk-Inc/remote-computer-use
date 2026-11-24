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
- `server.json` `version` matches `package.json` (`npm run check:package`
  enforces this). The Registry rejects republishing an existing version, so
  bump both together for every release or metadata change.

## Publish

Publishing is automatic. [`publish-mcp-registry.yml`](../.github/workflows/publish-mcp-registry.yml)
runs when `server.json` changes on `main` (or by hand from the Actions tab). It
skips a version that is already listed, verifies the pinned `mcp-publisher`
release with Sigstore, and authenticates with GitHub OIDC, so no token is stored
in the repository. Bump `MCP_PUBLISHER_VERSION` deliberately.

To publish by hand instead, the `io.github.AirDesk-Inc/*` namespace requires an
**owner** of the `AirDesk-Inc` organization and a credential that can read the
organization role. The interactive `mcp-publisher login github` flow cannot, so
use a classic token with `read:org`:

```sh
# Install mcp-publisher from https://github.com/modelcontextprotocol/registry/releases
mcp-publisher login github --token "$(gh auth token)"
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

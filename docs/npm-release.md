# npm Release Guide

Package: `@airdesk/remote-computer-use`, public access. The prepared version is
whatever `package.json` declares; that source version is not evidence that an npm
publication has occurred. Publication is verified separately, and each release
needs a new unique version. Scope ownership and permission to publish to
`@airdesk` must be verified by the maintainer before a release.

## Release Gates

- Ship a compatible AirDesk app supporting `--mcp-server --mcp-setup` and the
  one-shot `--enable-mcp` option first. A source build does not mean users have
  received it. Older apps are rejected before installer writes.
- Confirm controller MCP works with current account-bound AI terms accepted
  while local incoming Remote Terminal hosting is off. Verify approved target
  access and input permissions separately. Check target Remote Terminal support,
  setting and current host terms when exercising a shell.
- Review English/Korean docs, the copied skill, and the actual npm file list.
- Keep private app source, credentials, logs and build outputs out of the package.
- Keep AirDesk logo/trademark terms separate from the MIT software license.
- Preserve verified per-file hashes of official previous skill releases in
  `lib/skill-releases.json`; verify public archive integrity before adding a
  release. Fixtures remain under `tests/fixtures/releases` and are not published.
  Test explicit upgrade, backup retention and rejection of customized files.
- Regenerate the marketplace with `npm run build:plugins` after any skill or
  overlay change; `npm run check:package` fails while it is out of date.
- After a version is published, add one `lib/skill-releases.json` entry per
  language (`en`, `ko`, `ja`), each with the per-file hashes of that language's
  installed bundle, so the next version recognizes every published copy.
  `bundledSkill(lang)` in `lib/bundle.mjs` produces exactly those files.

From a clean checkout with Node.js 22+ and Python 3.10+:

```sh
npm ci --ignore-scripts
npm test
python3 -m unittest discover -s tests -v
npm run check:package
npm pack --dry-run --json --ignore-scripts
npm publish --dry-run --access public
```

`prepublishOnly` runs the package check, including installer tests. The package
has no install/postinstall/prepare hooks. Installing dependencies does not enable
AirDesk: only an explicit `install` command performs native setup.

Test a packed archive in temporary directories with `--skip-mcp` to verify the
installed executable and self-contained skill without touching the user's MCP
configuration. Real MCP setup should also be tested with a trusted, compatible
AirDesk build and explicit user consent. Do not use live remote computers in CI.

## Publication

Actual npm publication requires separate owner authorization. After all gates
pass, the authorized maintainer can run `npm publish --access public` from this
checkout using their own npm authentication. Do not store tokens in this repo or
paste them into chat. No automated publication workflow is configured.

After publication, verify the registry version, tarball contents and command:

```sh
npx @airdesk/remote-computer-use install --dry-run
```

Keep both READMEs and the bundled setup guide current with the published package.
Keep user MCP OFF effective: never add `--enable-mcp` to the recurring native
server command.

# Third-Party Notices

## agent-desktop

- Project: agent-desktop by Vercel Labs
- Source: https://github.com/vercel-labs/agent-desktop
- Skills referenced: https://github.com/vercel-labs/agent-desktop/tree/main/skills
- Revision used: `b43ac4f6e892ef608f8851428613c4009f0e84c7` (the engine revision
  bundled by AirDesk; identical to upstream `main` when this skill was prepared)
- License: Apache License, Version 2.0 — full text in
  [licenses/agent-desktop-LICENSE.txt](licenses/agent-desktop-LICENSE.txt)

This skill drives the agent-desktop engine that AirDesk bundles on the remote
host, through AirDesk's `remote_desktop_*` MCP tools. The following files contain
material adapted from the upstream `skills/agent-desktop`,
`skills/agent-desktop-windows` and `skills/agent-desktop-macos` guides:

| File | Upstream source | Changes |
| --- | --- | --- |
| `references/agent-desktop.md` | `skills/agent-desktop/SKILL.md` and its `references/` | Summarized the observe-act-verify loop, refs and delivery/retry rules; translated CLI syntax to AirDesk MCP arguments; added AirDesk integration, headed-mode, permission and cleanup rules. |
| `references/platform-windows.md` | `skills/agent-desktop-windows/SKILL.md` and its `references/` | Summarized the capability table and first-contact rules for MCP; added AirDesk field notes. |
| `references/platform-macos.md` | `skills/agent-desktop-macos/SKILL.md` and its `references/` | Summarized requirements and macOS differences for MCP; added AirDesk-specific tools and field notes. |

These files were modified by AirDesk-Inc. The upstream guides themselves are not
redistributed here; the skill reads them from the target's engine with
`remote_desktop_skills_get`. AirDesk is not affiliated with or endorsed by
Vercel. "Vercel" and "agent-desktop" are used only to identify the source.

The rest of this skill is AirDesk-Inc original work under the MIT License in
[LICENSE.txt](LICENSE.txt); AirDesk logos are excluded (see
[assets/NOTICE.md](assets/NOTICE.md)).

# Windows and macOS Desktop Automation

All screen, app, window and accessibility operations use the target's bundled
agent-desktop through AirDesk's `remote_desktop_*` tools. Follow
[agent-desktop.md](agent-desktop.md), its discovery steps and the target platform guide.

Discover windows with `remote_desktop_list_windows`; use its exact `window_id`.
Read `remote_desktop_snapshot` and act using qualified refs from that snapshot.
Rediscover after reconnecting. Follow engine coordinate and permission results.
The former AirDesk UIA/Accessibility tool family is removed, without aliases.

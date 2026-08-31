# Changelog

## 1.1.0

> Pi 0.84.4: transcript overlap during TUI mode switches and narrow-pane width failures are resolved by mode-specific reserved layouts.

- Removed the persistent overlay implementation.
- Added reserved-width rendering for regular TUI mode.
- Added native `HStack` layout integration for fullscreen TUI mode.
- Added responsive collapse below 123 terminal columns.
- Added ANSI-safe truncation and width assertions for every sidebar row.
- Preserved the session-path copy interaction from the existing working tree.
- Split the extension into focused source modules, each below 400 lines.
- Added unit tests and real pseudo-terminal smoke tests at wide and narrow sizes.

# Changelog

## 1.1.1

> First release published from GitHub Actions with npm trusted publishing (OIDC); no tokens involved.


## 1.1.0

> Pi 0.84.4: transcript overlap during TUI mode switches and narrow-pane width failures are resolved by mode-specific reserved layouts.

- Changed development installation to a directory symlink with `index.ts`, so relative `src/` imports resolve through Pi's global extension auto-discovery.
- Added a real auto-discovery load test for the installed extension shape.
- Removed the persistent overlay implementation.
- Added reserved-width rendering for regular TUI mode.
- Added native `HStack` layout integration for fullscreen TUI mode.
- Added responsive collapse below 123 terminal columns.
- Added ANSI-safe truncation and width assertions for every sidebar row.
- Preserved the session-path copy interaction from the existing working tree.
- Split the extension into focused source modules, each below 400 lines.
- Added unit tests and real pseudo-terminal smoke tests at wide and narrow sizes.

# Changelog

## 1.2.0

> Live goal tracking and cmux session context in the status dock.

- Added a goal card to the status dock: when pi-codex-goal is active, the dock shows the objective (two wrapped lines), status glyph, token budget progress, and elapsed time, kept current across goal set/usage/clear entries.
- Added cmux awareness: inside cmux, the `sess` row shows the workspace title (or ref) and surface ref instead of the session file datetime; outside cmux the previous format is kept.
- Memoized session usage aggregation and goal reconstruction so dock refreshes stay O(1) for unchanged sessions.
- Added refresh triggers for `agent_settled` so goal continuation updates surface without a turn boundary.
- Aligned the header rule with the panel width.

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

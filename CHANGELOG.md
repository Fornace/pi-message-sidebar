# Changelog

## 1.6.0

> Readability pass driven by a live populated PTY audit: less cropping, more signal per row.

- Collapsed message previews now use up to two wrapped lines instead of one clipped line.
- Single header row: `Messages 5/5 · #5 01:26` replaces the two-row header.
- Goal recap shows the objective on its own line(s) again, with a second line when dock space allows.
- cmux row drops the label and leads with the surface ref (`surface:38 · title`), so operational identity never truncates away.
- Status dock is priority-ordered (identity, goal status, objective, runtime, hint) and degrades to goal-status-only before dropping the goal.
- Dock budget raised to five rows at normal heights; tiny-height behavior unchanged.


## 1.5.0

- Replaced selected/newest pinning with a row-aware contiguous chronological viewport.
- Top-aligned short histories and preserved selection, expansion, viewport anchor, and follow-tail state by message ID.
- Reduced the header to two compact rows and the normal status dock to at most four rows.
- Removed collapsed-row ordinal and timestamp columns; metadata now appears only on expanded rows.
- Preserved complete cmux surface refs by truncating workspace titles first.
- Corrected tiny-height allocation so a message remains visible whenever one row is available.
- Matched the nested pi-codex-goal usage schema, tightened goal status/value validation, refreshed live context independently of entry totals, and isolated usage caches per context.
- Clarified that fullscreen is persistent while regular mode is a current-screen compositor under terminal-owned scrollback.

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

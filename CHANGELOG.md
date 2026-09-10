# Changelog

## 1.7.0

> Goal-first rail with model-written message titles. Replaces the bottom status dock with stacked sections.

- Message rows now show a short generated title instead of the raw prompt: `TitleService` calls `fornace-flash` through the Fornace gateway, caches per session on disk, and falls back to a deterministic first-words title when the gateway is unavailable or unconfigured. Titles never generate on the render path.
- Rail is now GOAL / SESSION / MESSAGES / runtime, top to bottom, replacing the bottom status dock.
- Fixed the crash on any populated render: the extension never passed `getTitle`, so `SidebarComponent.renderMessageRow` threw `TypeError: this.options.getTitle is not a function` and took the TUI down.
- Rail rows paint all 42 columns; they previously painted 40 and left a two-column seam down the rail.
- Row allocation reserves every section's mandatory rows before distributing optional ones, so the message row, the `/goal` guidance line, and the branch · session row can no longer be silently sliced away. Below the mandatory budget the rail shows a bounded resize notice instead of clipped sections.
- A slot narrower than 42 columns renders the width-bounded notice rather than overflowing its column.
- Non-home working directories keep their identity: `/private/tmp/x` no longer collapses to `x`, and long paths ellipsize from the front.
- Escape while the rail is focused closes an open message detail first and only unfocuses on the second press.

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

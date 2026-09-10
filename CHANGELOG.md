# Changelog

## 1.11.0

> Plain-text summaries and an honest copy key: what you copy from the rail is finally clean.

- Stored summaries and fallback previews no longer contain ANSI resets: pi-tui's `truncateToWidth` wraps its ellipsis in `\x1b[0m` resets, and that helper was applied to plain text, so every clipped summary persisted and rendered with escape bytes (visible as garbage when copied, and resetting rail row colors mid-row). Both paths now strip ANSI after truncation; existing polluted summary caches self-heal on next session load.
- The focused rail's `c` key now copies the selected prompt's full text, matching the `[c] copy` hint. Previously `c` always copied the session file path even while the messages panel was focused and its hint advertised message copy. The unfocused rail keeps `c` as copy-session-path.

## 1.10.0

> Embedded section headers, usage meters, and a tighter rail: every section now spends one row where it used to spend two.

- Section headers embed their label in the rule itself (`── SESSION ───────── main`) with right-aligned metadata: branch for SESSION, status for GOAL, position for MESSAGES, thinking level for RUNTIME, count for FILES. The old label-row-plus-separator pairs are gone; the minimum rail shrinks from 17 to 14 rows and the message viewport grows by three.
- Usage meters in the same language as the rules: `━━━━──────`. The goal budget row draws its meter with counts and elapsed time (compacting when crowded, drawing nothing for unlimited budgets), and the runtime context row meters context pressure with color thresholds: accent normally, warning at 60 percent, danger at 85. Goal states override: complete reads green, budget-limited or over-budget reads danger.
- A missing goal is now a single quiet rule row (`── no goal · /goal <objective> ──`) instead of a three-row block.
- Hint strips use bracketed keys: `[Ctrl+Shift+H] focus`, `[↑↓] select  [↵] open  [c] copy`, `[Esc] back  [↑↓] scroll`.
- Budget allocation between sections is content-first: the session id row, then FILES rows, then goal breathing, then runtime breath, with everything else to the message viewport.

## 1.9.0

> Theme-harmonized rail: universal content colors, a three-step background ladder, git-style file badges, age fade, and pi-recap motion.

- Colors now resolve from the active pi theme (accent, muted, dim, warning, diff and border tokens, `selectedBg` for the selection) with theme-agnostic universal grays for content text, the way pi-recap keeps recap bodies readable under any theme. The old hardcoded 256-color slabs are gone: backgrounds are a three-step ladder (base, raised for goal and detail, sunken for the hint strip) instead of contrasting blocks.
- Fixed a real leak: bare `\x1b[0m` resets inside composed rows (from pi-tui's truncation ellipsis and segment joins) painted the terminal's default foreground mid-row. All truncation now happens on plain text before coloring, and a regression test asserts no row leaks the default foreground.
- FILES rows carry the git letter convention shared by git, VS Code, and GitHub: M modified, A added, U untracked, D deleted, R renamed, colored through theme diff/warning tokens, fed by a throttled `git status --porcelain` provider that is symlink-safe, spans all repositories edited in the session (not just the session cwd), and stays silent outside repositories.
- Empty goal state rests on the neutral base background instead of claiming the raised step; the raised ground is reserved for live objectives with active budgets.
- Message streams shorter than the viewport bottom-anchor directly above the hint strip, letting spare space collect under the heading like a terminal chat stream rather than opening a dead gap above the hint.
- Message summaries fade with age like pi-recap recaps: newest bright, recent normal, older muted, deterministic previews dimmer still.
- Motion in the pi-recap spirit, ticking at 90 ms only while something moves: a truecolor pulsing dot (sine lerp, 256-color fallback) marks messages whose summary is still in flight, and a landing summary sweeps accent then bold accent over 360 ms before settling into its age color.
- The message detail header reports the message size: `#N HH:MM` left, `1.4k chars · 12 lines` right.
- Light terminals get an inverted background ladder and content grays via COLORFGBG, matching pi-recap's detection.
- `PI_SIDEBAR_SUMMARY_MODEL` overrides the summary route; a gateway microbench (fornace-flash 739 ms TTFB vs 1.1-3.1 s for the alternates) keeps `fornace-flash` as the default.

## 1.8.0

> AI message summaries, a structured two-row message grid with hidden-count ellipsis rows, and an edited-files section.

- Messages are now AI summaries: `SummaryService` asks `fornace-flash` for one plain sentence (at most 12 words, essential names preserved) per prompt, stores up to 58 cells so a summary fills two rail rows, and keeps the deterministic preview as the placeholder until the model answers. Previews render dimmed while no model summary exists. The cache lives in `sidebar-summaries` with `PI_SUMMARIES_DIR` as its override.
- An unconfigured gateway now shows a setup hint (`AI summaries need FORNACE_LLM_API_KEY`) under the MESSAGES heading instead of staying fully silent; it never costs a message slot and never warns as a failure.
- The message list is a structured grid instead of a text blob: every message renders as a two-row slot with a selection marker, right-aligned ordinal, timestamp, and the summary wrapped across two 29-cell lines.
- When the history outgrows the viewport, faint ellipsis rows count the hidden messages (`… 11 earlier`, `… 2 later`); a message pair outranks the second ellipsis row when both cannot fit.
- New FILES section summarizes the session's write footprint between SESSION and MESSAGES: the heading counts distinct files, the rows list the most recently written ones (latest first, front-trimmed paths, repeat counts) from `edit`/`write`/`fast_write` tool calls. The section yields its space to the goal block and the message viewport on short terminals and does not render at all without edits.
- Message rendering moved into `src/messages.ts` (`MessagePanel`), which also owns the detail view; `sidebar-component.ts` returns below 400 lines, restoring the README claim.
- The message section's mandatory budget grows to four rows (heading, one two-row message, hint), so a viable rail always shows a full message slot.

## 1.7.0

> Goal-first rail with model-written message titles. Replaces the bottom status dock with stacked sections.

- Message rows now show a short generated title instead of the raw prompt: `TitleService` calls `fornace-flash` through the Fornace gateway, caches per session on disk, and falls back to a deterministic first-words title when the gateway is unavailable or unconfigured. Titles never generate on the render path. Title generation that fails while the gateway is configured reports once per session instead of silently degrading, and a replaced service is disposed on session restart.
- Each message now actually receives its one refinement pass on a later turn; the previous cadence only ever inspected the newest message, so refinement never fired in normal use.
- Rail is now GOAL / SESSION / MESSAGES / runtime, top to bottom, replacing the bottom status dock.
- Fixed the crash on any populated render: the extension never passed `getTitle`, so `SidebarComponent.renderMessageRow` threw `TypeError: this.options.getTitle is not a function` and took the TUI down.
- Rail rows paint all 42 columns; they previously painted 40 and left a two-column seam down the rail.
- Right-aligned rail elements (elapsed time, position counter) sit flush against the rail edge; they were three cells short after the geometry fix. Detail text uses the full 39-column content width.
- Row allocation reserves every section's mandatory rows before distributing optional ones, so the message row, the `/goal` guidance line, and the branch · session row can no longer be silently sliced away. Below the mandatory budget the rail shows a bounded resize notice instead of clipped sections.
- Sections fill their exact row budgets and render with no masking slices: a message vanishing under an open detail (compaction, branch switch), an empty history, and a one-row resize notice all render complete sections instead of crashing the TUI.
- The detail scroll indicator reports a truthful range like `34-46 of 46` instead of an inaccurate `…0 more lines`, and the detail hint offers scrolling (`Esc back · ↑↓ scroll`) only when content actually overflows the body, otherwise just `Esc back`.
- Message ordinals count only the messages the rail displays, so the detail header `#N` stays in agreement with the heading `N/total` after image-only or whitespace-only turns.
- A missing `FORNACE_LLM_API_KEY` is treated as an unconfigured gateway (deterministic fallback titles) rather than a generation failure, so the session no longer warns spuriously.
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

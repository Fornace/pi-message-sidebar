# pi-message-sidebar

Persistent message history sidebar for [Pi](https://pi.dev).

## Features

- Fixed 42-column panel on the right, stacked GOAL / SESSION / FILES / MESSAGES / RUNTIME
- Embedded section headers: the label rides the rule with metadata right-aligned (branch, status, position, thinking level), one row where the old design spent two
- Usage meters in the rule language: goal budget with counts and elapsed, context pressure with warning and danger thresholds
- AI message summaries (`fornace-flash` through the Fornace gateway, `PI_SIDEBAR_SUMMARY_MODEL` to override): one plain sentence per prompt, cached per session on disk, with a deterministic preview as the placeholder until the model answers; an unconfigured gateway shows a setup hint under the MESSAGES heading
- Theme-harmonized colors: semantic pi theme tokens for accents, badges, and selection, universal grays for content text, and a three-step background ladder; light terminals invert the ladder
- Age-faded summaries with pi-recap motion: a pulsing dot while a summary is in flight, an accent settle sweep when it lands
- Git-style change badges (M/A/U/D/R) on the FILES rows, from a throttled `git status` provider
- Message detail header reports the message size in chars and wrapped lines
- Structured two-row message slots: selection marker, ordinal, timestamp, and the summary wrapped across two lines
- Ellipsis rows that count the hidden messages whenever the history outgrows the viewport
- FILES section summarizing the session's edited files: distinct-file count in the heading, most recently written paths below, repeat counts included
- Contiguous chronological message viewport that top-aligns short histories and follows new messages until you browse away
- Every section's mandatory rows are reserved before optional rows are handed out; too short a terminal shows a resize notice rather than clipped sections
- cmux session context that preserves the complete surface ref by truncating the workspace title first
- Main transcript and editor render in their own reserved width
- Persistent native right rail in fullscreen TUI mode
- Compact regular-mode compositor in terminal-owned scrollback mode
- Automatic collapse when the terminal cannot keep an 80-column main pane
- `Ctrl+Shift+H` focuses the sidebar
- Arrow keys navigate messages
- `Enter` opens the full text of a message; the detail hint offers scrolling only when the message overflows its body
- `c` copies the session path
- `Escape` closes an open message, then returns focus to Pi
- Width assertions cover every rendered sidebar line

## Requirements

Pi 0.84.4 or newer. This extension uses the renderer-switching and fullscreen layout APIs shipped with the 0.84 series.

AI summaries call `fornace-flash` through the Fornace gateway and need `FORNACE_LLM_API_KEY` (and optionally `FORNACE_LLM_BASE_URL`) in the environment. Without the key the sidebar keeps deterministic previews and shows its setup hint; nothing warns or fails.

## Installation

### Development symlink

```bash
git clone git@github.com:Fornace/pi-message-sidebar.git ~/repos/pi-message-sidebar
ln -s ~/repos/pi-message-sidebar ~/.pi/agent/extensions/message-sidebar
```

### Pi package

```bash
pi install npm:pi-message-sidebar
# or from git
pi install git:github.com/Fornace/pi-message-sidebar
```

## Usage

The sidebar appears automatically in interactive mode when the terminal is at least 123 columns wide. It collapses below that breakpoint so Pi keeps a usable main pane. Fullscreen mode uses a persistent `HStack` right rail. Regular mode uses a compact compositor over the terminal's current screenful; because the terminal owns regular-mode scrollback, the sidebar is not permanently sticky while browsing old scrollback. An on-demand overlay is intentionally not implemented: overlay components are disposed on close, which conflicts with the persistent ID-stable sidebar state, so the compact compositor is kept instead.

The message body is one contiguous chronological viewport. New messages remain selected while follow-tail is active. Navigating away preserves the selected message, expansion state, and visible range by message ID when history entries are inserted or refreshed.

- Press `Ctrl+Shift+H` to focus or unfocus the sidebar.
- Press `↑` or `↓` to navigate.
- Press `PageUp`, `PageDown`, `Home`, or `End` for larger jumps.
- Press `Enter` to open the selected message's full text; scroll with `↑`/`↓` when the hint offers it.
- Press `c` to copy the current session path.
- Press `Escape` to close an open message, and again to return focus to Pi.

## Architecture

- `index.ts` is the auto-discovered extension entrypoint.
- `src/layout.ts` reserves a persistent horizontal region in fullscreen mode and composes the current screenful in regular mode.
- `src/sidebar-component.ts` owns section budgets, the render cache, and focus handling.
- `src/messages.ts` renders the message grid and detail view, and owns ID-stable navigation and follow-tail behavior.
- `src/sections.ts` renders the embedded section headers, the goal, session, files, and runtime sections into fixed row budgets.
- `src/summaries.ts` generates and caches one-line AI summaries off the render path.
- `src/files.ts` collects the session's edited files from write tool calls.
- `src/git-status.ts` maps the worktree status onto the shared M/A/U/D/R letter convention.
- `src/palette.ts` resolves theme tokens, universal content grays, and the background ladder per render.
- `src/anim.ts` owns the pulse and settle timing; the tick runs only while something moves.
- `src/status-dock.ts` supplies context-usage and status validation helpers.
- `src/goal.ts` reconstructs the active pi-codex-goal from session entries.
- `src/cmux.ts` resolves the cmux workspace title and surface ref once per session.
- `src/style.ts` provides ANSI-safe row filling and width helpers.
- `src/constants.ts` owns responsive layout thresholds.

Every source file stays below 400 lines.

## License

MIT

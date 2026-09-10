# pi-message-sidebar

Persistent message history sidebar for [Pi](https://pi.dev).

## Features

- Fixed 42-column panel on the right, stacked GOAL / SESSION / MESSAGES / runtime
- Model-written message titles (`fornace-flash` through the Fornace gateway), cached per session, with a deterministic fallback when the gateway is unconfigured or unreachable
- Single message heading carrying the selected position and total
- Contiguous chronological message viewport that top-aligns short histories and follows new messages until you browse away
- Every section's mandatory rows are reserved before optional rows are handed out; too short a terminal shows a resize notice rather than clipped sections
- cmux session context that preserves the complete surface ref by truncating the workspace title first
- Main transcript and editor render in their own reserved width
- Persistent native right rail in fullscreen TUI mode
- Compact regular-mode compositor in terminal-owned scrollback mode
- Automatic collapse when the terminal cannot keep an 80-column main pane
- `Ctrl+Shift+H` focuses the sidebar
- Arrow keys navigate messages
- `Enter` opens the full text of a message
- `c` copies the session path
- `Escape` closes an open message, then returns focus to Pi
- Width assertions cover every rendered sidebar line

## Requirements

Pi 0.84.4 or newer. This extension uses the renderer-switching and fullscreen layout APIs shipped with the 0.84 series.

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
- Press `Enter` to expand or collapse the selected message.
- Press `c` to copy the current session path.
- Press `Escape` to close an open message, and again to return focus to Pi.

## Architecture

- `index.ts` is the auto-discovered extension entrypoint.
- `src/layout.ts` reserves a persistent horizontal region in fullscreen mode and composes the current screenful in regular mode.
- `src/sidebar-component.ts` owns ID-stable navigation, expansion, follow-tail behavior, and the row-aware contiguous viewport.
- `src/sections.ts` renders the goal, session, and runtime sections into fixed row budgets.
- `src/titles.ts` generates and caches short message titles off the render path.
- `src/status-dock.ts` supplies context-usage and status validation helpers.
- `src/goal.ts` reconstructs the active pi-codex-goal from session entries.
- `src/cmux.ts` resolves the cmux workspace title and surface ref once per session.
- `src/style.ts` provides ANSI-safe row filling and width helpers.
- `src/constants.ts` owns responsive layout thresholds.

Every source file stays below 400 lines.

## License

MIT

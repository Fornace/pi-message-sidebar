# pi-message-sidebar

Persistent message history sidebar for [Pi](https://pi.dev).

## Features

- The obsidian rail: a 42-column truecolor ladder with a deep well as canvas, a raised panel step for the goal card, accent-tinted selection, and two ghost tiers for chrome; 256-color and light-terminal variants included
- The Fornace flag crowns the rail: the seven brand hues from the production logo, painted solid edge to edge, with a sheen band while the rail is live
- Goal card as the hero: breathing status dot, budget share, bold objective across up to three lines, and a `bdg`-labeled meter in eighths-of-a-cell resolution that eases toward the live ratio
- Ghost chrome: section labels sit flush left in a near-invisible tier with right-aligned metadata and an air row above; no rules, no dashes
- Structured two-row message slots without ordinals: time, then the summary across 32-cell lines; selection is a two-row yellow bar on a soft accent tint
- Motion language that idles for free: pulsing pending dots, landing sweeps, decaying arrival glows, left-to-right reveals, eased meters with a riding shimmer, and a victory flash when a goal completes
- AI message summaries (`fornace-flash` through the Fornace gateway, `PI_SIDEBAR_SUMMARY_MODEL` to override): one plain sentence per prompt, cached per session on disk, with a deterministic preview until the model answers; an unconfigured gateway shows a setup hint
- Age-faded summaries like pi-recap: newest bright, recent normal, older muted, previews dimmer still
- Git-style change badges (M/A/U/D/R) on the FILES rows, from a throttled `git status` provider
- Message detail view with size in chars and wrapped lines, scrollable when the text overflows
- Ellipsis rows counting hidden messages whenever the history outgrows the viewport
- Contiguous chronological viewport that bottom-anchors the stream and follows new messages until you browse away
- Mandatory rows reserved before optional rows are handed out; too short a terminal shows a resize notice rather than clipped sections
- cmux session context that preserves the complete surface ref by truncating the workspace title first

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
- Press `c` to copy the selected prompt while the rail is focused, or the session path when it is not.
- Press `Escape` to close an open message, and again to return focus to Pi.

## Architecture

- `index.ts` is the auto-discovered extension entrypoint.
- `src/layout.ts` reserves a persistent horizontal region in fullscreen mode and composes the current screenful in regular mode.
- `src/sidebar-component.ts` owns section budgets, the render cache, and focus handling.
- `src/messages.ts` renders the message grid and detail view, and owns ID-stable navigation and follow-tail behavior.
- `src/goal-card.ts` renders the goal card; `src/sections.ts` renders ghost headers plus the session, files, and runtime sections into fixed row budgets.
- `src/slots.ts` renders message slots; `src/flag.ts` paints the Fornace crown; `src/palette.ts` and `src/anim.ts` own the color ladder and the motion timing.
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

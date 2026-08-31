# pi-message-sidebar

Persistent message history sidebar for [Pi](https://pi.dev).

## Features

- Fixed 42-column panel on the right
- Main transcript and editor render in their own reserved width
- Native side-by-side layout in fullscreen TUI mode
- Regular-mode compositor that reserves the same width in scrollback mode
- Automatic collapse when the terminal cannot keep an 80-column main pane
- First and last five user messages remain visible
- Gap indicator shows hidden message counts
- `Ctrl+Shift+H` focuses the sidebar
- Arrow keys navigate messages
- `Enter` expands or collapses a message
- `c` copies the session path
- `Escape` returns focus to Pi
- Width assertions cover every rendered sidebar line

## Requirements

Pi 0.84.4 or newer. This extension uses the renderer-switching and fullscreen layout APIs shipped with the 0.84 series.

## Installation

### Development symlink

```bash
git clone git@github.com:Fornace/pi-message-sidebar.git ~/repos/pi-message-sidebar
ln -sf ~/repos/pi-message-sidebar/message-sidebar.ts ~/.pi/agent/extensions/message-sidebar.ts
```

### Pi package

```bash
pi install git:github.com/Fornace/pi-message-sidebar
```

## Usage

The sidebar appears automatically in interactive mode when the terminal is at least 123 columns wide. It collapses below that breakpoint so Pi keeps a usable main pane.

- Press `Ctrl+Shift+H` to focus or unfocus the sidebar.
- Press `↑` or `↓` to navigate.
- Press `PageUp`, `PageDown`, `Home`, or `End` for larger jumps.
- Press `Enter` to expand or collapse the selected message.
- Press `c` to copy the current session path.
- Press `Escape` to return focus to Pi.

## Architecture

- `message-sidebar.ts` registers lifecycle hooks, commands, and shortcuts.
- `src/layout.ts` reserves a real horizontal region in fullscreen mode and composes an equivalent region in regular mode.
- `src/sidebar-component.ts` owns message navigation and bounded rendering.
- `src/status-dock.ts` renders session, model, context, cost, and extension status data.
- `src/style.ts` provides ANSI-safe row filling and width helpers.
- `src/constants.ts` owns responsive layout thresholds.

Every source file stays below 400 lines.

## License

MIT

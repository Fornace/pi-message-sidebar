# pi-message-sidebar

Persistent message history sidebar for [Pi coding agent](https://pi.dev).

## Features

- **Always-visible sidebar** (40 columns, ~300px) on the right side
- **Dark grey background** — minimal visual distraction
- **First 5 and last 5 messages** always pinned at top/bottom
- **Gap indicator** shows count of hidden messages in between
- **Ctrl+Shift+H** focuses the sidebar for navigation
- **Arrow keys** navigate through all messages when focused
- **Enter** toggles expand/collapse of selected message
- **Escape** returns to passive mode (sidebar stays visible)
- **Zero CPU/GPU cost** — no timers, cached rendering, pure ANSI colors

## Installation

### Option 1: Symlink (recommended for development)

```bash
# Clone this repo
git clone git@github.com:Fornace/pi-message-sidebar.git ~/repos/pi-message-sidebar

# Symlink to pi extensions
ln -sf ~/repos/pi-message-sidebar/message-sidebar.ts ~/.pi/agent/extensions/message-sidebar.ts
```

### Option 2: Install as pi package

```bash
pi install git:github.com/Fornace/pi-message-sidebar
```

## Usage

The sidebar appears automatically when you start pi in interactive mode.

- **Passive mode**: Sidebar shows first/last messages, no interaction
- **Focused mode**: Press `Ctrl+Shift+H` to navigate and expand messages
- **Expand/collapse**: Press `Enter` on a selected message to see full text
- **Exit focus**: Press `Escape` to return to passive mode

## Configuration

Edit constants in `message-sidebar.ts`:

```typescript
const SIDEBAR_WIDTH = 40;      // columns
const PINNED_COUNT = 5;        // first/last N messages always visible
const GAP_WINDOW = 3;          // lines shown around selection in gap
```

## Architecture

- **Overlay system**: Uses pi's non-capturing overlay API
- **Persistent**: Sidebar stays open across the entire session
- **Event-driven**: No timers or intervals, only redraws on state changes
- **Cached rendering**: Version-tracked cache prevents redundant renders
- **ANSI 256-color**: Uses terminal color palette (no GPU compositing)

## License

MIT

# Redesign implementation notes

Implements the Astra adjudication for the 1.4.0 partial state-management repair.

## Viewport (priority 1)

- `renderBody` now renders one contiguous chronological range. The `padTop` blank-space and
  selected/newest pinned-subset heuristics are gone.
- Follow-tail keeps the newest message selected and computes a tail-anchored start.
- Browsing away keeps the viewport anchored on `viewportStartId`, preserved by message ID across
  `updateMessages` refreshes. The newest row only appears when it is inside the contiguous range.
- Short histories top-align; padding goes below the content only.
- At tiny heights the message body gets one reserved row before the dock/header chrome, so a
  message is visible even at 1-5 terminal rows.

## Header and dock (priority 2)

- Two-row header: `Messages <sel>/<count>` plus a selected-message metadata row
  (`Selected #12 14:03`). Metadata lives on the header/expanded rows only; collapsed rows spend
  the full width on message text.
- Dock is at most four rows: cmux context (surface ref preserved by truncating the workspace
  title first), goal (max two rows: status + budget/time, then objective), runtime
  (model + thinking + live context percent), validated extension status, and the action hint,
  which is always the last row. No duplicate focus hints between header and dock.
- `PINNED_COUNT` and `GAP_WINDOW` constants removed.

## Data defects

- `readThreadGoal` now mirrors the pi-codex-goal nested schema: usage stays nested in
  `goal.usage` for set entries and is applied from `data.usage` for runtime usage entries.
- Status and numeric validation tightened (finite, non-negative, non-empty objective/goalId).
- `computeUsage` only caches the persisted entry aggregation; live `getContextUsage` values are
  sampled every render, so context percent is never stale when entries are unchanged.
- Usage caches are `WeakMap` per `ExtensionContext`, removing the cross-context single-slot cache.
- `validExtensionStatuses` validates map entries (string keys and values, non-empty after
  sanitize) and returns a sorted list of texts.

## Regular mode decision

No overlay. The compact compositor is kept and documented: overlays dispose their component on
close, which conflicts with the persistent ID-stable sidebar state. The README states regular
mode is not permanently sticky because the terminal owns scrollback.

## Verification

- `npm run typecheck`, `npm test` (26 tests), `npm run test:load`: pass.
- `npm run test:pty` (regular/fullscreen at 142 and 121 cols) and `test:pty:matrix`
  (regular/fullscreen at 80x24, 120x40, 148x55, 200x60): pass.
- Populated throwaway PTY session (36 user messages) in both modes: newest message rendered,
  up-arrow navigation selected `#35`, Enter expanded it, Escape released focus. PTY script now
  asserts `SIDEBAR_EXPECT_MESSAGE` and `SIDEBAR_EXPECT_SELECTION`.
- Fullscreen HStack layout bridge untouched; `graphify update .` run after the changes.

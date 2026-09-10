# Handoff — pi-message-sidebar, after the 1.7.0 hardening series

Written 2026-09-10. Repo `/Users/ffrappo/repos/pi-message-sidebar`, HEAD `451bc18`,
tree clean, **9 commits unpushed**. The original 1.7.0 repair handoff (an audit
listing eight defect groups; the file has since been deleted from `_tmp/`) is
fully discharged — every group is fixed and covered by tests, and the commit
messages in `b86668e..451bc18` record which change closed what. This document
is for what comes next.

## Start here

```bash
cd /Users/ffrappo/repos/pi-message-sidebar
git log --oneline -9          # b86668e..451bc18 is this series
npm run typecheck && npm test # must be clean / 39 pass
```

`~/.pi/agent/extensions/message-sidebar` is a **symlink to this repo**, so pi
loads the working tree directly. There is no install step: editing a file
changes the next pi launch. That also means a broken edit breaks your own pi.

This package **publishes to npm** (`docs/PUBLISH.md`, GitHub Actions + OIDC on
tag push). Defects here reach people who are not Francesco — that is why the
"unconfigured gateway" fix below matters more than it looks.

## State

39 tests: `goal` 9, `sidebar` 14, `titles` 5, `messages` 4, `status-dock` 4,
`layout` 3. Gates all green at `451bc18`:

| Gate | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | clean |
| Unit | `npm test` | 39/39 |
| Entry point | `npm run test:load` | loads |
| PTY | `npm run test:pty` | 4/4 |
| PTY matrix | `npm run test:pty:matrix` | 8/8 |
| Fuzz | `node --import tsx _tmp/fuzz.mts` | 36000 renders, 0 violations |

`_tmp/fuzz.mts` is gitignored but **keep it**. It renders the component across
adversarial text, titles, widths and heights and asserts three invariants:
exact height, no overflow, and exact 42-column fill. It found three latent
crashes that the unit tests missed. Re-run it after any layout change.

Live gate (the one that actually proves it):

```bash
SESS=$(ls -t ~/.pi/agent/sessions/--Users-ffrappo-works-repos-mantice--/*.jsonl | head -1)
tmux new-session -d -s gate -x 142 -y 55 -c "$PWD" \
  "/opt/homebrew/bin/pi --session $SESS --tui-mode regular"
sleep 12 && tmux capture-pane -p -t gate
```

Read the captured text directly. **Single-quote capture strings** — a `$0.00`
cost in a double-quoted shell string expands to `/bin/bash.00` and reads as a
formatting bug that is not there. That false positive already happened once.

## The invariant that matters

Every rail row is exactly `SIDEBAR_WIDTH` (42) cells: `│` + pad + 39 content +
pad. Every section returns exactly its row budget. There are **no masking
slices left** — `render()` throws on a height mismatch, and that throw happens
inside pi's render loop and kills the TUI. That is the same failure mode as the
original `getTitle` crash.

So: if you make a section return the wrong number of rows, you do not get a
cosmetic bug, you get a dead terminal. The fuzzer catches this in seconds.
Budgets live in `MANDATORY` / `allocate()` in `src/sidebar-component.ts`.

## Open items

Nothing is broken. These are decisions and known rough edges, roughly by value.

**1. Push or not.** Nine commits are local. Francesco reviews first — that was
the standing instruction, not an invention. Nothing is tagged or published.

**2. `src/sidebar-component.ts` is 429 lines; `README.md:71` claims "Every
source file stays below 400 lines."** One of the two has to give. The clean
split is to extract the message list and detail view — `renderMessages`,
`renderViewport`, `renderMessageRow`, `renderDetail`, `detailCapacity`,
`wrappedDetail` — into `src/messages.ts`, matching how `src/sections.ts`
already holds goal/session/runtime. That lands the file near 250 lines. The
alternative is to drop the claim from the README. Decide, don't leave it
false.

**3. Deliberate spec deviation: `MANDATORY.session = 3`, not 4.** The original
1.7.0 audit listed `branch · session id` as a mandatory row. I made it the *first
optional* row instead, so a 14-row terminal renders a working rail rather than
a resize notice; at any normal height the row is present. `minimumHeight()` is
16 with a goal, 14 without. Making it mandatory raises those to 17/15. The
other agent reviewed and agreed, but it is still a deviation from what
Francesco specified — flip it in `MANDATORY` if he wants the spec honoured.

**4. Only the newest 10 history messages get seeded titles** (`TitleService.seed`).
Older messages in a long restored session keep deterministic fallback titles
forever. Deliberate and documented, but if Francesco wants full history titled,
that is the knob — mind the gateway cost on a 131-message session.

**5. Every event triggers a full re-render.** `scheduleRefresh` →
`updateMessages` → `refresh()` → `version++` → new signature → the render cache
misses. Verified by reading, not measured. At 42×55 it is cheap, so this is
noted rather than a problem. If it ever matters, the fix is to skip the version
bump when the message list is unchanged — but note that title arrivals also
come through `updateMessages`, so they would need their own repaint path.

**6. Unverified suspicion: the widget factory may recreate `SidebarComponent`
on a TUI mode switch**, losing focus, selection and viewport anchor. I did not
confirm this. To check: switch `--tui-mode` at runtime with a message selected
and see whether the selection survives. `SidebarLayoutBridge` refcounts
correctly either way, so there is no leak — only state loss.

**7. Trivia.** `runningInCmux`, `SIDEBAR_GAP`, `GoalStatus`, `Usage`,
`UsageTotals` and `hasModelTitle` are exported but used only inside their own
module or by tests. `formatElapsed` mixes styles (`45s`, then `24:36`, then
`2h 05m`); the `mm:ss` band can read as `hh:mm` next to the word "elapsed".
There is no way to copy a message's text — `c` copies the session path only.

## Working alongside another agent

This nearly went badly. A second agent (pi, `mantice/fornace-max`) was editing
the same working tree at the same time; its **subagent** wrote a broken
`src/status-dock.ts` and a test that could not pass, and we overwrote each
other before noticing.

If two agents run on this repo again, **give them separate git worktrees**.
File-ownership agreements do not bind the subagents an agent spawns, which is
exactly what caused the damage here.

If you must share a tree, the protocol that worked:

```bash
cmux identify                                   # your own surface ref
CMUX_QUIET=1 cmux list-pane-surfaces --workspace workspace:7
CMUX_QUIET=1 cmux read-screen --surface surface:38 --lines 25
CMUX_QUIET=1 cmux send --surface surface:38 '[me -> you] ...'
CMUX_QUIET=1 cmux send-key --surface surface:38 Enter
```

Messages arrive as queued steering and interrupt the peer's turn. Agree a
file-level split, commit early so a clobber cannot lose work, and state the
current HEAD in every message so the other side can tell whether it is behind.

## Environment

- Titles: `fornace-flash` via `FORNACE_LLM_BASE_URL` (`https://llm.fornace.net`,
  no `/v1` — the gateway accepts both paths) and `FORNACE_LLM_API_KEY`, both
  already in the shell environment. Cache: `~/.pi/agent/tmp/sidebar-titles/`,
  one JSON per session; `PI_TITLES_DIR` overrides it and tests use a temp dir.
- A missing key is **unconfigured**, not a failure: fallback titles, no warning.
  Keep that distinction — this package ships to people without the gateway.
- Populated sessions for gates:
  `~/.pi/agent/sessions/--Users-ffrappo-works-repos-mantice--/` (131 messages).
- Scratch goes in `_tmp/` (gitignored). Durable docs in `docs/`.

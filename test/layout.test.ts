import assert from "node:assert/strict";
import test from "node:test";
import { TuiAltScreen, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
import { MIN_MAIN_WIDTH, RESERVED_WIDTH, SIDEBAR_WIDTH, isSidebarVisible } from "../src/constants.ts";
import { SidebarLayoutBridge } from "../src/layout.ts";

class FakeTerminal {
  columns: number;
  rows: number;
  constructor(columns: number, rows = 24) { this.columns = columns; this.rows = rows; }
  write(): void {}
  start(): void {}
  stop(): void {}
  onInput(): void {}
  onResize(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  setTitle(): void {}
  queryCellSize(): void {}
  setProgress(): void {}
}

function component(label: string, widthSeen: number[]) {
  return {
    render(width: number): string[] {
      widthSeen.push(width);
      return [label.repeat(Math.max(1, width))];
    },
    invalidate(): void {},
  };
}

const breakpoint = MIN_MAIN_WIDTH + RESERVED_WIDTH;

test("regular mode reserves width and keeps every line bounded", () => {
  const mainWidths: number[] = [];
  const sideWidths: number[] = [];
  const terminal = new FakeTerminal(breakpoint, 12);
  const tui = new TuiMainScreen(terminal as never);
  tui.addChild(component("m", mainWidths));
  const bridge = new SidebarLayoutBridge(tui, component("s", sideWidths));

  const lines = tui.render(breakpoint);
  assert.equal(mainWidths.at(-1), MIN_MAIN_WIDTH);
  assert.equal(sideWidths.at(-1), SIDEBAR_WIDTH);
  assert.ok(lines.every((line) => visibleWidth(line) <= breakpoint));
  assert.ok(lines.some((line) => line.includes("s".repeat(SIDEBAR_WIDTH))));
  bridge.dispose();
});

test("regular mode collapses below the responsive breakpoint", () => {
  const mainWidths: number[] = [];
  const terminal = new FakeTerminal(breakpoint - 1);
  const tui = new TuiMainScreen(terminal as never);
  tui.addChild(component("m", mainWidths));
  const bridge = new SidebarLayoutBridge(tui, component("s", []));

  tui.render(breakpoint - 1);
  assert.equal(mainWidths.at(-1), breakpoint - 1);
  assert.equal(isSidebarVisible(breakpoint - 1), false);
  bridge.dispose();
});

test("fullscreen mode installs an HStack root across renderer switches", () => {
  const terminal = new FakeTerminal(breakpoint, 20);
  const rootWidths: number[] = [];
  const sideWidths: number[] = [];
  const regular = new TuiMainScreen(terminal as never);
  const bridge = new SidebarLayoutBridge(regular, component("s", sideWidths));

  const fullscreen = new TuiAltScreen(terminal as never);
  fullscreen.setLayoutRoot(component("m", rootWidths));
  const lines = fullscreen.render(breakpoint);

  assert.equal(rootWidths.at(-1), MIN_MAIN_WIDTH);
  assert.equal(sideWidths.at(-1), SIDEBAR_WIDTH);
  assert.ok(lines.every((line) => visibleWidth(line) <= breakpoint));
  bridge.dispose();
});

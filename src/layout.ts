import type { Component, TUI, ViewportTUI } from "@earendil-works/pi-tui";
import {
  HStack,
  TuiAltScreen,
  TuiMainScreen,
  compositeTuiLine,
  isViewportTUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { MIN_MAIN_WIDTH, RESERVED_WIDTH, SIDEBAR_WIDTH, isSidebarVisible } from "./constants.ts";

const REGULAR_PATCH_KEY = Symbol.for("pi-message-sidebar.regular-layout");
const FULLSCREEN_PATCH_KEY = Symbol.for("pi-message-sidebar.fullscreen-layout");

type RegularPatchState = {
  originalRender: (this: TuiMainScreen, width: number) => string[];
  refs: number;
  sidebar: Component;
};

type FullscreenPatchState = {
  originalSetLayoutRoot: (this: ViewportTUI, root: Component | undefined) => void;
  refs: number;
  sidebar: Component;
  latestRoot?: Component;
  roots: WeakMap<object, Component>;
};

function defocusHiddenSidebar(tui: TUI, sidebar: Component, width: number): boolean {
  const visible = isSidebarVisible(width);
  if (!visible && (sidebar as any).isFocused?.()) {
    (sidebar as any).setFocused(false);
    if ((tui as any).getFocusedComponent?.() === sidebar) tui.setFocus(null);
  }
  return visible;
}

function renderRegularLayout(
  renderer: TuiMainScreen,
  state: RegularPatchState,
  width: number,
): string[] {
  if (!defocusHiddenSidebar(renderer, state.sidebar, width)) {
    return state.originalRender.call(renderer, width);
  }

  const mainWidth = width - RESERVED_WIDTH;
  const mainLines = state.originalRender.call(renderer, mainWidth);
  const terminalRows = Math.max(1, renderer.terminal.rows);
  const sidebarLines = state.sidebar.render(SIDEBAR_WIDTH).slice(0, terminalRows);
  const viewportStart = Math.max(0, mainLines.length - terminalRows);
  const rows = Math.max(mainLines.length, viewportStart + sidebarLines.length);
  const result = [...mainLines];
  while (result.length < rows) result.push("");

  for (let row = 0; row < sidebarLines.length; row++) {
    const index = viewportStart + row;
    result[index] = compositeTuiLine(
      result[index] ?? "",
      sidebarLines[row]!,
      mainWidth + RESERVED_WIDTH - SIDEBAR_WIDTH,
      SIDEBAR_WIDTH,
      width,
    );
  }
  return result;
}

function installRegularLayout(sidebar: Component): () => void {
  const prototype = TuiMainScreen.prototype as TuiMainScreen & {
    [REGULAR_PATCH_KEY]?: RegularPatchState;
  };
  const existing = prototype[REGULAR_PATCH_KEY];
  if (existing) {
    existing.refs++;
    existing.sidebar = sidebar;
    return () => uninstallRegularLayout(prototype, existing);
  }

  const originalRender = prototype.render;
  const state: RegularPatchState = { originalRender, refs: 1, sidebar };
  prototype[REGULAR_PATCH_KEY] = state;
  prototype.render = function renderWithSidebar(width: number): string[] {
    return renderRegularLayout(this, state, width);
  };
  return () => uninstallRegularLayout(prototype, state);
}

function uninstallRegularLayout(
  prototype: TuiMainScreen & { [REGULAR_PATCH_KEY]?: RegularPatchState },
  state: RegularPatchState,
): void {
  state.refs--;
  if (state.refs > 0) return;
  delete (prototype as any).render;
  delete prototype[REGULAR_PATCH_KEY];
}

function wrapFullscreenRoot(root: Component, sidebar: Component, tui: TUI): Component {
  return new HStack([
    { component: root, basis: 0, grow: 1, shrink: 1, minSize: MIN_MAIN_WIDTH },
    {
      component: sidebar,
      basis: SIDEBAR_WIDTH,
      grow: 0,
      shrink: 0,
      minSize: SIDEBAR_WIDTH,
      maxSize: SIDEBAR_WIDTH,
      visible: ({ width }) => defocusHiddenSidebar(tui, sidebar, width),
    },
  ], { gap: RESERVED_WIDTH - SIDEBAR_WIDTH });
}

function installFullscreenLayout(tui: TUI, sidebar: Component): () => void {
  const prototype = TuiAltScreen.prototype as TuiAltScreen & {
    [FULLSCREEN_PATCH_KEY]?: FullscreenPatchState;
  };
  const existing = prototype[FULLSCREEN_PATCH_KEY];
  if (existing) {
    existing.refs++;
    existing.sidebar = sidebar;
    reapplyCurrentFullscreenRoot(tui, existing);
    return () => uninstallFullscreenLayout(tui, prototype, existing);
  }

  const originalSetLayoutRoot = Object.getOwnPropertyDescriptor(TuiAltScreen.prototype, "setLayoutRoot")?.value as
    | FullscreenPatchState["originalSetLayoutRoot"]
    | undefined;
  if (!originalSetLayoutRoot) throw new Error("Pi fullscreen layout API is unavailable");
  const state: FullscreenPatchState = {
    originalSetLayoutRoot,
    refs: 1,
    sidebar,
    roots: new WeakMap(),
  };
  prototype[FULLSCREEN_PATCH_KEY] = state;
  prototype.setLayoutRoot = function setLayoutRootWithSidebar(root: Component | undefined): void {
    if (!root) {
      state.originalSetLayoutRoot.call(this, undefined);
      return;
    }
    state.latestRoot = root;
    state.roots.set(this, root);
    state.originalSetLayoutRoot.call(this, wrapFullscreenRoot(root, state.sidebar, this));
  };
  reapplyCurrentFullscreenRoot(tui, state);
  return () => uninstallFullscreenLayout(tui, prototype, state);
}

function reapplyCurrentFullscreenRoot(tui: TUI, state: FullscreenPatchState): void {
  if (!isViewportTUI(tui)) return;
  const root = state.roots.get(tui as object) ?? ((tui as any).layoutRoot as Component | undefined);
  if (root) (tui as TuiAltScreen).setLayoutRoot(root);
}

function uninstallFullscreenLayout(
  tui: TUI,
  prototype: TuiAltScreen & { [FULLSCREEN_PATCH_KEY]?: FullscreenPatchState },
  state: FullscreenPatchState,
): void {
  state.refs--;
  if (state.refs > 0) return;
  if (isViewportTUI(tui) && state.latestRoot) {
    state.originalSetLayoutRoot.call(tui, state.latestRoot);
  }
  prototype.setLayoutRoot = state.originalSetLayoutRoot;
  delete prototype[FULLSCREEN_PATCH_KEY];
}

export class SidebarLayoutBridge implements Component {
  private readonly uninstallRegular: () => void;
  private readonly uninstallFullscreen: () => void;

  constructor(private readonly tui: TUI, sidebar: Component) {
    this.uninstallRegular = installRegularLayout(sidebar);
    this.uninstallFullscreen = installFullscreenLayout(tui, sidebar);
    tui.requestRender(true);
  }

  render(): string[] { return []; }
  invalidate(): void {}
  dispose(): void {
    this.uninstallFullscreen();
    this.uninstallRegular();
    this.tui.requestRender(true);
  }
}

export function assertLinesFit(lines: readonly string[], width: number, label: string): void {
  for (const [index, line] of lines.entries()) {
    const measured = visibleWidth(line);
    if (measured > width) {
      throw new Error(`${label} line ${index} exceeds width (${measured} > ${width})`);
    }
  }
}

export const SIDEBAR_WIDTH = 42;
export const SIDEBAR_GAP = 1;
export const RESERVED_WIDTH = SIDEBAR_WIDTH + SIDEBAR_GAP;
export const MIN_MAIN_WIDTH = 80;
export const PINNED_COUNT = 5;
export const GAP_WINDOW = 3;

export function isSidebarVisible(terminalWidth: number): boolean {
  return terminalWidth >= MIN_MAIN_WIDTH + RESERVED_WIDTH;
}

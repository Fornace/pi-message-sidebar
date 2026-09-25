import { matchesKey } from "@earendil-works/pi-tui";
import type { FileEdit } from "./files.ts";
import type { FileWindow } from "./sections.ts";

/** File rows the FILES subsection may show, excluding its chrome. The idle
 *  rail stays compact; files mode widens the window so the list can be
 *  browsed, but never past the three-message floor. */
export const MAX_FILE_ROWS_IDLE = 6;
export const MAX_FILE_ROWS_FOCUS = 12;

/**
 * Hierarchical navigation state for the FILES list: a second focus level
 * under the rail's focus. The cursor is the selection, the offset is the
 * window anchor; the render normalizes both against the rows the layout
 * actually granted, mirroring how the message viewport anchors on its start
 * id.
 */
export class FilesNav {
  private mode = false;
  private cursor = 0;
  private offset = 0;

  active(): boolean { return this.mode; }

  enter(count: number): void {
    if (count === 0) return;
    this.mode = true;
    this.cursor = Math.min(this.cursor, count - 1);
    this.offset = 0;
  }

  leave(): void {
    this.mode = false;
  }

  capRows(): number {
    return this.mode ? MAX_FILE_ROWS_FOCUS : MAX_FILE_ROWS_IDLE;
  }

  /** The file the cursor sits on, clamped to the list. */
  selected(files: FileEdit[]): FileEdit | null {
    if (files.length === 0) return null;
    return files[Math.min(this.cursor, files.length - 1)] ?? null;
  }

  /** Cursor and window anchor, for render signatures. */
  cursorIndex(): number { return this.cursor; }
  offsetIndex(): number { return this.offset; }

  /** Arrow, page, and home/end motion. Returns false when the key was not
   *  a motion key, so the caller can decide what else it might mean. */
  handleInput(data: string, count: number): boolean {
    if (count === 0) return false;
    const current = Math.min(this.cursor, count - 1);
    let target: number | null = null;
    if (matchesKey(data, "up")) target = Math.max(0, current - 1);
    else if (matchesKey(data, "down")) target = Math.min(count - 1, current + 1);
    else if (matchesKey(data, "pageUp")) target = Math.max(0, current - 10);
    else if (matchesKey(data, "pageDown")) target = Math.min(count - 1, current + 10);
    else if (matchesKey(data, "home")) target = 0;
    else if (matchesKey(data, "end")) target = count - 1;
    else return false;
    this.move(target, count);
    return true;
  }

  /** Moves the cursor and keeps it inside the estimated window. */
  move(target: number, count: number): void {
    if (count === 0) return;
    const cursor = Math.max(0, Math.min(target, count - 1));
    const entries = Math.max(1, Math.min(this.capRows(), count));
    let offset = Math.max(0, Math.min(this.offset, count - entries));
    if (cursor < offset) offset = cursor;
    if (cursor >= offset + entries) offset = cursor - entries + 1;
    this.cursor = cursor;
    this.offset = offset;
  }

  /** Resolves the FILES window for a render: cursor always visible, offset
   *  normalized against the rows the layout granted. Pure except for writing
   *  the normalized offset back. */
  resolveWindow(files: FileEdit[], grantedRows: number): FileWindow | null {
    if (files.length === 0 || grantedRows === 0) return null;
    const slot = Math.max(1, grantedRows - 2); // entry rows plus ellipsis rows
    const fit = (top: boolean, bottom: boolean) => Math.max(1, slot - (top ? 1 : 0) - (bottom ? 1 : 0));
    // Assume truncated first so the bottom ellipsis row is reserved; a list
    // that fits entirely collapses the window to the whole list.
    let entries = Math.min(fit(false, true), files.length);
    let offset = Math.max(0, Math.min(this.offset, files.length - entries));
    const cursor = this.mode ? Math.min(this.cursor, files.length - 1) : null;
    if (cursor !== null) {
      if (cursor < offset) offset = cursor;
      if (cursor >= offset + entries) offset = cursor - entries + 1;
    }
    entries = Math.min(fit(offset > 0, offset + entries < files.length), files.length);
    offset = Math.max(0, Math.min(offset, files.length - entries));
    if (cursor !== null && cursor >= offset + entries) offset = Math.max(0, cursor - entries + 1);
    this.offset = offset;
    const end = Math.min(files.length, offset + entries);
    return { start: offset, end, cursor, hiddenAbove: offset, hiddenBelow: files.length - end };
  }
}

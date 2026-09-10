import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Distinct repositories queried per refresh; a session rarely edits across more. */
const MAX_ROOTS = 8;

/**
 * Git worktree status per absolute path, in the letter convention shared by
 * git, VS Code, and GitHub: M modified, A added, D deleted, R renamed,
 * U untracked. Refresh is throttled and spans every repository the session
 * edits in, not just the session cwd; failures leave the last good map.
 */
export class GitStatusProvider {
  private status = new Map<string, string>();
  private readonly realpaths = new Map<string, string>();
  private readonly roots = new Map<string, string>();
  private lastRun = 0;
  private inflight: Promise<void> | null = null;
  lastError: string | null = null;

  constructor(
    private readonly refreshIntervalMs = 4000,
    private readonly exec: (file: string, args: string[], cwd: string) => Promise<string> = async (file, args, cwd) => {
      const { stdout } = await run(file, args, { cwd, timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    },
  ) {}

  /** Throttled refresh; concurrent callers share one run. */
  refresh(cwd: string, force = false, extraPaths: readonly string[] = []): Promise<void> {
    if (this.inflight) return this.inflight;
    const now = Date.now();
    if (!force && now - this.lastRun < this.refreshIntervalMs) return Promise.resolve();
    this.lastRun = now;
    this.inflight = this.run(cwd, extraPaths).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** One letter per the shared convention, or null when git has no opinion. */
  statusFor(path: string): string | null {
    const xy = this.status.get(this.realpath(path));
    if (!xy) return null;
    if (xy === "??") return "U";
    const index = xy[0] ?? " ";
    const worktree = xy[1] ?? " ";
    const letter = index !== " " && index !== "?" ? index : worktree;
    return letter === "M" || letter === "A" || letter === "D" || letter === "R" ? letter : null;
  }

  /** Symlink-safe identity; callers hand us /var paths while git says /private/var. */
  private realpath(path: string): string {
    const cached = this.realpaths.get(path);
    if (cached) return cached;
    let resolved = path;
    try {
      resolved = realpathSync(path);
    } catch {
      // A path git wrote but the disk renamed: keep the raw string.
    }
    this.realpaths.set(path, resolved);
    return resolved;
  }

  /** Repository root for a directory; failures stay uncached so they retry. */
  private async gitRoot(dir: string): Promise<string | null> {
    const cached = this.roots.get(dir);
    if (cached) return cached;
    try {
      const root = (await this.exec("git", ["rev-parse", "--show-toplevel"], dir)).trim();
      const resolved = this.realpath(root);
      this.roots.set(dir, resolved);
      return resolved;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  private async run(cwd: string, extraPaths: readonly string[]): Promise<void> {
    const roots = new Set<string>();
    const cwdRoot = await this.gitRoot(cwd);
    if (cwdRoot) roots.add(cwdRoot);
    for (const path of extraPaths) {
      if (roots.size >= MAX_ROOTS) break;
      const root = await this.gitRoot(dirname(path));
      if (root) roots.add(root);
    }
    if (roots.size === 0) return;

    const next = new Map<string, string>();
    const failures: string[] = [];
    await Promise.all([...roots].map(async (root) => {
      try {
        const stdout = await this.exec("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], root);
        for (const [path, xy] of parsePorcelain(stdout, root)) next.set(path, xy);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }));
    this.status = next;
    this.lastError = failures.length > 0 ? failures.join("; ") : null;
  }
}

/** -z records: "XY path\0" with an extra "origPath\0" record for renames. */
function parsePorcelain(stdout: string, root: string): [string, string][] {
  const entries: [string, string][] = [];
  const records = stdout.split("\0");
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const xy = record.slice(0, 2);
    const rel = record.slice(3);
    if (!rel) continue;
    entries.push([join(root, rel), xy]);
    if (xy[0] === "R" || xy[0] === "C") index++; // skip the source-path record
  }
  return entries;
}

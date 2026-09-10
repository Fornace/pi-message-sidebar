import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Git worktree status per absolute path, in the letter convention shared by
 * git, VS Code, and GitHub: M modified, A added, D deleted, R renamed,
 * U untracked. Refresh is throttled; failures leave the last good map.
 */
export class GitStatusProvider {
  private status = new Map<string, string>();
  private readonly realpaths = new Map<string, string>();
  private toplevel: string | null = null;
  private toplevelFailed = false;
  private lastRun = 0;
  private inflight: Promise<void> | null = null;
  lastError: string | null = null;

  constructor(
    private readonly refreshIntervalMs = 4000,
    private readonly exec: (file: string, args: string[], cwd: string) => Promise<string> = async (file, args, cwd) => {
      const { stdout } = await run(file, args, { cwd, timeout: 5000 });
      return stdout;
    },
  ) {}

  /** Throttled refresh; concurrent callers share one run. */
  refresh(cwd: string, force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    const now = Date.now();
    if (!force && now - this.lastRun < this.refreshIntervalMs) return Promise.resolve();
    this.lastRun = now;
    this.inflight = this.run(cwd).finally(() => { this.inflight = null; });
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

  private async run(cwd: string): Promise<void> {
    try {
      if (this.toplevel === null && !this.toplevelFailed) {
        try {
          const root = (await this.exec("git", ["rev-parse", "--show-toplevel"], cwd)).trim();
          // macOS hands out /var/folders symlinks; git reports /private/var.
          try {
            this.toplevel = realpathSync(root);
          } catch {
            this.toplevel = root;
          }
        } catch {
          this.toplevelFailed = true;
          this.toplevel = null;
        }
      }
      if (this.toplevel === null) return;
      const stdout = await this.exec("git", ["status", "--porcelain=v1", "-z"], cwd);
      const next = new Map<string, string>();
      // -z records: "XY path\0" with an extra "origPath\0" record for renames.
      const records = stdout.split("\0");
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (!record || record.length < 4) continue;
        const xy = record.slice(0, 2);
        const rel = record.slice(3);
        if (!rel) continue;
        next.set(join(this.toplevel, rel), xy);
        if (xy[0] === "R" || xy[0] === "C") index++; // skip the source-path record
      }
      this.status = next;
      this.lastError = null;
    } catch (error) {
      // A missing or broken git is a decoration loss, not a rail failure:
      // keep the last good map and remember why for diagnostics.
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }
}

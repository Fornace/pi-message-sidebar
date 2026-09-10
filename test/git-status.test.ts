import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitStatusProvider } from "../src/git-status.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "sidebar-git-"));
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.email", "test@example.com");
  git(path, "config", "user.name", "Test");
  // Throwaway repo: no signing, no inherited global hooks.
  git(path, "config", "core.hooksPath", "/dev/null");
  writeFileSync(join(path, "tracked.md"), "one\n");
  git(path, "add", ".");
  git(path, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base");
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

test("the shared letter convention maps porcelain status to M, U, A, R", async () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo.path, "tracked.md"), "two\n");           // modified
    writeFileSync(join(repo.path, "fresh.md"), "new\n");            // untracked
    git(repo.path, "add", "fresh.md");                              // added

    const provider = new GitStatusProvider(0);
    await provider.refresh(repo.path, true);

    assert.equal(provider.statusFor(join(repo.path, "tracked.md")), "M");
    assert.equal(provider.statusFor(join(repo.path, "fresh.md")), "A");
    assert.equal(provider.statusFor(join(repo.path, "untouched.md")), null);

    writeFileSync(join(repo.path, "rename-me.md"), "x\n");
    git(repo.path, "add", "rename-me.md");
    git(repo.path, "commit", "-q", "-m", "stage");
    git(repo.path, "mv", "rename-me.md", "renamed.md");             // renamed
    writeFileSync(join(repo.path, "loose.md"), "untracked\n");       // untracked
    await provider.refresh(repo.path, true);

    assert.equal(provider.statusFor(join(repo.path, "renamed.md")), "R");
    assert.equal(provider.statusFor(join(repo.path, "loose.md")), "U");
    assert.equal(provider.lastError, null);
  } finally {
    repo.cleanup();
  }
});

test("a directory outside any repository yields no badges and no crash", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sidebar-nogit-"));
  try {
    const provider = new GitStatusProvider(0);
    await provider.refresh(dir, true);
    assert.equal(provider.statusFor(join(dir, "whatever.ts")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refresh is throttled so a render storm cannot spawn git", async () => {
  let runs = 0;
  const provider = new GitStatusProvider(60_000, async () => { runs++; return ""; });
  await provider.refresh("/tmp", true);
  const afterFirst = runs;
  assert.ok(afterFirst >= 1);
  await provider.refresh("/tmp");
  await provider.refresh("/tmp");
  assert.equal(runs, afterFirst, "throttled refreshes must not spawn git again");
});

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type ThreadGoal = {
  goalId: string;
  objective: string;
  status: "active" | "paused" | "budgetLimited" | "complete";
  tokenBudget: number | null;
  tokensUsed: number;
  activeSeconds: number;
  createdAt: number;
  updatedAt: number;
};

type BranchEntry = { type?: string; customType?: string; data?: unknown };

const GOAL_ENTRY_TYPE = "pi-codex-goal";

function isThreadGoal(value: unknown): value is ThreadGoal {
  const goal = value as ThreadGoal | null;
  return (
    !!goal &&
    typeof goal === "object" &&
    typeof goal.goalId === "string" &&
    typeof goal.objective === "string" &&
    (goal.status === "active" || goal.status === "paused" || goal.status === "budgetLimited" || goal.status === "complete") &&
    (goal.tokenBudget === null || typeof goal.tokenBudget === "number") &&
    typeof goal.tokensUsed === "number" &&
    typeof goal.activeSeconds === "number" &&
    typeof goal.createdAt === "number" &&
    typeof goal.updatedAt === "number"
  );
}

/**
 * Reconstructs the current thread goal from pi-codex-goal session entries.
 * Mirrors reconstructGoal() from pi-codex-goal dist/state.js (schema version 1):
 * "set" entries replace the goal, "clear" entries drop it, and "usage" entries
 * advance tokens/time for runtime-usage statuses only.
 */
export function readThreadGoal(entries: Iterable<BranchEntry>): ThreadGoal | null {
  let goal: ThreadGoal | null = null;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) continue;
    const data = entry.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data.version !== 1) continue;
    if (data.kind === "clear") {
      goal = null;
    } else if (data.kind === "set" && isThreadGoal(data.goal)) {
      goal = { ...(data.goal as ThreadGoal) };
    } else if (data.kind === "usage" && goal) {
      const usage = data.usage as { tokensUsed?: number; activeSeconds?: number } | undefined;
      const updatedAt = data.updatedAt;
      if (data.goalId !== goal.goalId) continue;
      if (goal.status !== "active" && goal.status !== "budgetLimited") continue;
      if (goal.status === "budgetLimited" && data.status === "active") continue;
      if (typeof updatedAt !== "number" || typeof usage?.tokensUsed !== "number" || typeof usage.activeSeconds !== "number") continue;
      if (updatedAt < goal.updatedAt || usage.tokensUsed < goal.tokensUsed || usage.activeSeconds < goal.activeSeconds) continue;
      goal = { ...goal, status: data.status as ThreadGoal["status"], tokensUsed: usage.tokensUsed, activeSeconds: usage.activeSeconds, updatedAt } as ThreadGoal;
    }
  }
  return goal;
}

type GoalCache = { key: string; goal: ThreadGoal | null };
let cache: GoalCache | null = null;

/** Cached readThreadGoal over the current session branch. */
export function readSessionGoal(ctx: ExtensionContext): ThreadGoal | null {
  const branch = ctx.sessionManager.getBranch();
  const last = branch.at(-1);
  const key = `${branch.length}:${last?.id ?? ""}:${last?.timestamp ?? ""}`;
  if (cache && cache.key === key) return cache.goal;
  const goal = readThreadGoal(branch);
  cache = { key, goal };
  return goal;
}

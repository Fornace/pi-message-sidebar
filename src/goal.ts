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

function isThreadGoal(value: unknown): value is RawGoal {
  const goal = value as RawGoal | null;
  if (!goal || typeof goal !== "object") return false;
  const usage = goal.usage as { tokensUsed?: unknown; activeSeconds?: unknown } | undefined;
  return (
    typeof goal.goalId === "string" &&
    typeof goal.objective === "string" &&
    (goal.status === "active" || goal.status === "paused" || goal.status === "budgetLimited" || goal.status === "complete") &&
    (goal.tokenBudget === null || typeof goal.tokenBudget === "number") &&
    typeof goal.createdAt === "number" &&
    typeof goal.updatedAt === "number" &&
    typeof usage?.tokensUsed === "number" &&
    typeof usage.activeSeconds === "number"
  );
}

type RawGoal = Omit<ThreadGoal, "tokensUsed" | "activeSeconds"> & {
  usage: { tokensUsed: number; activeSeconds: number };
};

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
      const raw = data.goal as RawGoal;
      goal = {
        goalId: raw.goalId,
        objective: raw.objective,
        status: raw.status,
        tokenBudget: raw.tokenBudget,
        tokensUsed: raw.usage.tokensUsed,
        activeSeconds: raw.usage.activeSeconds,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      };
    } else if (data.kind === "usage" && goal) {
      const usage = data.usage as { tokensUsed?: number; activeSeconds?: number } | undefined;
      const updatedAt = data.updatedAt;
      const status = data.status;
      if (data.goalId !== goal.goalId) continue;
      if (status !== "active" && status !== "budgetLimited") continue;
      if (goal.status !== "active" && goal.status !== "budgetLimited") continue;
      if (goal.status === "budgetLimited" && status === "active") continue;
      if (typeof updatedAt !== "number" || typeof usage?.tokensUsed !== "number" || typeof usage.activeSeconds !== "number") continue;
      if (updatedAt < goal.updatedAt || usage.tokensUsed < goal.tokensUsed || usage.activeSeconds < goal.activeSeconds) continue;
      const current: ThreadGoal = goal;
      goal = {
        ...current,
        status,
        tokensUsed: usage.tokensUsed,
        activeSeconds: usage.activeSeconds,
        updatedAt,
      };
    }
  }
  return goal;
}

type GoalCache = { branch: object; key: string; goal: ThreadGoal | null };
const cache = new WeakMap<ExtensionContext, GoalCache>();

/** Cached readThreadGoal over the current session branch. */
export function readSessionGoal(ctx: ExtensionContext): ThreadGoal | null {
  const branch = ctx.sessionManager.getBranch();
  const last = branch.at(-1);
  const key = `${branch.length}:${last?.id ?? ""}:${last?.timestamp ?? ""}`;
  const previous = cache.get(ctx);
  if (previous?.branch === branch && previous.key === key) return previous.goal;
  const goal = readThreadGoal(branch);
  cache.set(ctx, { branch, key, goal });
  return goal;
}

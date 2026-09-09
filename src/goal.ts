import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type GoalStatus = "active" | "paused" | "budgetLimited" | "complete";

export type ThreadGoal = {
  goalId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  usage: { tokensUsed: number; activeSeconds: number };
  createdAt: number;
  updatedAt: number;
};

type BranchEntry = { type?: string; customType?: string; data?: unknown; id?: string; timestamp?: string };
type GoalEntrySource = "command" | "tool" | "runtime";

const GOAL_ENTRY_TYPE = "pi-codex-goal";

function isGoalEntrySource(value: unknown): value is GoalEntrySource {
  return value === "command" || value === "tool" || value === "runtime";
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return value === "active" || value === "paused" || value === "budgetLimited" || value === "complete";
}

function isThreadGoal(value: unknown): value is ThreadGoal {
  const goal = value as ThreadGoal | null;
  return Boolean(
    goal && typeof goal === "object" &&
    typeof goal.goalId === "string" && goal.goalId.length > 0 &&
    typeof goal.objective === "string" && goal.objective.trim().length > 0 &&
    isGoalStatus(goal.status) &&
    (goal.tokenBudget === null || (Number.isInteger(goal.tokenBudget) && goal.tokenBudget >= 0)) &&
    isFiniteNonNegative(goal.createdAt) &&
    isFiniteNonNegative(goal.updatedAt) &&
    isFiniteNonNegative(goal.usage?.tokensUsed) &&
    isFiniteNonNegative(goal.usage?.activeSeconds)
  );
}

function cloneGoal(goal: ThreadGoal): ThreadGoal {
  return { ...goal, usage: { ...goal.usage } };
}

/** Mirrors pi-codex-goal's schema-v1 reconstruction contract. */
export function readThreadGoal(entries: Iterable<BranchEntry>): ThreadGoal | null {
  let goal: ThreadGoal | null = null;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY_TYPE) continue;
    const data = entry.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data.version !== 1 || !isFiniteNonNegative(data.at)) continue;

    if (data.kind === "clear") {
      if (!isGoalEntrySource(data.source) || (data.clearedGoalId !== null && typeof data.clearedGoalId !== "string")) continue;
      goal = null;
      continue;
    }
    if (data.kind === "set") {
      if (!isGoalEntrySource(data.source) || !isThreadGoal(data.goal)) continue;
      goal = cloneGoal(data.goal);
      continue;
    }
    if (data.kind !== "usage" || data.source !== "runtime" || !goal) continue;

    const status = data.status;
    const usage = data.usage as ThreadGoal["usage"] | undefined;
    if (data.goalId !== goal.goalId || (status !== "active" && status !== "budgetLimited")) continue;
    if (goal.status !== "active" && goal.status !== "budgetLimited") continue;
    if (goal.status === "budgetLimited" && status === "active") continue;
    if (!isFiniteNonNegative(data.updatedAt) || !isFiniteNonNegative(usage?.tokensUsed) || !isFiniteNonNegative(usage.activeSeconds)) continue;
    if (data.updatedAt < goal.updatedAt || usage.tokensUsed < goal.usage.tokensUsed || usage.activeSeconds < goal.usage.activeSeconds) continue;
    goal = { ...goal, status, usage: { ...usage }, updatedAt: data.updatedAt };
  }
  return goal;
}

type GoalCache = { key: string; goal: ThreadGoal | null };
const caches = new WeakMap<ExtensionContext, GoalCache>();

/** Cached reconstruction scoped to each extension context. */
export function readSessionGoal(ctx: ExtensionContext): ThreadGoal | null {
  const branch = ctx.sessionManager.getBranch();
  const last = branch.at(-1);
  const key = `${branch.length}:${last?.id ?? ""}:${last?.timestamp ?? ""}`;
  const previous = caches.get(ctx);
  if (previous?.key === key) return previous.goal;
  const goal = readThreadGoal(branch);
  caches.set(ctx, { key, goal });
  return goal;
}

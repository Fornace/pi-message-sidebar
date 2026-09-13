import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readSessionGoal } from "./goal.ts";

/** Direct summary transport must honor the parent guards too. */
export function summaryAdmission(ctx: ExtensionContext): boolean {
  const goal = readSessionGoal(ctx);
  if (goal?.status === "paused" || goal?.status === "budgetLimited") return false;
  let mechanical = true;
  let autonomy = true;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== "mantice-spend-guard") continue;
    const data = entry.data as { version?: number; state?: string } | null;
    mechanical = data?.version === 1 && data.state === "ready";
  }
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== "goal-autonomy-guard") continue;
    const data = entry.data as { version?: number; paused?: boolean } | null;
    autonomy = data?.version === 1 && data.paused === false;
  }
  // Standalone sidebar has no guard records. Unified installs share durable state.
  return mechanical && autonomy;
}

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type SummaryRecord = { summary: string; generations: number; attempts: number; pending: boolean };
export type SummaryState = { records: Record<string, SummaryRecord>; failure: string | null; retryAt: number };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** A failed or interrupted request stays visible across reloads. */
export function loadSummaryState(file: string): SummaryState {
  let raw: string;
  try { raw = readFileSync(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: {}, failure: null, retryAt: 0 };
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid summary cache");
  const enveloped = "version" in parsed;
  if (enveloped && (parsed.version !== 1 || !parsed.data ||
      parsed.digest !== digest(JSON.stringify(parsed.data)))) throw new Error("Summary cache integrity failure");
  const records = enveloped ? parsed.data.records : parsed;
  let failure = enveloped ? parsed.data.failure : null;
  if (!records || typeof records !== "object" || Array.isArray(records) ||
      (failure !== null && typeof failure !== "string")) throw new Error("Invalid summary cache state");
  const retryAt = enveloped ? parsed.data.retryAt : 0;
  if (!Number.isSafeInteger(retryAt) || retryAt < 0) throw new Error("Invalid summary retry timestamp");
  const validated: Record<string, SummaryRecord> = {};
  for (const [id, value] of Object.entries(records)) {
    const record = value as SummaryRecord;
    // Released flat caches counted successful generations only. Import them once.
    const attempts = enveloped ? record?.attempts : record?.generations;
    const pending = enveloped ? record?.pending : false;
    if (!record || typeof pending !== "boolean" || typeof record.summary !== "string" || !Number.isSafeInteger(record.generations) ||
        record.generations < 0 || !Number.isSafeInteger(attempts) || attempts < record.generations ||
        (record.generations > 0 && !record.summary.trim())) throw new Error(`Invalid summary record ${id}`);
    validated[id] = { summary: record.summary, generations: record.generations, attempts, pending };
    if (pending && !failure) failure = `Unsettled summary request ${id}`;
  }
  return { records: validated, failure, retryAt };
}

export function saveSummaryState(file: string, data: SummaryState): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, data, digest: digest(JSON.stringify(data)) }), { mode: 0o600 });
  renameSync(temp, file);
}

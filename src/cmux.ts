import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CmuxContext = {
  workspaceTitle: string | null;
  workspaceRef: string | null;
  surfaceRef: string | null;
  /** Stable surface UUID from CMUX_SURFACE_ID: survives cmux restarts. */
  surfaceId: string | null;
  /** Human-readable role bound to this surface's UUID in the roles registry. */
  roleId: string | null;
};

export function runningInCmux(): boolean {
  return Boolean(
    process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID || process.env.CMUX_PANEL_ID,
  );
}

function cmuxBin(): string {
  return process.env.CMUX_PI_CMUX_BIN || "cmux";
}

function run(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmuxBin(), args, { timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function identifyRefs(): Promise<{ workspaceRef: string | null; surfaceRef: string | null }> {
  try {
    const parsed = JSON.parse(await run(["identify"], 3000)) as {
      caller?: { workspace_ref?: string; surface_ref?: string };
    };
    return { workspaceRef: parsed.caller?.workspace_ref ?? null, surfaceRef: parsed.caller?.surface_ref ?? null };
  } catch {
    return { workspaceRef: null, surfaceRef: null };
  }
}

async function workspaceTitle(): Promise<string | null> {
  const workspaceId = process.env.CMUX_WORKSPACE_ID;
  if (!workspaceId) return null;
  try {
    const parsed = JSON.parse(await run(["rpc", "workspace.list", "{}"], 3000)) as {
      workspaces?: { id?: string; custom_title?: string | null; description?: string | null }[];
    };
    const match = parsed.workspaces?.find((workspace) => workspace.id === workspaceId);
    return match?.custom_title ?? match?.description ?? null;
  } catch {
    return null;
  }
}

function stableSurfaceId(): string | null {
  // cmux exports the durable surface UUID to every surface it spawns; it is
  // the same UUID cmux persists across crashes, so no subprocess is needed.
  const id = process.env.CMUX_SURFACE_ID || process.env.CMUX_PANEL_ID;
  return id ? id.toUpperCase() : null;
}

type RoleBinding = { id?: unknown };
type RolesRegistry = Record<string, RoleBinding>;

function rolesRegistryPath(): string {
  return process.env.CMUX_ROLES_REGISTRY ?? join(homedir(), ".pi", "agent", "state", "cmux-roles.json");
}

/** Reverse lookup: the role name whose bound UUID is this surface. */
function roleIdFor(surfaceId: string | null): string | null {
  if (!surfaceId) return null;
  let registry: RolesRegistry;
  try {
    registry = JSON.parse(readFileSync(rolesRegistryPath(), "utf8")) as RolesRegistry;
  } catch {
    return null;
  }
  const wanted = surfaceId.toUpperCase();
  for (const [role, binding] of Object.entries(registry)) {
    if (typeof binding?.id === "string" && binding.id.toUpperCase() === wanted) return role;
  }
  return null;
}

const REGISTRY_TTL_MS = 15_000;
let cached: { at: number; promise: Promise<CmuxContext | null> } | null = null;

/**
 * Resolves the cmux identity for this session: refs and workspace title plus
 * the stable surface UUID and the human-readable role bound to it. Returns
 * null when pi runs outside cmux. Lookup failures degrade to null fields so
 * the sidebar keeps rendering with whatever it has. The registry reverse
 * lookup is re-read every 15s so a role bound mid-session appears without a
 * restart.
 */
export function resolveCmuxContext(): Promise<CmuxContext | null> {
  const now = Date.now();
  if (!cached || now - cached.at > REGISTRY_TTL_MS) {
    const at = now;
    const promise = runningInCmux()
      ? (async () => {
          const [refs, title] = await Promise.all([identifyRefs(), workspaceTitle()]);
          const surfaceId = stableSurfaceId();
          const context: CmuxContext = {
            workspaceTitle: title,
            workspaceRef: refs.workspaceRef,
            surfaceRef: refs.surfaceRef,
            surfaceId,
            roleId: roleIdFor(surfaceId),
          };
          if (!context.workspaceTitle && !context.workspaceRef && !context.surfaceRef && !context.roleId) return null;
          return context;
        })()
      : Promise.resolve(null);
    cached = { at, promise };
  }
  return cached.promise;
}

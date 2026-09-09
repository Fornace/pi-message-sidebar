import { execFile } from "node:child_process";

export type CmuxContext = {
  workspaceTitle: string | null;
  workspaceRef: string | null;
  surfaceRef: string | null;
};

export function runningInCmux(): boolean {
  return Boolean(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID);
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

let cached: Promise<CmuxContext | null> | null = null;

/**
 * Resolves the cmux workspace title and surface ref for this session, once.
 * Returns null when pi runs outside cmux. Lookup failures degrade to null
 * fields so the sidebar keeps rendering with whatever it has.
 */
export function resolveCmuxContext(): Promise<CmuxContext | null> {
  if (!cached) {
    if (!runningInCmux()) cached = Promise.resolve(null);
    else {
      cached = (async () => {
        const [refs, title] = await Promise.all([identifyRefs(), workspaceTitle()]);
        const context: CmuxContext = {
          workspaceTitle: title,
          workspaceRef: refs.workspaceRef,
          surfaceRef: refs.surfaceRef,
        };
        if (!context.workspaceTitle && !context.workspaceRef && !context.surfaceRef) return null;
        return context;
      })();
    }
  }
  return cached;
}

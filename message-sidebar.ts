import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { isViewportTUI, matchesKey } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./src/cmux.ts";
import { resolveCmuxContext } from "./src/cmux.ts";
import { MIN_MAIN_WIDTH, RESERVED_WIDTH, isSidebarVisible } from "./src/constants.ts";
import { readSessionFileEdits } from "./src/files.ts";
import { renderFooterRail } from "./src/footer-rail.ts";
import { GitStatusProvider } from "./src/git-status.ts";
import { readSessionGoal } from "./src/goal.ts";
import { SidebarLayoutBridge } from "./src/layout.ts";
import { resolvePalette } from "./src/palette.ts";
import { SidebarComponent } from "./src/sidebar-component.ts";
import { computeUsage } from "./src/status-dock.ts";
import { isGatewayConfigured, SummaryService, fallbackSummary } from "./src/summaries.ts";
import { stripControl } from "./src/style.ts";
import type { UserMessage } from "./src/types.ts";
import { WorkerActivityStore } from "./src/worker-activity.ts";
import { summaryAdmission } from "./src/summary-admission.ts";

function extractUserText(message: { content: unknown }): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((content): content is { type: "text"; text: string } => {
      return typeof content === "object" && content !== null && (content as any).type === "text";
    })
    .map((content) => content.text)
    .join(" ");
}

export function collectUserMessages(ctx: ExtensionContext): UserMessage[] {
  const messages: UserMessage[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const text = stripControl(extractUserText(entry.message)).trim();
    // A user turn with no text (image-only, say) is not shown, so it must not
    // consume an ordinal: the detail's "#N" has to match the heading's "N/total".
    if (text) messages.push({ id: entry.id, text, index: messages.length + 1, timestamp: entry.timestamp });
  }
  return messages;
}

/** Narrowest terminal where the rail can claim its column beside an 80-cell main pane. */
const RAIL_BREAKPOINT = MIN_MAIN_WIDTH + RESERVED_WIDTH;

class FooterDataBridge {
  constructor(
    footerData: ReadonlyFooterDataProvider,
    private readonly onChange: () => void,
    private readonly onDispose: () => void,
    /** Renders the footer-mode footer, or null while the rail owns the session chrome. */
    private readonly renderFooter: (width: number) => string[] | null,
  ) {
    this.unsubscribe = footerData.onBranchChange(onChange);
  }

  private readonly unsubscribe: () => void;

  render(width: number): string[] {
    return this.renderFooter(width) ?? [];
  }

  invalidate(): void { this.onChange(); }
  dispose(): void { this.unsubscribe(); this.onDispose(); }
}

export default function messageSidebar(pi: ExtensionAPI): void {
  let sidebar: SidebarComponent | null = null;
  let tui: TUI | null = null;
  let cachedContext: ExtensionContext | null = null;
  let footerData: ReadonlyFooterDataProvider | null = null;
  let cmuxContext: CmuxContext | null = null;
  let summaries: SummaryService | null = null;
  let userMessages: UserMessage[] = [];
  /** Footer mode: the user pinned the rail's minimal double into the footer. */
  let footerMode = false;
  const gitStatus = new GitStatusProvider();
  const workers = new WorkerActivityStore();
  let refreshQueued = false;
  pi.events.on("mantice:spend-guard", () => summaries?.admissionChanged());
  pi.events.on("subagent:activity", (record: unknown) => {
    if (!cachedContext) return;
    try { if (workers.accept(record)) sidebar?.refresh(); }
    catch (error) {
      console.error("[pi-sidebar] Invalid worker observation", error);
      cachedContext.ui.setStatus("worker-activity-error", "Worker telemetry invalid");
    }
  });

  /** The rail claims its column only when footer mode is off and the terminal is wide enough. */
  const isRailVisible = (width: number): boolean => !footerMode && isSidebarVisible(width);

  const scheduleRefresh = (ctx: ExtensionContext | null = cachedContext) => {
    if (refreshQueued) return;
    refreshQueued = true;
    setImmediate(() => {
      refreshQueued = false;
      if (ctx) userMessages = collectUserMessages(ctx);
      if (sidebar && ctx) sidebar.updateMessages(userMessages);
      else sidebar?.refresh();
    });
  };

  const setFooterMode = (mode: boolean, ctx: ExtensionContext): void => {
    if (footerMode === mode) return;
    footerMode = mode;
    if (mode && sidebar?.isFocused()) sidebar.setFocused(false);
    scheduleRefresh(ctx);
    tui?.requestRender(true);
  };

  const toggleMode = (ctx: ExtensionContext): void => {
    const wide = tui ? isSidebarVisible(tui.terminal.columns) : false;
    const wasRail = !footerMode && wide;
    if (!footerMode && !wide) {
      ctx.ui.notify(`Rail needs a terminal width of at least ${RAIL_BREAKPOINT} columns`, "warning");
      return;
    }
    setFooterMode(!footerMode, ctx);
    // Staying in footer mode means the mode was pinned from the auto fallback.
    if (!wasRail && footerMode) ctx.ui.notify("Footer mode pinned: Ctrl+Shift+S returns the rail", "info");
  };

  const toggleFocus = (ctx: ExtensionContext) => {
    const activeTui = tui;
    if (!sidebar || !activeTui) {
      ctx.ui.notify("Sidebar is still initializing", "warning");
      return;
    }
    if (!isSidebarVisible(activeTui.terminal.columns)) {
      ctx.ui.notify(`Rail needs a terminal width of at least ${RAIL_BREAKPOINT} columns`, "warning");
      return;
    }
    // Focusing while pinned to the footer brings the rail back first.
    if (footerMode) setFooterMode(false, ctx);
    const focused = !sidebar.isFocused();
    sidebar.setFocused(focused);
    activeTui.requestRender();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    cachedContext = ctx;
    workers.reset(ctx.sessionManager.getSessionId());
    setImmediate(() => {
      if (cachedContext === ctx) pi.events.emit("subagent:activity-request", { sessionId: ctx.sessionManager.getSessionId() });
    });
    userMessages = collectUserMessages(ctx);
    summaries?.dispose();
    summaries = new SummaryService(
      ctx.sessionManager.getSessionId(),
      () => scheduleRefresh(ctx),
      undefined,
      (err) => ctx.ui.notify(err, "warning"),
      () => summaryAdmission(ctx),
    );
    summaries.seed(userMessages);
    void gitStatus.refresh(ctx.sessionManager.getCwd(), true, readSessionFileEdits(ctx).map((file) => file.path));
    void resolveCmuxContext().then((resolved) => {
      cmuxContext = resolved;
      scheduleRefresh(ctx);
    });
    ctx.ui.setWidget(
      "message-sidebar-layout",
      (currentTui) => {
        tui = currentTui;
        sidebar = new SidebarComponent({
          tui: currentTui,
          ctx,
          getFooterData: () => footerData,
          getThinkingLevel: () => pi.getThinkingLevel(),
          getCmuxContext: () => cmuxContext,
          getTheme: () => ctx.ui.theme,
          getSummary: (messageId, text) => summaries?.get(messageId, text) ?? fallbackSummary(text),
          hasSummary: (messageId) => summaries?.hasSummary(messageId) ?? false,
          isPending: (messageId) => summaries?.isPending(messageId) ?? false,
          summariesConfigured: isGatewayConfigured,
          getEditedFiles: () => readSessionFileEdits(ctx),
          getGitStatus: (path) => gitStatus.statusFor(path),
          getWorkerCards: () => workers.list(),
          messages: userMessages,
        });
        return new SidebarLayoutBridge(currentTui, sidebar, (width) => isRailVisible(width));
      },
      { placement: "belowEditor" },
    );

    ctx.ui.setFooter((currentTui, _theme, data) => {
      footerData = data;
      scheduleRefresh(ctx);
      return new FooterDataBridge(
        data,
        () => scheduleRefresh(ctx),
        () => {
          if (footerData === data) footerData = null;
        },
        (width) => {
          // The footer renders inside the main pane, so `width` is the main
          // pane width while the rail is visible. The mode decision belongs
          // to the terminal: rail and footer are alternative surfaces.
          if (isRailVisible(currentTui.terminal.columns)) return null;
          return renderFooterRail({
            ctx,
            footerData: data,
            palette: resolvePalette(ctx.ui.theme),
            goal: readSessionGoal(ctx),
            usage: computeUsage(ctx),
            messages: userMessages,
            summaryFor: (message) => summaries?.get(message.id, message.text) ?? fallbackSummary(message.text),
          }, width);
        },
      );
    });

    ctx.ui.onTerminalInput((data) => {
      // Slash commands such as /goal mutate session entries without firing
      // turn events. Refresh on submit, not every keystroke.
      if (matchesKey(data, "return") || matchesKey(data, "enter")) scheduleRefresh();
      if (tui && !isRailVisible(tui.terminal.columns) && sidebar?.isFocused()) {
        sidebar.setFocused(false);
        tui.requestRender();
        return undefined;
      }
      if (tui && isViewportTUI(tui)) return undefined;
      if (sidebar?.isFocused()) {
        // The component owns every key while focused, Escape included: it
        // closes an open message detail first and unfocuses on the second press.
        sidebar.handleInput(data);
        return { consume: true };
      }
      return undefined;
    });
  });

  pi.on("session_shutdown", () => {
    sidebar?.stopAnimations();
    summaries?.dispose();
    summaries = null;
    sidebar = null;
    tui = null;
    cachedContext = null;
    footerData = null;
    cmuxContext = null;
    userMessages = [];
    workers.reset("");
    // footerMode stays: the pinned mode is a session-spanning preference,
    // and resetting it here would flash the rail back in the exit frame.
  });

  pi.registerShortcut("ctrl+shift+h", {
    description: "Focus or unfocus message sidebar",
    handler: async (ctx) => toggleFocus(ctx),
  });

  pi.registerShortcut("ctrl+shift+s", {
    description: "Toggle message sidebar between rail and footer",
    handler: async (ctx) => toggleMode(ctx),
  });

  pi.registerCommand("sidebar", {
    description: "Focus or unfocus message sidebar (Ctrl+Shift+H)",
    handler: async (_arguments, ctx) => toggleFocus(ctx),
  });

  pi.registerCommand("sidebar-footer", {
    description: "Toggle the sidebar between rail and footer (Ctrl+Shift+S)",
    handler: async (_arguments, ctx) => toggleMode(ctx),
  });

  pi.registerCommand("sidebar-summaries", {
    description: "Show summary status or explicitly retry after repair",
    handler: async (args, ctx) => {
      if (!summaries) throw new Error("Sidebar requires an interactive session");
      if (args.trim() === "retry") {
        if (!ctx.hasUI || !ctx.isIdle()) throw new Error("Summary retry requires an idle human session");
        if (!summaryAdmission(ctx)) throw new Error("Resolve the parent guard before retrying summaries");
        if (!await ctx.ui.confirm("Retry summaries?", "Grant another attempt for unfinished summaries")) return;
        summaries.retry();
        summaries.seed(userMessages);
        summaries.turnCompleted(userMessages);
      } else if (args.trim() && args.trim() !== "status") {
        throw new Error("Use /sidebar-summaries status or /sidebar-summaries retry");
      }
      ctx.ui.notify(summaries.status(), "info");
    },
  });

  pi.on("message_end", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("turn_end", (_event, ctx) => {
    summaries?.turnCompleted(collectUserMessages(ctx));
    void gitStatus.refresh(ctx.sessionManager.getCwd(), false, readSessionFileEdits(ctx).map((file) => file.path));
    scheduleRefresh(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    void gitStatus.refresh(ctx.sessionManager.getCwd(), false, readSessionFileEdits(ctx).map((file) => file.path));
    scheduleRefresh(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("model_select", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("thinking_level_select", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("session_compact", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("session_tree", (_event, ctx) => scheduleRefresh(ctx));
}

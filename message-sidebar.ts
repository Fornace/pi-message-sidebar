import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { isViewportTUI, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { CmuxContext } from "./src/cmux.ts";
import { resolveCmuxContext } from "./src/cmux.ts";
import { isSidebarVisible } from "./src/constants.ts";
import { readSessionFileEdits } from "./src/files.ts";
import { GitStatusProvider } from "./src/git-status.ts";
import { SidebarLayoutBridge } from "./src/layout.ts";
import { SidebarComponent } from "./src/sidebar-component.ts";
import { isGatewayConfigured, SummaryService, fallbackSummary } from "./src/summaries.ts";
import type { UserMessage } from "./src/types.ts";

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
    const text = extractUserText(entry.message).trim();
    // A user turn with no text (image-only, say) is not shown, so it must not
    // consume an ordinal: the detail's "#N" has to match the heading's "N/total".
    if (text) messages.push({ id: entry.id, text, index: messages.length + 1, timestamp: entry.timestamp });
  }
  return messages;
}

class FooterDataBridge {
  constructor(
    private readonly tui: TUI,
    private readonly ctx: ExtensionContext,
    footerData: ReadonlyFooterDataProvider,
    private readonly onChange: () => void,
    private readonly onDispose: () => void,
  ) {
    this.unsubscribe = footerData.onBranchChange(onChange);
  }

  private readonly unsubscribe: () => void;

  render(width: number): string[] {
    if (isSidebarVisible(this.tui.terminal.columns)) return [];
    const model = this.ctx.model?.id ?? "no model";
    const cwd = this.ctx.sessionManager.getCwd();
    return [truncateToWidth(`${model}  ${cwd}`, width, "…")];
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
  const gitStatus = new GitStatusProvider();
  let refreshQueued = false;

  const scheduleRefresh = (ctx: ExtensionContext | null = cachedContext) => {
    if (refreshQueued) return;
    refreshQueued = true;
    setImmediate(() => {
      refreshQueued = false;
      if (sidebar && ctx) sidebar.updateMessages(collectUserMessages(ctx));
      else sidebar?.refresh();
    });
  };

  const toggleFocus = (ctx: ExtensionContext) => {
    const activeTui = tui;
    if (!sidebar || !activeTui) {
      ctx.ui.notify("Sidebar is still initializing", "warning");
      return;
    }
    if (!isSidebarVisible(activeTui.terminal.columns)) {
      ctx.ui.notify("Sidebar needs a terminal width of at least 123 columns", "warning");
      return;
    }
    const focused = !sidebar.isFocused();
    sidebar.setFocused(focused);
    activeTui.requestRender();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    cachedContext = ctx;
    summaries?.dispose();
    summaries = new SummaryService(
      ctx.sessionManager.getSessionId(),
      () => scheduleRefresh(ctx),
      undefined,
      (err) => ctx.ui.notify(err, "warning"),
    );
    summaries.seed(collectUserMessages(ctx));
    void gitStatus.refresh(ctx.sessionManager.getCwd(), true);
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
          messages: collectUserMessages(ctx),
        });
        return new SidebarLayoutBridge(currentTui, sidebar);
      },
      { placement: "belowEditor" },
    );

    ctx.ui.setFooter((currentTui, _theme, data) => {
      footerData = data;
      scheduleRefresh(ctx);
      return new FooterDataBridge(currentTui, ctx, data, () => scheduleRefresh(ctx), () => {
        if (footerData === data) footerData = null;
      });
    });

    ctx.ui.onTerminalInput((data) => {
      // Slash commands such as /goal mutate session entries without firing
      // turn events. Refresh on submit, not every keystroke.
      if (matchesKey(data, "return") || matchesKey(data, "enter")) scheduleRefresh();
      if (tui && !isSidebarVisible(tui.terminal.columns) && sidebar?.isFocused()) {
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
  });

  pi.registerShortcut("ctrl+shift+h", {
    description: "Focus or unfocus message sidebar",
    handler: async (ctx) => toggleFocus(ctx),
  });

  pi.registerCommand("sidebar", {
    description: "Focus or unfocus message sidebar (Ctrl+Shift+H)",
    handler: async (_arguments, ctx) => toggleFocus(ctx),
  });

  pi.on("message_end", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("turn_end", (_event, ctx) => {
    summaries?.turnCompleted(collectUserMessages(ctx));
    void gitStatus.refresh(ctx.sessionManager.getCwd());
    scheduleRefresh(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    void gitStatus.refresh(ctx.sessionManager.getCwd());
    scheduleRefresh(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("model_select", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("thinking_level_select", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("session_compact", (_event, ctx) => scheduleRefresh(ctx));
  pi.on("session_tree", (_event, ctx) => scheduleRefresh(ctx));
}

#!/usr/bin/env node
/**
 * Live mode-exclusivity checks: the rail and the footer are alternative
 * surfaces. The footer renders inside the main pane, so a mode check that
 * reads the render width shows both at once on a wide terminal (2.1.0 bug).
 *
 * usage: node test/footer-live.mjs <regular|fullscreen> <columns> <rail|auto|pin>
 */
import fs from "node:fs";
import path from "node:path";
import pty from "node-pty";

const [tuiMode = "regular", columnsText = "142", expectation = "rail"] = process.argv.slice(2);
const columns = Number(columnsText);
const rows = 30;
const packageRoot = path.dirname(fs.realpathSync(import.meta.filename));
for (const arch of ["darwin-arm64", "darwin-x64"]) {
  const helper = path.resolve(packageRoot, `../node_modules/node-pty/prebuilds/${arch}/spawn-helper`);
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
const outputPath = `/tmp/footer-live-${tuiMode}-${columns}-${expectation}.ansi`;
const piPath = fs.realpathSync(process.env.PI_BIN ?? "/opt/homebrew/bin/pi");
const child = pty.spawn(process.execPath, [
  piPath, "--no-extensions", "-e", path.resolve(packageRoot, "../message-sidebar.ts"),
  "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session",
  "--tui-mode", tuiMode,
], {
  name: "xterm-256color", cols: columns, rows, cwd: packageRoot,
  env: { ...process.env, PI_OFFLINE: "1", TERM: "xterm-256color" },
});
let output = "";
child.onData((data) => { output += data; });
child.onExit(({ exitCode }) => {
  fs.writeFileSync(outputPath, output);
  const clean = output.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const railAt = clean.lastIndexOf("MESSAGES");
  const footerHintAt = clean.lastIndexOf("[Ctrl+Shift+S] sidebar");
  const checks = {
    rail: [
      ["rail renders", railAt >= 0],
      ["footer never renders beside the rail", footerHintAt < 0],
      ["rail hint teaches footer mode", clean.includes("[Ctrl+Shift+S] footer")],
    ],
    auto: [
      ["footer renders", footerHintAt >= 0],
      ["rail never renders at a narrow terminal", railAt < 0],
      ["stream marker renders", clean.includes("»")],
    ],
    pin: [
      ["rail renders before the pin", railAt >= 0],
      ["footer renders after the last rail frame", footerHintAt > railAt],
    ],
  }[expectation];
  let failed = false;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
    if (!ok) failed = true;
  }
  if (failed) {
    console.error(`${tuiMode} @${columns} ${expectation} failed`);
    console.error(clean.slice(-3000));
  }
  process.exit(failed ? 1 : (exitCode ?? 0));
});
if (expectation === "pin") setTimeout(() => child.write("\x1b[115;6u"), 1500); // kitty CSI-u ctrl+shift+s
setTimeout(() => child.write("\x04"), 3500);
setTimeout(() => { child.kill("SIGTERM"); }, 5500);

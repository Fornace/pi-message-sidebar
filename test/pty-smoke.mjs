#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import pty from "node-pty";

const [mode = "regular", columnsText = "140", rowsText = "32"] = process.argv.slice(2);
const columns = Number(columnsText);
const rows = Number(rowsText);
const packageRoot = path.dirname(fs.realpathSync(import.meta.filename));
for (const helper of ["darwin-arm64", "darwin-x64"].map((arch) => path.resolve(packageRoot, `../node_modules/node-pty/prebuilds/${arch}/spawn-helper`))) {
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
const outputPath = `/tmp/pi-message-sidebar-${mode}-${columns}x${rows}.ansi`;
const piPath = fs.realpathSync(process.env.PI_BIN ?? "/opt/homebrew/bin/pi");
const nodePath = fs.realpathSync(process.execPath);
const args = [
  piPath,
  "--no-extensions",
  "-e", path.resolve("message-sidebar.ts"),
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--no-session",
  "--tui-mode", mode,
];
const child = pty.spawn(nodePath, args, {
  name: "xterm-256color",
  cols: columns,
  rows,
  cwd: process.cwd(),
  env: { ...process.env, PI_OFFLINE: "1", TERM: "xterm-256color" },
});
let output = "";
let finished = false;
child.onData((data) => { output += data; });
child.onExit(({ exitCode }) => {
  finished = true;
  fs.writeFileSync(outputPath, output);
  const clean = output.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  if (/uncaughtException|Rendered line|RangeError|TypeError:/.test(clean)) {
    console.error(clean.slice(-5000));
    process.exit(1);
  }
  if (columns >= 123 && !clean.includes("Messages")) {
    console.error("Wide smoke test never rendered the sidebar");
    process.exit(1);
  }
  if (columns < 123 && clean.includes("Messages")) {
    console.error("Narrow smoke test rendered the sidebar over the main pane");
    process.exit(1);
  }
  if (columns < 123 && !clean.includes("needs a terminal width")) {
    console.error("Narrow smoke test did not exercise responsive collapse");
    process.exit(1);
  }
  console.log(JSON.stringify({ mode, columns, rows, exitCode, outputPath, bytes: output.length }));
  process.exit(exitCode ?? 0);
});
if (columns >= 123) {
  setTimeout(() => child.resize(80, 24), 700);
  setTimeout(() => child.resize(columns, rows), 1200);
}
setTimeout(() => child.write("/sidebar\r"), 1700);
setTimeout(() => child.write("\x1b"), 2300);
setTimeout(() => child.write("\x04"), 2900);
setTimeout(() => {
  if (finished) return;
  child.kill("SIGTERM");
}, 5000);

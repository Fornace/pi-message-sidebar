#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import pty from "node-pty";

const columns = Number(process.argv[2] ?? 121);
const pinFooter = process.argv[3] === "pin";
const rows = 30;
const packageRoot = path.dirname(fs.realpathSync(import.meta.filename));
for (const helper of ["darwin-arm64", "darwin-x64"].map((arch) => path.resolve(packageRoot, `../node_modules/node-pty/prebuilds/${arch}/spawn-helper`))) {
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
const outputPath = `/tmp/footer-live-${columns}${pinFooter ? "-pinned" : ""}.ansi`;
const piPath = fs.realpathSync(process.env.PI_BIN ?? "/opt/homebrew/bin/pi");
const child = pty.spawn(process.execPath, [piPath, "--no-extensions", "-e", path.resolve("message-sidebar.ts"), "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-session", "--tui-mode", "regular"], {
  name: "xterm-256color", cols: columns, rows, cwd: process.cwd(),
  env: { ...process.env, PI_OFFLINE: "1", TERM: "xterm-256color" },
});
let output = "";
child.onData((data) => { output += data; });
child.onExit(({ exitCode }) => {
  fs.writeFileSync(outputPath, output);
  const clean = output.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const footerHintAt = clean.lastIndexOf("[Ctrl+Shift+S] sidebar");
  const railAt = clean.lastIndexOf("MESSAGES");
  const checks = [
    ["footer renders", footerHintAt >= 0],
    ["stream marker", clean.includes("»")],
  ];
  if (pinFooter) {
    checks.push(["rail rendered before the pin", railAt >= 0]);
    checks.push(["footer is the live surface after the pin", footerHintAt > railAt]);
  } else {
    checks.push(["auto collapse: no rail at all", railAt < 0]);
  }
  let failed = false;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
    if (!ok) failed = true;
  }
  if (failed) console.error(clean.slice(-3000));
  process.exit(failed ? 1 : (exitCode ?? 0));
});
if (pinFooter) setTimeout(() => child.write("\x13"), 1500); // ctrl+shift+s pins the footer
setTimeout(() => child.write("\x04"), 3500);
setTimeout(() => { child.kill("SIGTERM"); }, 5500);

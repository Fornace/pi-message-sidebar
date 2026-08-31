import assert from "node:assert/strict";

const handlers = new Map();
const commands = new Map();
const shortcuts = new Map();
const pi = {
  on(event, handler) { handlers.set(event, handler); },
  registerCommand(name, command) { commands.set(name, command); },
  registerShortcut(key, shortcut) { shortcuts.set(key, shortcut); },
  getThinkingLevel() { return "high"; },
};

const extension = await import("../index.ts");
extension.default(pi);
assert.ok(handlers.has("session_start"));
assert.ok(commands.has("sidebar"));
assert.ok(shortcuts.has("ctrl+shift+h"));
console.log("extension entrypoint loaded");

#!/usr/bin/env bun
/**
 * rethocker CLI
 *
 * Usage:
 *   rethocker <command>
 *
 * Commands: install | uninstall | restart | status | log | help
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runLog } from "./scripts/log.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB = "https://github.com/benjamine/rethocker";
const AGENT_LABEL = "com.rethocker.default";
const AGENT_DOMAIN = `gui/${process.getuid?.() ?? 501}`;

const CONFIG_DIR = join(homedir(), ".config", "rethocker");
const CONFIG_FILE = join(CONFIG_DIR, "default.ts");
const PLIST_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_FILE = join(PLIST_DIR, `${AGENT_LABEL}.plist`);
const LOG_FILE = join(homedir(), "Library", "Logs", "rethocker.log");

// ─── Templates ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = `#!/usr/bin/env bun
/**
 * rethocker config
 *
 * Edit this file to set up your keyboard rules.
 * Changes are picked up automatically — rethocker restarts when you save.
 * Docs & examples: ${GITHUB}
 */

import { rethocker, actions, Key } from "rethocker";

const rk = rethocker([
  // ── Add your rules here ───────────────────────────────────────────
  //
  // Remap Caps Lock → Escape:
  // { key: Key.capsLock, remap: Key.escape },
  //
  // Run a shell command on a key combo:
  // { key: "Cmd+Shift+S", execute: actions.app.focus("Slack") },
  //
  // Call a TypeScript function:
  // { key: "F1", handler: (e) => console.log("F1 pressed", e) },
  //
  // Restrict a rule to a specific app:
  // { key: "Ctrl+J", execute: "echo hello", app: "iTerm2" },
  //
  // ─────────────────────────────────────────────────────────────────
]);

await rk.start();
`;

function makePlist(
  cliPath: string,
  configFile: string,
  logFile: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${AGENT_LABEL}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${cliPath}</string>
        <string>--run-config</string>
        <string>${configFile}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>WatchPaths</key>
    <array>
        <string>${configFile}</string>
    </array>

    <key>StandardOutPath</key>
    <string>${logFile}</string>

    <key>StandardErrorPath</key>
    <string>${logFile}</string>
</dict>
</plist>
`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tildeify(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function run(cmd: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  return {
    ok: result.exitCode === 0,
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr).trim(),
  };
}

function findBun(): string {
  const fromPath = run(["which", "bun"]).stdout;
  if (fromPath) return fromPath;
  const fallback = join(homedir(), ".bun", "bin", "bun");
  if (existsSync(fallback)) return fallback;
  console.error("Could not find bun. Please install it from https://bun.sh");
  process.exit(1);
}

function bootstrapAgent(): void {
  // bootout first (no-op if not loaded)
  run(["launchctl", "bootout", AGENT_DOMAIN, PLIST_FILE]);
  const result = run(["launchctl", "bootstrap", AGENT_DOMAIN, PLIST_FILE]);
  if (!result.ok) {
    console.error(`Failed to load agent: ${result.stderr}`);
    process.exit(1);
  }
}

function bootoutAgent(): void {
  run(["launchctl", "bootout", AGENT_DOMAIN, PLIST_FILE]);
}

// ─── --run-config (internal, used by LaunchAgent) ─────────────────────────────
// Spawns the user's config via bun, pipes stderr to the log file, and sends
// a macOS notification if it crashes.

async function cmdRunConfig(configFile: string) {
  const bunBin = findBun();
  const stderrChunks: string[] = [];

  const child = Bun.spawn([bunBin, configFile], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "pipe",
  });

  // Stream stderr through (lands in log file via LaunchAgent) and buffer it
  (async () => {
    const reader = child.stderr.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value);
      process.stderr.write(chunk);
      stderrChunks.push(chunk);
    }
  })();

  const code = await child.exited;

  if (code !== 0) {
    const detail =
      stderrChunks.join("").trim().slice(-200).replace(/"/g, "'") ||
      `See ${tildeify(LOG_FILE)} for details.`;
    const script = `display notification "${detail}" with title "rethocker" subtitle "Config error — fix and save to reload"`;
    Bun.spawnSync(["osascript", "-e", script]);
  }

  process.exit(code ?? 1);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: rethocker <command>

Commands:
  install     Scaffold a config file and set up a background agent that
              starts on login and auto-reloads when the config is saved
  uninstall   Stop the background agent and remove it (keeps your config)
  restart     Restart the background agent
  status      Show whether the background agent is running
  log         Live key monitor — shows keypresses in rethocker rule syntax
              so you can copy-paste them directly into your config
  help        Print this help message

Install via Homebrew:
  brew tap benjamine/tap
  brew install rethocker
  rethocker install

Docs: ${GITHUB}
`.trim();

// ─── Command dispatch ─────────────────────────────────────────────────────────

const [, , subcommand, ...rest] = process.argv;

switch (subcommand) {
  case "log":
    await runLog();
    break;

  case "--run-config":
    if (!rest[0]) {
      console.error("Usage: rethocker --run-config <configFile>");
      process.exit(1);
    }
    await cmdRunConfig(rest[0]);
    break;

  case "install":
    cmdInstall();
    break;

  case "uninstall":
    cmdUninstall();
    break;

  case "restart":
    cmdRestart();
    break;

  case "status":
    cmdStatus();
    break;

  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    break;

  default:
    if (subcommand) console.error(`Unknown command: "${subcommand}"\n`);
    console.log(HELP);
    process.exit(subcommand ? 1 : 0);
}

// ─── install ──────────────────────────────────────────────────────────────────

function cmdInstall() {
  // Scaffold config dir
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PLIST_DIR)) mkdirSync(PLIST_DIR, { recursive: true });

  // Scaffold default.ts (skip if exists — user may have edited it)
  if (existsSync(CONFIG_FILE)) {
    console.log(
      `Config already exists — leaving it untouched:\n  ${tildeify(CONFIG_FILE)}`,
    );
  } else {
    writeFileSync(CONFIG_FILE, DEFAULT_CONFIG, { mode: 0o755 });
    console.log(`Created config:\n  ${tildeify(CONFIG_FILE)}`);
  }

  // Write plist — LaunchAgent calls `rethocker --run-config <configFile>`
  // process.execPath is the rethocker binary itself (resolved at runtime)
  writeFileSync(PLIST_FILE, makePlist(process.execPath, CONFIG_FILE, LOG_FILE));
  console.log(`Created LaunchAgent:\n  ${tildeify(PLIST_FILE)}`);

  // Load agent
  bootstrapAgent();
  console.log("Background agent loaded and running.");

  const editor = process.env.EDITOR ?? process.env.VISUAL ?? "your editor";
  console.log(`
Open your config to start setting up rules:
  ${editor} ${tildeify(CONFIG_FILE)}

rethocker runs in the background and reloads automatically when you save.
Logs: ${tildeify(LOG_FILE)}
Docs: ${GITHUB}
`);
}

// ─── uninstall ────────────────────────────────────────────────────────────────

function cmdUninstall() {
  if (!existsSync(PLIST_FILE)) {
    console.log("No LaunchAgent found — nothing to uninstall.");
    process.exit(0);
  }
  bootoutAgent();
  console.log("Background agent stopped.");
  const { unlinkSync } = require("node:fs") as typeof import("node:fs");
  unlinkSync(PLIST_FILE);
  console.log(`Removed: ${tildeify(PLIST_FILE)}`);
  console.log(`\nYour config is untouched at: ${tildeify(CONFIG_FILE)}`);
  console.log('Run "rethocker install" to set it up again.');
}

// ─── restart ──────────────────────────────────────────────────────────────────

function cmdRestart() {
  if (!existsSync(PLIST_FILE)) {
    console.error('Agent not installed. Run "rethocker install" first.');
    process.exit(1);
  }
  const result = run([
    "launchctl",
    "kickstart",
    "-k",
    `${AGENT_DOMAIN}/${AGENT_LABEL}`,
  ]);
  if (result.ok) {
    console.log("rethocker restarted.");
  } else {
    bootstrapAgent();
    console.log("rethocker started.");
  }
}

// ─── status ───────────────────────────────────────────────────────────────────

function cmdStatus() {
  if (!existsSync(PLIST_FILE)) {
    console.log("Status: not installed");
    console.log('Run "rethocker install" to set up the background agent.');
    process.exit(0);
  }

  const result = run(["launchctl", "print", `${AGENT_DOMAIN}/${AGENT_LABEL}`]);
  if (!result.ok) {
    console.log("Status: installed but not running");
    console.log('Run "rethocker restart" to start it.');
    process.exit(0);
  }

  const pidMatch = result.stdout.match(/pid\s*=\s*(\d+)/);
  const pid = pidMatch?.[1] ?? null;
  const stateMatch = result.stdout.match(/state\s*=\s*(\w+)/);
  const state = stateMatch?.[1] ?? "running";

  console.log(`Status: ${state}${pid ? ` (pid ${pid})` : ""}`);
  console.log(`Config: ${tildeify(CONFIG_FILE)}`);
  console.log(`Logs:   ${tildeify(LOG_FILE)}`);
}

/**
 * rethocker() — the main entry point.
 *
 * Wires together the daemon, rule engine, and rule registration into
 * the public RethockerHandle interface.
 */

import { dirname, join } from "node:path";
import { createDaemon } from "./daemon.ts";
import { registerRule } from "./register-rule.ts";
import type {
  RethockerHandle,
  RethockerOptions,
  RethockerRule,
} from "./rule-types.ts";
import type { RethockerEvents, RuleHandle, SequenceHandle } from "./types.ts";

export type {
  HandlerRule,
  RemapRule,
  RethockerHandle,
  RethockerOptions,
  RethockerRule,
  ShellRule,
} from "./rule-types.ts";

/**
 * Create a rethocker instance with an optional initial set of rules.
 * The native daemon starts automatically in the background.
 *
 * @example
 * const rk = rethocker([
 *   { key: "capsLock",        remap: "escape" },
 *   { key: "Cmd+Shift+Space", execute: "open -a 'Alfred 5'" },
 *   { key: "Ctrl+J Ctrl+K",  handler: () => console.log("sequence!"), consume: true },
 * ])
 *
 * rk.on("accessibilityDenied", () => { ... })
 * rk.disable()   // pause all rules
 * rk.enable()    // resume all rules
 */
export function rethocker(
  rules: RethockerRule | RethockerRule[] = [],
  options: RethockerOptions = {},
): RethockerHandle {
  // In a compiled binary, import.meta.dir is a virtual path (/$bunfs/root).
  // Use process.execPath to find rethocker-native next to the real executable.
  // In dev/npm mode, import.meta.dir points to src/ so we go up one level to bin/.
  const isCompiled = import.meta.dir.startsWith("/$bunfs");
  const binaryPath =
    options.binaryPath ??
    (isCompiled
      ? join(dirname(process.execPath), "rethocker-native")
      : join(import.meta.dir, "..", "bin", "rethocker-native"));

  const daemon = createDaemon(binaryPath);

  // ─── Rule handles ─────────────────────────────────────────────────────────
  const handles = new Map<string, RuleHandle | SequenceHandle>();

  // Start daemon in background; errors surface via rk.on("error") or await rk.start()
  // Silent — errors surface via rk.on("error") or await rk.start()
  daemon.start().catch((_e: unknown) => {
    /* intentional */
  });

  function add(toAdd: RethockerRule | RethockerRule[]): void {
    const list = Array.isArray(toAdd) ? toAdd : [toAdd];
    for (const rule of list) {
      const handle = registerRule(daemon.send, daemon.emitter, rule);
      handles.set(handle.id, handle);
    }
  }

  add(rules);

  return {
    add,

    remove(id: string): void {
      handles.get(id)?.remove();
      handles.delete(id);
    },

    enable(id?: string): void {
      if (id !== undefined) {
        handles.get(id)?.enable();
      } else {
        for (const h of handles.values()) h.enable();
      }
    },

    disable(id?: string): void {
      if (id !== undefined) {
        handles.get(id)?.disable();
      } else {
        for (const h of handles.values()) h.disable();
      }
    },

    on<K extends keyof RethockerEvents>(
      event: K,
      listener: (...args: RethockerEvents[K]) => void,
    ): () => void {
      daemon.emitter.on(event, listener);
      if (event === "key") daemon.send({ cmd: "listen_all", enabled: true });
      return () => {
        daemon.emitter.off(event, listener);
        if (event === "key" && daemon.emitter.listenerCount("key") === 0) {
          daemon.send({ cmd: "listen_all", enabled: false });
        }
      };
    },

    async execute(command: string | string[]): Promise<void> {
      const cmd = Array.isArray(command) ? command.join(" && ") : command;
      const proc = Bun.spawn(["/bin/sh", "-c", cmd], {
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    },

    start: () => daemon.start(),
    stop: () => daemon.stop(),
    unref: () => daemon.unref(),
    get ready() {
      return daemon.ready;
    },
  };
}

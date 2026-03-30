/**
 * Daemon — manages the native rethocker-native subprocess lifecycle and IPC.
 *
 * Responsibilities:
 *   - Spawn / stop the native binary
 *   - Buffer commands sent before ready, flush on startup
 *   - Parse newline-delimited JSON from stdout and emit typed events
 *   - Pipe stderr to process.stderr for visibility
 *
 * This module knows nothing about rules — it only speaks raw IPC JSON.
 */

import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type { KeyEvent, RethockerEvents } from "./types.ts";

// ─── Typed EventEmitter (internal, never exported) ────────────────────────────

type Listener = (...args: unknown[]) => void;

export class TypedEmitter extends EventEmitter {
  override on<K extends keyof RethockerEvents>(
    event: K,
    listener: (...args: RethockerEvents[K]) => void,
  ): this {
    return super.on(event as string, listener as Listener);
  }
  override once<K extends keyof RethockerEvents>(
    event: K,
    listener: (...args: RethockerEvents[K]) => void,
  ): this {
    return super.once(event as string, listener as Listener);
  }
  override off<K extends keyof RethockerEvents>(
    event: K,
    listener: (...args: RethockerEvents[K]) => void,
  ): this {
    return super.off(event as string, listener as Listener);
  }
  override emit<K extends keyof RethockerEvents>(
    event: K,
    ...args: RethockerEvents[K]
  ): boolean {
    return super.emit(event as string, ...args);
  }
}

// ─── Daemon ───────────────────────────────────────────────────────────────────

export interface Daemon {
  readonly emitter: TypedEmitter;
  /** Send a raw IPC command. Buffered if the daemon isn't ready yet. */
  send(obj: Record<string, unknown>): void;
  /** Start the daemon. Returns the same promise on concurrent calls. */
  start(): Promise<void>;
  stop(): Promise<void>;
  unref(): void;
  readonly ready: boolean;
}

export function createDaemon(binaryPath: string): Daemon {
  const emitter = new TypedEmitter();
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  let _ready = false;
  let buffer = "";
  let sendQueue: string[] = [];
  let pendingReady: Array<{ resolve: () => void; reject: (e: Error) => void }> =
    [];
  let startPromise: Promise<void> | null = null;

  // ─── Rule registry (for replay on daemon restart) ─────────────────────────
  // Stores the JSON payload of every active add_rule / add_sequence command,
  // keyed by rule ID. Updated on remove and set_enabled so replayed rules
  // reflect the current state (not the original registration state).

  const ruleRegistry = new Map<string, Record<string, unknown>>();
  let listenAllEnabled = false;
  let isFirstStart = true;

  function trackSend(obj: Record<string, unknown>): void {
    const cmd = obj.cmd as string | undefined;
    if (cmd === "add_rule" || cmd === "add_sequence") {
      ruleRegistry.set(obj.id as string, obj);
    } else if (cmd === "remove_rule" || cmd === "remove_sequence") {
      ruleRegistry.delete(obj.id as string);
    } else if (cmd === "set_rule_enabled" || cmd === "set_sequence_enabled") {
      const stored = ruleRegistry.get(obj.id as string);
      if (stored) stored.enabled = obj.enabled;
    } else if (cmd === "listen_all") {
      listenAllEnabled = obj.enabled as boolean;
    }
  }

  // ─── Send / queue ─────────────────────────────────────────────────────────

  function send(obj: Record<string, unknown>): void {
    trackSend(obj);
    const line = `${JSON.stringify(obj)}\n`;
    if (!_ready) {
      sendQueue.push(line);
      return;
    }
    proc?.stdin.write(line);
  }

  function flushQueue(): void {
    // On restart (not the first start), replay all registered rules first so
    // the new daemon instance is back in the same state as before the crash.
    if (!isFirstStart) {
      for (const payload of ruleRegistry.values()) {
        proc?.stdin.write(`${JSON.stringify(payload)}\n`);
      }
      if (listenAllEnabled) {
        proc?.stdin.write(
          `${JSON.stringify({ cmd: "listen_all", enabled: true })}\n`,
        );
      }
    }
    isFirstStart = false;
    for (const line of sendQueue) proc?.stdin.write(line);
    sendQueue = [];
  }

  // ─── Message parsing ──────────────────────────────────────────────────────

  function handleMessage(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.type) {
      case "ready":
        _ready = true;
        flushQueue();
        for (const p of pendingReady) p.resolve();
        pendingReady = [];
        emitter.emit("ready");
        break;
      case "keydown":
      case "keyup":
      case "flags":
        emitter.emit("key", msg as unknown as KeyEvent);
        break;
      case "matched":
        if (msg.eventID) {
          emitter.emit("event", msg.eventID as string, msg.ruleID as string);
        }
        break;
      case "sequence_matched":
        emitter.emit(
          "sequence",
          msg.ruleID as string,
          msg.eventID as string | undefined,
        );
        break;

      case "error":
        if (msg.code === "accessibility_denied") {
          emitter.emit("accessibilityDenied");
        } else {
          emitter.emit("error", msg.code as string, msg.message as string);
        }
        break;
    }
  }

  // ─── Read loops ───────────────────────────────────────────────────────────

  async function readStdout(): Promise<void> {
    const reader = proc?.stdout.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) handleMessage(line);
        }
      }
    } catch {
      // process exited — handled by the exited promise
    }
  }

  async function readStderr(): Promise<void> {
    const reader = proc?.stderr.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim()) process.stderr.write(`[rethocker-native] ${line}\n`);
        }
      }
    } catch {
      // process exited
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  function start(): Promise<void> {
    if (startPromise) return startPromise;

    startPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("rethocker-native startup timed out after 10s"));
      }, 10_000);

      pendingReady.push({
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });

      if (!existsSync(binaryPath)) {
        const err = new Error(
          `rethocker-native binary not found at: ${binaryPath}\n` +
            `  If installed via Homebrew, try: brew reinstall rethocker\n` +
            `  If installed via npm/bun, try: bun add rethocker\n` +
            `  You can also override the path with: rethocker(rules, { binaryPath: "..." })`,
        );
        clearTimeout(timeout);
        reject(err);
        startPromise = null;
        return;
      }

      proc = Bun.spawn({
        cmd: [binaryPath],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      readStdout();
      readStderr();

      proc.exited.then((code) => {
        _ready = false;
        startPromise = null;
        emitter.emit("exit", code);
        const err = new Error(
          `rethocker-native exited unexpectedly (code ${code})`,
        );
        for (const p of pendingReady) p.reject(err);
        pendingReady = [];
      });
    });

    return startPromise;
  }

  async function stop(): Promise<void> {
    _ready = false;
    startPromise = null;
    proc?.kill();
    await proc?.exited;
    proc = null;
  }

  function unref(): void {
    proc?.unref();
  }

  return {
    emitter,
    send,
    start,
    stop,
    unref,
    get ready() {
      return _ready;
    },
  };
}

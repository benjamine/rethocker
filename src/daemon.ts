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

  // ─── Send / queue ─────────────────────────────────────────────────────────

  function send(obj: Record<string, unknown>): void {
    const line = `${JSON.stringify(obj)}\n`;
    if (!_ready) {
      sendQueue.push(line);
      return;
    }
    proc?.stdin.write(line);
  }

  function flushQueue(): void {
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

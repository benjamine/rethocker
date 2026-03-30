/**
 * Public-facing rule type definitions for the high-level rethocker() API.
 *
 * Three discriminated variants — TypeScript narrows to the correct set of
 * fields based on which discriminant key is present, giving users precise
 * autocomplete for each rule type.
 */

import type { KeyEvent, RethockerEvents, RuleConditions } from "./types.ts";

// ─── Rule variants ────────────────────────────────────────────────────────────

/** Common fields available on every rule. */
interface RuleBase {
  /**
   * The key or key sequence that triggers this rule.
   *
   * Single key:  `"escape"` | `"Cmd+A"` | `"Cmd+Shift+K"`
   * Sequence:    `"Cmd+R T"` | `"Ctrl+J Ctrl+K"` (space-separated steps)
   *
   * Modifier names are case-insensitive: Cmd, Shift, Alt/Opt/Option, Ctrl/Control, Fn
   * Key names match the `Key` constant (also case-insensitive).
   * Common aliases: esc, enter, backspace, del, caps
   */
  key: string;
  /** Optional stable ID. Auto-generated if omitted. */
  id?: string;
  /**
   * Restrict this rule to fire only when one of these apps is frontmost.
   *
   * Pass a bundle ID (contains a dot) or a display name (prefix match,
   * case-insensitive). Multiple values are OR-ed.
   *
   * Auto-detection: `"com.figma.Desktop"` → bundle ID, `"Figma"` → display name.
   *
   * @example
   * app: "com.figma.Desktop"
   * app: "Terminal"
   * app: ["Safari", "Chrome", "Firefox"]
   */
  app?: string | string[];
  /**
   * Restrict this rule based on whether a text input field is focused.
   * - `true`  → fire only when a text field IS focused
   * - `false` → fire only when NO text field is focused
   * Omit to fire regardless of text input state.
   *
   * @example
   * // Only fire when NOT in a text field (safe global shortcut)
   * { key: "Ctrl+J", handler: () => {}, textInput: false }
   */
  textInput?: boolean;
  /** Advanced: full condition control. Merged with `app` and `textInput` if both provided. */
  conditions?: RuleConditions;
  /** Start the rule disabled. */
  disabled?: boolean;
}

/** Remap a key to a different key. */
export interface RemapRule extends RuleBase {
  /**
   * The key to emit instead. Same syntax as `key`:
   * `"escape"` | `"Cmd+Enter"` etc.
   */
  remap: string;
  execute?: never;
  handler?: never;
  consume?: never;
  sequenceTimeoutMs?: never;
}

/** Run a shell command (or multiple) when the key fires. The key is consumed. */
export interface ShellRule extends RuleBase {
  /**
   * Shell command to run (via `/bin/sh -c`).
   * Pass an array to run multiple commands sequentially — they are joined with `&&`.
   *
   * @example
   * execute: actions.window.halfLeft()
   * execute: [actions.window.halfLeft(), actions.app.focus("Slack")]
   */
  execute: string | string[];
  /**
   * For sequences: consume all intermediate key events so they never reach
   * the active app. Single-key execute rules always consume the trigger key.
   * @default false
   */
  consume?: boolean;
  /**
   * For sequences: max ms between consecutive steps.
   * @default DEFAULT_SEQUENCE_TIMEOUT_MS (5000)
   */
  sequenceTimeoutMs?: number;
  remap?: never;
  handler?: never;
}

/** Call a TypeScript handler when the key fires. The key is consumed. */
export interface HandlerRule extends RuleBase {
  /** Called when the key fires. */
  handler: (event: KeyEvent) => void;
  /**
   * For sequences: consume all intermediate key events.
   * @default false
   */
  consume?: boolean;
  /**
   * For sequences: max ms between consecutive steps.
   * @default DEFAULT_SEQUENCE_TIMEOUT_MS (5000)
   */
  sequenceTimeoutMs?: number;
  remap?: never;
  execute?: never;
}

export type RethockerRule = RemapRule | ShellRule | HandlerRule;

// ─── Public handle ────────────────────────────────────────────────────────────

export interface RethockerHandle {
  /** Add one or more rules. */
  add(rules: RethockerRule | RethockerRule[]): void;
  /** Remove a rule permanently by ID. */
  remove(id: string): void;
  /**
   * Enable rules.
   * - No argument: enable all rules on this handle.
   * - With id: enable a specific rule by ID.
   */
  enable(id?: string): void;
  /**
   * Disable rules without removing them.
   * - No argument: disable all rules on this handle.
   * - With id: disable a specific rule by ID.
   */
  disable(id?: string): void;
  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * Subscribing to `"key"` automatically activates the key stream.
   */
  on<K extends keyof RethockerEvents>(
    event: K,
    listener: (...args: RethockerEvents[K]) => void,
  ): () => void;
  /**
   * Run a shell command (or multiple) immediately, outside of any rule.
   * Accepts the same value as the `execute` field on a rule.
   * Returns a promise that resolves when the command exits.
   *
   * @example
   * await rk.execute(actions.media.playPause())
   * await rk.execute([actions.window.halfLeft(), actions.app.focus("Slack")])
   *
   * // Inside a handler:
   * { key: "Ctrl+J", handler: async () => { await rk.execute(actions.system.sleep()) } }
   */
  execute(command: string | string[]): Promise<void>;

  /** Stop the native daemon and clean up. */
  stop(): Promise<void>;
  /**
   * Allow the process to exit while the daemon is running.
   * By default rethocker keeps the event loop alive.
   */
  unref(): void;
  /**
   * Await daemon readiness. Optional — the daemon starts automatically.
   * Useful for explicitly handling startup errors.
   */
  start(): Promise<void>;
  /** Whether the daemon is running and ready. */
  readonly ready: boolean;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RethockerOptions {
  /** Override the path to the native binary. Defaults to the bundled binary. */
  binaryPath?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default timeout between consecutive key presses in a sequence. */
export const DEFAULT_SEQUENCE_TIMEOUT_MS = 5000;

// ─── Modifiers ───────────────────────────────────────────────────────────────

export type Modifier =
  | "cmd"
  | "shift"
  | "alt"
  | "ctrl"
  | "fn"
  | "leftCmd"
  | "rightCmd"
  | "leftShift"
  | "rightShift"
  | "leftAlt"
  | "rightAlt"
  | "leftCtrl"
  | "rightCtrl";

// ─── Key combo ───────────────────────────────────────────────────────────────

export interface KeyCombo {
  /** macOS virtual key code (e.g. 0 = A, 36 = Return, 53 = Escape) */
  keyCode: number;
  modifiers?: Modifier[];
}

// ─── App conditions ──────────────────────────────────────────────────────────

export interface AppCondition {
  /** Match by bundle ID (exact), e.g. "com.apple.Terminal" */
  bundleID?: string;
  /** Match by app display name (prefix, case-insensitive), e.g. "Terminal" */
  name?: string;
  /** If true, invert the match (i.e. "not this app") */
  invert?: boolean;
}

export interface RuleConditions {
  /**
   * Rule fires only when one of these apps is frontmost.
   * Items are OR-ed; omit for any app.
   */
  activeApp?: AppCondition[];
  /**
   * Rule fires only when one of these apps is currently running.
   * Items are OR-ed; omit to not care.
   */
  runningApps?: AppCondition[];
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Eat the keypress silently */
export interface SuppressAction {
  type: "suppress";
}

/** Replace the keypress with a different key combo */
export interface RemapAction {
  type: "remap";
  keyCode: number;
  modifiers?: Modifier[];
}

/** Replace the keypress with a sequence of key combos posted in order */
export interface RemapSequenceAction {
  type: "remap_sequence";
  steps: Array<{ keyCode: number; modifiers?: Modifier[] }>;
}

/** Run a shell command (key is suppressed) */
export interface RunAction {
  type: "run";
  command: string;
}

/**
 * Suppress the key and emit a named event on the rethocker instance.
 * Use this to react in TypeScript without spawning a shell.
 */
export interface EmitAction {
  type: "emit";
  eventID: string;
}

export type RuleAction =
  | SuppressAction
  | RemapAction
  | RemapSequenceAction
  | RunAction
  | EmitAction;

// ─── Rule options ─────────────────────────────────────────────────────────────

export interface RuleOptions {
  /** Unique ID. Auto-generated if omitted. */
  id?: string;
  conditions?: RuleConditions;
  /** If true, fire on key-up instead of key-down (only valid for suppress/emit) */
  onKeyUp?: boolean;
  /** Start disabled */
  disabled?: boolean;
}

export interface SequenceOptions {
  /** Unique ID. Auto-generated if omitted. */
  id?: string;
  /**
   * Max milliseconds between consecutive key presses in the sequence.
   * @default DEFAULT_SEQUENCE_TIMEOUT_MS (5000)
   */
  timeoutMs?: number;
  conditions?: Pick<RuleConditions, "activeApp">;
  /**
   * When true, all key events that are part of the sequence are consumed —
   * they never reach the active app. Intermediate steps and the final key are
   * all consumed, regardless of the action type.
   * @default false
   */
  consume?: boolean;
  /** Start disabled */
  disabled?: boolean;
}

// ─── Handles (returned to callers) ───────────────────────────────────────────

/** Returned by addRule() and intercept(). */
export interface RuleHandle {
  readonly id: string;
  /** Remove the rule permanently. */
  remove(): void;
  /** Enable the rule (no-op if already enabled). */
  enable(): void;
  /** Disable the rule without removing it. */
  disable(): void;
}

/** Returned by addSequence(). Same shape as RuleHandle. */
export interface SequenceHandle {
  readonly id: string;
  remove(): void;
  enable(): void;
  disable(): void;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export interface KeyEvent {
  type: "keydown" | "keyup" | "flags";
  keyCode: number;
  modifiers: Modifier[];
  /** Set when the event was matched by a rule */
  ruleID?: string;
  /** Set for emit-action rules */
  eventID?: string;
  suppressed: boolean;
  /** Display name of the frontmost app at the time of the event */
  app?: string;
  /** Bundle ID of the frontmost app at the time of the event */
  appBundleID?: string;
}

/** Map of event name → tuple of listener argument types */
export interface RethockerEvents {
  /** Native daemon is ready */
  ready: [];
  /** Every key event when listening is active */
  key: [event: KeyEvent];
  /** A rule with action.type="emit" fired */
  event: [eventID: string, ruleID: string];
  /** A sequence rule matched */
  sequence: [ruleID: string, eventID: string | undefined];
  /** Error from the native daemon */
  error: [code: string, message: string];
  /** Accessibility permission denied */
  accessibilityDenied: [];
  /** Native process exited unexpectedly */
  exit: [code: number | null];
}

// ─── Public instance type ─────────────────────────────────────────────────────

export interface RethockerInstance {
  // Lifecycle
  /**
   * Await daemon readiness. The daemon starts automatically in the background
   * when the instance is created, so this is optional. Call it explicitly if
   * you want to handle startup errors (e.g. Accessibility permission denied).
   */
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly ready: boolean;

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   *
   * Subscribing to `"key"` automatically activates the key stream from the
   * native daemon. When the last `"key"` listener is removed (via the returned
   * unsubscribe function), the stream is deactivated automatically — so there
   * is no overhead when nothing is listening.
   *
   * @example
   * const off = instance.on("key", (e) => console.log(e))
   * off() // unsubscribe — stream stops if this was the last listener
   */
  on<K extends keyof RethockerEvents>(
    event: K,
    listener: (...args: RethockerEvents[K]) => void,
  ): () => void;

  /**
   * Add a key interception rule.
   * @example
   * const rule = instance.addRule(
   *   { keyCode: 0, modifiers: ["cmd"] },
   *   { type: "suppress" },
   * )
   * rule.disable() // temporarily disable
   * rule.remove()  // remove permanently
   */
  addRule(
    trigger: KeyCombo,
    action: RuleAction,
    options?: RuleOptions,
  ): RuleHandle;

  /**
   * Intercept a key combo and call a TypeScript handler.
   * Shorthand for addRule with type:"emit" + on("event").
   * @example
   * const rule = instance.intercept({ keyCode: 0, modifiers: ["cmd"] }, (e) => {
   *   console.log("intercepted Cmd+A")
   * })
   */
  intercept(
    trigger: KeyCombo,
    handler: (event: KeyEvent) => void,
    options?: RuleOptions,
  ): RuleHandle;

  /**
   * Add a key sequence rule. Fires when combos are pressed in order within the timeout.
   * @example
   * const seq = instance.addSequence(
   *   [{ keyCode: 38, modifiers: ["ctrl"] }, { keyCode: 40, modifiers: ["ctrl"] }],
   *   { type: "emit", eventID: "leader" },
   * )
   */
  addSequence(
    steps: KeyCombo[],
    action: RuleAction,
    options?: SequenceOptions,
  ): SequenceHandle;

  /**
   * Allow the process to exit even while the daemon is running. By default,
   * rethocker keeps the event loop alive (so a script with only key rules
   * doesn't exit immediately). Call `unref()` if you want process exit to be
   * determined by your own code, not the daemon's lifetime.
   *
   * The native binary cleans itself up automatically when the parent process
   * exits, so no explicit `stop()` is needed in that case.
   */
  unref(): void;

  /**
   * Explicitly activate the key event stream (all keypresses emitted on `"key"`).
   * Not needed if you use `on("key", ...)` — that activates the stream automatically.
   * Useful for temporarily pausing the stream without removing listeners.
   */
  startListening(): void;
  stopListening(): void;
}

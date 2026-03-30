#!/usr/bin/env bun

/**
 * rethocker log
 *
 * Live key monitor: shows every keypress in rethocker rule syntax so you can
 * copy-paste directly into your config. Keys pressed in quick succession appear
 * on the same line separated by spaces (like a sequence trigger). A new line
 * starts after 3 seconds of silence.
 *
 * Run with:
 *   bunx rethocker log
 */

import { KEY_CODE_MAP, Key } from "../keys.ts";
import { rethocker } from "../rethocker.ts";
import type { KeyEvent, Modifier } from "../types.ts";

// ─── Reverse map: keyCode → Key name ─────────────────────────────────────────

const CODE_TO_KEY: Map<number, string> = new Map(
  Object.entries(KEY_CODE_MAP).map(([name, code]) => [code, name]),
);

// KEY_CODE_MAP has lowercase keys (e.g. "capslock") but Key has camelCase
// ("capsLock"). Build a lookup from lowercase → camelCase Key name.
const LOWER_TO_KEY_NAME: Map<string, string> = new Map(
  Object.keys(Key).map((k) => [k.toLowerCase(), k]),
);

function keyCodeToName(code: number): string | null {
  const lower = CODE_TO_KEY.get(code);
  if (!lower) return null;
  return LOWER_TO_KEY_NAME.get(lower) ?? lower;
}

// ─── Modifier display ─────────────────────────────────────────────────────────

// Maps each modifier to its display label, preserving side-specificity.
// When a side-specific modifier is present (e.g. leftCmd), we show "LeftCmd"
// rather than the generic "Cmd" — so the output is copy-pasteable as a rule.
const MODIFIER_LABEL: Record<Modifier, string> = {
  cmd: "Cmd",
  shift: "Shift",
  alt: "Alt",
  ctrl: "Ctrl",
  fn: "Fn",
  leftCmd: "LeftCmd",
  rightCmd: "RightCmd",
  leftShift: "LeftShift",
  rightShift: "RightShift",
  leftAlt: "LeftAlt",
  rightAlt: "RightAlt",
  leftCtrl: "LeftCtrl",
  rightCtrl: "RightCtrl",
};

// Order in which modifiers appear in the display string (conventional).
const MODIFIER_ORDER: Modifier[] = [
  "leftCtrl",
  "rightCtrl",
  "ctrl",
  "leftAlt",
  "rightAlt",
  "alt",
  "leftShift",
  "rightShift",
  "shift",
  "leftCmd",
  "rightCmd",
  "cmd",
  "fn",
];

function formatModifiers(modifiers: Modifier[]): string[] {
  const mods = new Set(modifiers);
  // If a side-specific modifier is present, suppress the generic one to avoid
  // "LeftCmd+Cmd+A" — macOS always sends both, but we only want the specific.
  const suppress = new Set<Modifier>();
  if (mods.has("leftCmd") || mods.has("rightCmd")) suppress.add("cmd");
  if (mods.has("leftShift") || mods.has("rightShift")) suppress.add("shift");
  if (mods.has("leftAlt") || mods.has("rightAlt")) suppress.add("alt");
  if (mods.has("leftCtrl") || mods.has("rightCtrl")) suppress.add("ctrl");

  return MODIFIER_ORDER.filter((m) => mods.has(m) && !suppress.has(m)).map(
    (m) => MODIFIER_LABEL[m],
  );
}

function formatCombo(event: KeyEvent): string | null {
  const key = keyCodeToName(event.keyCode);
  if (key === null) return null;
  const mods = formatModifiers(event.modifiers);
  return mods.length > 0 ? `${mods.join("+")}+${key}` : key;
}

// ─── Chord / sequence state ───────────────────────────────────────────────────

const SILENCE_MS = 3000;

// Bare modifier key codes — suppress these so they only appear when combined
// with a real key (e.g. Cmd+A, not a lone Cmd press).
const MODIFIER_ONLY_CODES: Set<number> = new Set(
  [
    KEY_CODE_MAP.leftcmd,
    KEY_CODE_MAP.rightcmd,
    KEY_CODE_MAP.leftshift,
    KEY_CODE_MAP.rightshift,
    KEY_CODE_MAP.leftalt,
    KEY_CODE_MAP.rightalt,
    KEY_CODE_MAP.leftctrl,
    KEY_CODE_MAP.rightctrl,
    KEY_CODE_MAP.fn,
  ].filter((c): c is number => c !== undefined),
);

// Map modifier keyCode → its display label (same as MODIFIER_LABEL values)
const MODIFIER_CODE_LABEL: Map<number, string> = new Map(
  (
    [
      ["leftcmd", "LeftCmd"],
      ["rightcmd", "RightCmd"],
      ["leftshift", "LeftShift"],
      ["rightshift", "RightShift"],
      ["leftalt", "LeftAlt"],
      ["rightalt", "RightAlt"],
      ["leftctrl", "LeftCtrl"],
      ["rightctrl", "RightCtrl"],
      ["fn", "Fn"],
    ] as const
  ).flatMap(([key, label]) => {
    const code = KEY_CODE_MAP[key];
    return code !== undefined ? [[code, label] as [number, string]] : [];
  }),
);

const CAPS_LOCK_CODE = KEY_CODE_MAP.capslock;

// ─── Main entry point (called by cli.ts) ─────────────────────────────────────

export async function runLog() {
  const tokens: string[] = [];
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingModifiers: Map<number, string> = new Map();

  function endLine() {
    tokens.length = 0;
    pendingModifiers.clear();
    silenceTimer = null;
    process.stdout.write("\n");
  }

  function resetSilenceTimer() {
    if (silenceTimer !== null) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(endLine, SILENCE_MS);
  }

  function onKey(event: KeyEvent) {
    if (event.type === "flags") {
      if (event.keyCode === CAPS_LOCK_CODE) {
        tokens.push("capsLock");
        process.stdout.write(`\r\x1b[K${tokens.join("  ")}`);
        resetSilenceTimer();
        return;
      }

      const label = MODIFIER_CODE_LABEL.get(event.keyCode);
      if (label === undefined) return;

      if (pendingModifiers.has(event.keyCode)) {
        pendingModifiers.delete(event.keyCode);
        tokens.push(label);
        process.stdout.write(`\r\x1b[K${tokens.join("  ")}`);
        resetSilenceTimer();
      } else {
        pendingModifiers.set(event.keyCode, label);
      }
      return;
    }

    if (event.type === "keyup") return;

    if (MODIFIER_ONLY_CODES.has(event.keyCode)) return;

    pendingModifiers.clear();

    const combo = formatCombo(event);
    if (combo === null) return;
    tokens.push(combo);

    process.stdout.write(`\r\x1b[K${tokens.join("  ")}`);
    resetSilenceTimer();
  }

  const rk = rethocker();

  rk.on("accessibilityDenied", () => {
    console.error(
      "\nAccessibility permission required.\n" +
        "Go to System Settings → Privacy & Security → Accessibility\n" +
        "and enable your terminal app, then try again.",
    );
    process.exit(1);
  });

  await rk.start();

  function cleanup() {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      if (tokens.length > 0) process.stdout.write("\n");
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
  process.on("exit", cleanup);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on("data", (chunk: Buffer) => {
      if (chunk[0] === 0x03) {
        cleanup();
        process.exit(0);
      }
    });
  }

  console.log("rethocker log — press any key (Ctrl+C to quit)");
  console.log(
    "(note: media keys always show without modifiers — macOS limitation)\n",
  );

  rk.on("key", onKey);
}

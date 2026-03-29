/**
 * Parses the key string syntax used in the high-level rethocker() API.
 *
 * Single key / combo:   "escape"  |  "Cmd+A"  |  "Cmd+Shift+K"
 * Sequence (space-sep): "Cmd+R T" |  "Ctrl+J Ctrl+K"
 *
 * Modifier names are case-insensitive. Key names match the Key constant
 * object (also case-insensitive). Modifier aliases: "opt" = "alt",
 * "option" = "alt", "command" = "cmd", "control" = "ctrl", "win" = "ctrl".
 */

import { KEY_CODE_MAP } from "./keys.ts";
import type { KeyCombo, Modifier } from "./types.ts";

// Helper: look up a guaranteed-present key from KEY_CODE_MAP
function kc(name: string): number {
  return KEY_CODE_MAP[name] as number;
}

// ─── Modifier aliases ─────────────────────────────────────────────────────────

const MODIFIER_MAP: Record<string, Modifier> = {
  cmd: "cmd",
  command: "cmd",
  shift: "shift",
  alt: "alt",
  opt: "alt",
  option: "alt",
  ctrl: "ctrl",
  control: "ctrl",
  win: "ctrl",
  fn: "fn",
  leftcmd: "leftCmd",
  rightcmd: "rightCmd",
  leftshift: "leftShift",
  rightshift: "rightShift",
  leftalt: "leftAlt",
  leftopt: "leftAlt",
  righttalt: "rightAlt",
  rightopt: "rightAlt",
  leftctrl: "leftCtrl",
  rightctrl: "rightCtrl",
};

// ─── Key name → key code lookup (case-insensitive) ───────────────────────────
//
// Primary lookup: KEY_CODE_MAP (all canonical names, lowercased).
// Aliases: common alternate names for the same key.

const KEY_ALIASES: Record<string, number> = {
  esc: kc("escape"),
  enter: kc("return"),
  backspace: kc("delete"),
  back: kc("delete"),
  del: kc("forwarddelete"),
  caps: kc("capslock"),
  arrowleft: kc("left"),
  arrowright: kc("right"),
  arrowup: kc("up"),
  arrowdown: kc("down"),

  // Short "num" prefix aliases for numpad keys
  num0: kc("numpad0"),
  num1: kc("numpad1"),
  num2: kc("numpad2"),
  num3: kc("numpad3"),
  num4: kc("numpad4"),
  num5: kc("numpad5"),
  num6: kc("numpad6"),
  num7: kc("numpad7"),
  num8: kc("numpad8"),
  num9: kc("numpad9"),
  numenter: kc("numpadenter"),
  numdecimal: kc("numpaddecimal"),
  numpadperiod: kc("numpaddecimal"),
  numadd: kc("numpadadd"),
  numpadplus: kc("numpadadd"),
  numplus: kc("numpadadd"),
  numsubtract: kc("numpadsubtract"),
  numpadminus: kc("numpadsubtract"),
  numminus: kc("numpadsubtract"),
  nummultiply: kc("numpadmultiply"),
  numpadstar: kc("numpadmultiply"),
  numdivide: kc("numpaddivide"),
  numpadslash: kc("numpaddivide"),
  numequals: kc("numpadequals"),
  numclear: kc("numpadclear"),

  // Numpad with "Numpad" prefix (VSCode style) — also auto-resolved via KEY_CODE_MAP
  // since numpad* keys are already in there lowercased.

  // Media / system key aliases
  "volume up": kc("volumeup"),
  "volume down": kc("volumedown"),
  "brightness up": kc("brightnessup"),
  "brightness down": kc("brightnessdown"),
  playpause: kc("playpause"),
  "play/pause": kc("playpause"),
  play: kc("playpause"),
  pause: kc("playpause"),
  nextrack: kc("medianext"),
  nexttrack: kc("medianext"),
  "media next": kc("medianext"),
  prevtrack: kc("mediaprevious"),
  previoustrack: kc("mediaprevious"),
  "media previous": kc("mediaprevious"),
  "media prev": kc("mediaprevious"),
  fastforward: kc("mediafastforward"),
  "fast forward": kc("mediafastforward"),
  rewind: kc("mediarewind"),
  "keyboard brightness up": kc("illuminationup"),
  "keyboard brightness down": kc("illuminationdown"),
  "keyboard brightness toggle": kc("illuminationtoggle"),
};

function resolveKeyCode(name: string): number {
  const lower = name.toLowerCase();
  const code = KEY_CODE_MAP[lower] ?? KEY_ALIASES[lower];
  if (code !== undefined) return code;

  throw new Error(
    `Unknown key name: "${name}". Use Key.* constants or check the Key reference.`,
  );
}

// ─── Parse a single combo token, e.g. "Cmd+Shift+A" ─────────────────────────

function parseCombo(token: string): KeyCombo {
  const parts = token.split("+");
  const keyPart = parts[parts.length - 1];
  const modParts = parts.slice(0, parts.length - 1);

  if (!keyPart) {
    throw new Error(`Invalid key combo: "${token}"`);
  }

  const modifiers: Modifier[] = [];
  for (const mod of modParts) {
    const resolved = MODIFIER_MAP[mod.toLowerCase()];
    if (!resolved) {
      throw new Error(
        `Unknown modifier: "${mod}" in "${token}". Valid modifiers: Cmd, Shift, Alt, Ctrl, Fn (and Left/Right variants).`,
      );
    }
    modifiers.push(resolved);
  }

  return {
    keyCode: resolveKeyCode(keyPart),
    ...(modifiers.length > 0 ? { modifiers } : {}),
  };
}

// ─── Public: parse a full key string ─────────────────────────────────────────

export type ParsedKey =
  | { kind: "single"; combo: KeyCombo }
  | { kind: "sequence"; steps: KeyCombo[] };

export function parseKey(keyString: string): ParsedKey {
  const tokens = keyString.trim().split(/\s+/);
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === "")) {
    throw new Error(`Empty key string`);
  }
  if (tokens.length === 1) {
    return { kind: "single", combo: parseCombo(tokens[0] ?? "") };
  }
  return { kind: "sequence", steps: tokens.map((t) => parseCombo(t)) };
}

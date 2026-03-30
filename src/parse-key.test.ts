/**
 * Unit tests for the key string parser (parse-key.ts).
 *
 * These are justified as focused unit tests because parseKey is a complex pure
 * function with many edge cases (aliases, case insensitivity, modifiers,
 * sequences) that are best caught at this level before they cause subtle bugs
 * in the rule compilation layer.
 */

import { describe, expect, test } from "bun:test";
import { KEY_CODE_MAP } from "./keys.ts";
import { parseKey } from "./parse-key.ts";

/** Look up a key code, throwing if missing. */
function kc(name: string): number {
  const code = KEY_CODE_MAP[name];
  if (code === undefined)
    throw new Error(`Unknown key in KEY_CODE_MAP: "${name}"`);
  return code;
}

// ─── Single keys ──────────────────────────────────────────────────────────────

describe("parseKey — single keys", () => {
  test("plain letter", () => {
    const result = parseKey("a");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("a"));
    expect(result.combo.modifiers).toBeUndefined();
  });

  test("escape", () => {
    const result = parseKey("escape");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("escape"));
  });

  test("capsLock", () => {
    const result = parseKey("capsLock");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("capslock"));
  });

  test("function key F1", () => {
    const result = parseKey("F1");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("f1"));
  });

  test("function key F20", () => {
    const result = parseKey("f20");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("f20"));
  });

  test("space", () => {
    const result = parseKey("space");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("space"));
  });

  test("return", () => {
    const result = parseKey("return");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("return"));
  });

  test("tab", () => {
    const result = parseKey("tab");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("tab"));
  });

  test("media key: volumeUp", () => {
    const result = parseKey("volumeUp");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("volumeup"));
    expect(result.combo.keyCode).toBeGreaterThan(999); // 1000+ offset for media keys
  });

  test("media key: playPause", () => {
    const result = parseKey("playPause");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("playpause"));
  });

  test("numpad key: numpadEnter", () => {
    const result = parseKey("numpadEnter");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("numpadenter"));
  });

  test("arrow key: left", () => {
    const result = parseKey("left");
    expect(result.kind).toBe("single");
    if (result.kind !== "single") return;
    expect(result.combo.keyCode).toBe(kc("left"));
  });
});

// ─── Key aliases ──────────────────────────────────────────────────────────────

describe("parseKey — key aliases", () => {
  test("esc → escape", () => {
    const r = parseKey("esc");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("escape"));
  });

  test("enter → return", () => {
    const r = parseKey("enter");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("return"));
  });

  test("backspace → delete", () => {
    const r = parseKey("backspace");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("delete"));
  });

  test("back → delete", () => {
    const r = parseKey("back");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("delete"));
  });

  test("del → forwardDelete", () => {
    const r = parseKey("del");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("forwarddelete"));
  });

  test("caps → capsLock", () => {
    const r = parseKey("caps");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("capslock"));
  });

  test("arrowLeft → left", () => {
    const r = parseKey("arrowLeft");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("left"));
  });

  test("arrowRight → right", () => {
    const r = parseKey("arrowRight");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("right"));
  });

  test("arrowUp → up", () => {
    const r = parseKey("arrowUp");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("up"));
  });

  test("arrowDown → down", () => {
    const r = parseKey("arrowDown");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("down"));
  });

  test("num0 → numpad0", () => {
    const r = parseKey("num0");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("numpad0"));
  });

  test("numenter → numpadEnter", () => {
    const r = parseKey("numenter");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("numpadenter"));
  });

  test("numdecimal → numpadDecimal", () => {
    const r = parseKey("numdecimal");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("numpaddecimal"));
  });

  test("numadd → numpadAdd", () => {
    const r = parseKey("numadd");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("numpadadd"));
  });

  test("numpadplus → numpadAdd", () => {
    const r = parseKey("numpadplus");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("numpadadd"));
  });

  test("numsubtract → numpadSubtract", () => {
    const r = parseKey("numsubtract");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("numpadsubtract"));
  });

  test("numdivide → numpadDivide", () => {
    const r = parseKey("numdivide");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("numpaddivide"));
  });

  test("playpause alias", () => {
    const r = parseKey("playpause");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("playpause"));
  });

  test("play alias → playpause", () => {
    const r = parseKey("play");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("playpause"));
  });

  test("nexttrack alias → mediaPrevious", () => {
    const r = parseKey("nexttrack");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("medianext"));
  });

  test("prevtrack alias → mediaPrevious", () => {
    const r = parseKey("prevtrack");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("mediaprevious"));
  });
});

// ─── Modifier combos ──────────────────────────────────────────────────────────

describe("parseKey — modifier combos", () => {
  test("Cmd+A", () => {
    const r = parseKey("Cmd+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("a"));
    expect(r.combo.modifiers).toEqual(["cmd"]);
  });

  test("Shift+A", () => {
    const r = parseKey("Shift+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["shift"]);
  });

  test("Cmd+Shift+K", () => {
    const r = parseKey("Cmd+Shift+K");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("k"));
    expect(r.combo.modifiers).toContain("cmd");
    expect(r.combo.modifiers).toContain("shift");
  });

  test("Ctrl+Alt+Delete", () => {
    const r = parseKey("Ctrl+Alt+Delete");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.keyCode).toBe(kc("delete"));
    expect(r.combo.modifiers).toContain("ctrl");
    expect(r.combo.modifiers).toContain("alt");
  });

  test("Cmd+Shift+Alt+Ctrl+A (all four)", () => {
    const r = parseKey("Cmd+Shift+Alt+Ctrl+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toContain("cmd");
    expect(r.combo.modifiers).toContain("shift");
    expect(r.combo.modifiers).toContain("alt");
    expect(r.combo.modifiers).toContain("ctrl");
  });

  test("no modifiers → modifiers omitted from combo", () => {
    const r = parseKey("a");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toBeUndefined();
  });
});

// ─── Modifier aliases ─────────────────────────────────────────────────────────

describe("parseKey — modifier aliases", () => {
  test("Opt → alt", () => {
    const r = parseKey("Opt+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["alt"]);
  });

  test("Option → alt", () => {
    const r = parseKey("Option+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["alt"]);
  });

  test("Command → cmd", () => {
    const r = parseKey("Command+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["cmd"]);
  });

  test("Control → ctrl", () => {
    const r = parseKey("Control+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["ctrl"]);
  });

  test("Win → ctrl", () => {
    const r = parseKey("Win+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["ctrl"]);
  });

  test("Fn modifier", () => {
    const r = parseKey("Fn+F1");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["fn"]);
  });
});

// ─── Side-specific modifiers ──────────────────────────────────────────────────

describe("parseKey — side-specific modifiers", () => {
  test("leftCmd", () => {
    const r = parseKey("leftCmd+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["leftCmd"]);
  });

  test("rightCmd", () => {
    const r = parseKey("rightCmd+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["rightCmd"]);
  });

  test("leftAlt", () => {
    const r = parseKey("leftAlt+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["leftAlt"]);
  });

  test("rightAlt (was broken by righttalt typo — fixed)", () => {
    const r = parseKey("rightAlt+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["rightAlt"]);
  });

  test("rightopt → rightAlt", () => {
    const r = parseKey("rightopt+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["rightAlt"]);
  });

  test("leftCtrl", () => {
    const r = parseKey("leftCtrl+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["leftCtrl"]);
  });

  test("rightCtrl", () => {
    const r = parseKey("rightCtrl+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["rightCtrl"]);
  });

  test("leftShift", () => {
    const r = parseKey("leftShift+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["leftShift"]);
  });

  test("rightShift", () => {
    const r = parseKey("rightShift+A");
    expect(r.kind).toBe("single");
    if (r.kind !== "single") return;
    expect(r.combo.modifiers).toEqual(["rightShift"]);
  });
});

// ─── Case insensitivity ───────────────────────────────────────────────────────

describe("parseKey — case insensitivity", () => {
  test("CMD+a == Cmd+a == cmd+a", () => {
    const r1 = parseKey("CMD+a");
    const r2 = parseKey("Cmd+a");
    const r3 = parseKey("cmd+a");
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  test("ESCAPE == escape == Escape", () => {
    const r1 = parseKey("ESCAPE");
    const r2 = parseKey("escape");
    const r3 = parseKey("Escape");
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  test("F1 == f1", () => {
    expect(parseKey("F1")).toEqual(parseKey("f1"));
  });

  test("CAPSLOCK == capsLock == capslock", () => {
    const r1 = parseKey("CAPSLOCK");
    const r2 = parseKey("capsLock");
    const r3 = parseKey("capslock");
    expect(r1.kind).toBe("single");
    expect(r2.kind).toBe("single");
    expect(r3.kind).toBe("single");
    if (r1.kind !== "single" || r2.kind !== "single" || r3.kind !== "single")
      return;
    expect(r1.combo.keyCode).toBe(r2.combo.keyCode);
    expect(r2.combo.keyCode).toBe(r3.combo.keyCode);
  });
});

// ─── Sequences ────────────────────────────────────────────────────────────────

describe("parseKey — sequences", () => {
  test("two-token sequence", () => {
    const r = parseKey("Cmd+R T");
    expect(r.kind).toBe("sequence");
    if (r.kind !== "sequence") return;
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0]?.keyCode).toBe(kc("r"));
    expect(r.steps[0]?.modifiers).toContain("cmd");
    expect(r.steps[1]?.keyCode).toBe(kc("t"));
    expect(r.steps[1]?.modifiers).toBeUndefined();
  });

  test("three-token sequence", () => {
    const r = parseKey("Ctrl+J Ctrl+K Ctrl+L");
    expect(r.kind).toBe("sequence");
    if (r.kind !== "sequence") return;
    expect(r.steps).toHaveLength(3);
    for (const step of r.steps) {
      expect(step.modifiers).toContain("ctrl");
    }
    expect(r.steps[0]?.keyCode).toBe(kc("j"));
    expect(r.steps[1]?.keyCode).toBe(kc("k"));
    expect(r.steps[2]?.keyCode).toBe(kc("l"));
  });

  test("sequence of plain keys (no modifiers)", () => {
    const r = parseKey("a b c");
    expect(r.kind).toBe("sequence");
    if (r.kind !== "sequence") return;
    expect(r.steps).toHaveLength(3);
    expect(r.steps[0]?.keyCode).toBe(kc("a"));
    expect(r.steps[1]?.keyCode).toBe(kc("b"));
    expect(r.steps[2]?.keyCode).toBe(kc("c"));
  });

  test("extra whitespace is trimmed", () => {
    const r = parseKey("  a   b  ");
    expect(r.kind).toBe("sequence");
    if (r.kind !== "sequence") return;
    expect(r.steps).toHaveLength(2);
  });
});

// ─── Error cases ──────────────────────────────────────────────────────────────

describe("parseKey — error cases", () => {
  test("empty string throws", () => {
    expect(() => parseKey("")).toThrow();
  });

  test("whitespace-only string throws", () => {
    expect(() => parseKey("   ")).toThrow();
  });

  test("unknown key name throws with descriptive message", () => {
    expect(() => parseKey("notakey")).toThrow(/Unknown key name/);
  });

  test("unknown modifier throws with descriptive message", () => {
    expect(() => parseKey("SuperMod+A")).toThrow(/Unknown modifier/);
  });

  test("invalid combo (no key part) throws", () => {
    expect(() => parseKey("Cmd+")).toThrow();
  });
});

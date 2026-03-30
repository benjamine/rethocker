/**
 * Main integration test suite for rethocker.
 *
 * Strategy: test the public API by intercepting the IPC commands sent to the
 * native daemon (via a mock `send` function). This lets us verify the full
 * TypeScript pipeline — key parsing, rule compilation, condition building,
 * handle creation — without needing the native binary or Accessibility permission.
 */

import { describe, expect, mock, test } from "bun:test";
import { TypedEmitter } from "./daemon.ts";
import { actions, Key, KeyModifier, rethocker } from "./index.ts";
import { KEY_CODE_MAP } from "./keys.ts";
import { registerRule } from "./register-rule.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Capture IPC commands sent by registerRule/rethocker into an array. */
function makeSend() {
  const commands: Record<string, unknown>[] = [];
  const send = (obj: Record<string, unknown>) => {
    commands.push(obj);
  };
  return { send, commands };
}

function makeEmitter() {
  return new TypedEmitter();
}

/** Look up a key code, throwing if missing (safe for tests). */
function kc(name: string): number {
  const code = KEY_CODE_MAP[name];
  if (code === undefined) throw new Error(`Unknown key: ${name}`);
  return code;
}

/** Get first command, throwing if none were sent. */
function firstCmd(
  commands: Record<string, unknown>[],
): Record<string, unknown> {
  const cmd = commands.at(0);
  if (cmd === undefined) throw new Error("No commands were sent");
  return cmd;
}

// ─── Key constants ────────────────────────────────────────────────────────────

test("Key constants are strings", () => {
  expect(Key.capsLock).toBe("capsLock");
  expect(Key.escape).toBe("escape");
  expect(Key.brightnessDown).toBe("brightnessDown");
  expect(Key.volumeUp).toBe("volumeUp");
  expect(Key.numpadEnter).toBe("numpadEnter");
});

test("KeyModifier constants are valid modifier strings", () => {
  expect(KeyModifier.Cmd).toBe("cmd");
  expect(KeyModifier.Shift).toBe("shift");
  expect(KeyModifier.Alt).toBe("alt");
  expect(KeyModifier.LeftCmd).toBe("leftCmd");
  expect(KeyModifier.RightAlt).toBe("rightAlt");
});

test("Key interpolation produces valid key strings", () => {
  expect(`${Key.capsLock}`).toBe("capsLock");
  expect(`Cmd+${Key.v}`).toBe("Cmd+v");
  expect(`${Key.brightnessDown} ${Key.brightnessUp}`).toBe(
    "brightnessDown brightnessUp",
  );
});

// ─── Rule registration: IPC commands ─────────────────────────────────────────

describe("registerRule — remap rules", () => {
  test("single key remap sends add_rule with remap action", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, { key: "capsLock", remap: "escape" });

    expect(commands).toHaveLength(1);
    const cmd = firstCmd(commands);
    expect(cmd.cmd).toBe("add_rule");
    expect((cmd.trigger as { keyCode: number }).keyCode).toBe(kc("capslock"));
    expect((cmd.action as { type: string; keyCode: number }).type).toBe(
      "remap",
    );
    expect((cmd.action as { type: string; keyCode: number }).keyCode).toBe(
      kc("escape"),
    );
  });

  test("remap to a sequence sends remap_sequence action", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, { key: "capsLock", remap: "escape return" });

    const cmd = firstCmd(commands);
    expect((cmd.action as { type: string }).type).toBe("remap_sequence");
    const steps = (cmd.action as { steps: Array<{ keyCode: number }> }).steps;
    expect(steps).toHaveLength(2);
    expect(steps[0]?.keyCode).toBe(kc("escape"));
    expect(steps[1]?.keyCode).toBe(kc("return"));
  });

  test("remap with modifier sends correct modifiers on trigger", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, { key: "Cmd+A", remap: "Cmd+C" });

    const cmd = firstCmd(commands);
    const trigger = cmd.trigger as { keyCode: number; modifiers: string[] };
    expect(trigger.keyCode).toBe(kc("a"));
    expect(trigger.modifiers).toContain("cmd");
    const action = cmd.action as { keyCode: number; modifiers: string[] };
    expect(action.keyCode).toBe(kc("c"));
    expect(action.modifiers).toContain("cmd");
  });

  test("sequence trigger remap sends add_sequence command", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, { key: "Cmd+R T", remap: "escape" });

    expect(commands[0]?.cmd).toBe("add_sequence");
    const steps = (commands[0] as { steps: Array<{ keyCode: number }> }).steps;
    expect(steps).toHaveLength(2);
    expect(steps[0]?.keyCode).toBe(kc("r"));
    expect(steps[1]?.keyCode).toBe(kc("t"));
  });
});

describe("registerRule — shell rules", () => {
  test("single key shell rule sends add_rule with run action", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, { key: "F1", execute: "open -a Safari" });

    const cmd = firstCmd(commands);
    expect(cmd.cmd).toBe("add_rule");
    expect((cmd.action as { type: string; command: string }).type).toBe("run");
    expect((cmd.action as { type: string; command: string }).command).toBe(
      "open -a Safari",
    );
  });

  test("execute array is joined with &&", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: ["open -a Safari", "open -a Terminal"],
    });

    const action = commands[0]?.action as { command: string };
    expect(action.command).toBe("open -a Safari && open -a Terminal");
  });

  test("sequence key shell rule sends add_sequence with run action", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "Ctrl+J Ctrl+K",
      execute: "echo hello",
      consume: true,
    });

    const cmd = firstCmd(commands);
    expect(cmd.cmd).toBe("add_sequence");
    expect((cmd.action as { type: string }).type).toBe("run");
    expect(cmd.consume).toBe(true);
  });
});

describe("registerRule — handler rules", () => {
  test("single key handler sends add_rule with emit action and fires callback", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();
    const handler = mock((_e: unknown) => {
      /* captured */
    });

    registerRule(send, emitter, { key: "escape", handler });

    const cmd = firstCmd(commands);
    expect(cmd.cmd).toBe("add_rule");
    expect((cmd.action as { type: string }).type).toBe("emit");

    // Simulate native daemon emitting the matched event
    const eventID = (cmd.action as { eventID: string }).eventID;
    const ruleID = cmd.id as string;
    emitter.emit("event", eventID, ruleID);

    expect(handler).toHaveBeenCalledTimes(1);
    const callArg = handler.mock.calls[0]?.[0] as
      | { type: string; suppressed: boolean }
      | undefined;
    expect(callArg?.type).toBe("keydown");
    expect(callArg?.suppressed).toBe(true);
  });

  test("sequence key handler sends add_sequence and fires callback on sequence event", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();
    const handler = mock((_e: unknown) => {
      /* captured */
    });

    registerRule(send, emitter, { key: "Ctrl+J Ctrl+K", handler });

    expect(commands[0]?.cmd).toBe("add_sequence");
    const ruleID = commands[0]?.id as string;
    const eventID = (commands[0]?.action as { eventID: string }).eventID;

    // Simulate sequence_matched from native daemon
    emitter.emit("sequence", ruleID, eventID);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

// ─── App conditions ───────────────────────────────────────────────────────────

describe("registerRule — app conditions", () => {
  test("app name (no dot) produces name-based activeApp condition", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: "echo hi",
      app: "Terminal",
    });

    const conditions = commands[0]?.conditions as {
      activeApp: Array<{ name?: string; bundleID?: string; invert?: boolean }>;
    };
    expect(conditions.activeApp).toHaveLength(1);
    expect(conditions.activeApp[0]?.name).toBe("Terminal");
    expect(conditions.activeApp[0]?.bundleID).toBeUndefined();
    expect(conditions.activeApp[0]?.invert).toBe(false);
  });

  test("app bundle ID (contains dot) produces bundleID-based condition", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: "echo hi",
      app: "com.apple.Terminal",
    });

    const conditions = commands[0]?.conditions as {
      activeApp: Array<{ name?: string; bundleID?: string }>;
    };
    expect(conditions.activeApp[0]?.bundleID).toBe("com.apple.Terminal");
    expect(conditions.activeApp[0]?.name).toBeUndefined();
  });

  test("! prefix inverts the condition", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: "echo hi",
      app: "!Terminal",
    });

    const conditions = commands[0]?.conditions as {
      activeApp: Array<{ name?: string; invert?: boolean }>;
    };
    expect(conditions.activeApp[0]?.name).toBe("Terminal");
    expect(conditions.activeApp[0]?.invert).toBe(true);
  });

  test("! prefix works with bundle IDs too", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: "echo hi",
      app: "!com.apple.Terminal",
    });

    const conditions = commands[0]?.conditions as {
      activeApp: Array<{ bundleID?: string; invert?: boolean }>;
    };
    expect(conditions.activeApp[0]?.bundleID).toBe("com.apple.Terminal");
    expect(conditions.activeApp[0]?.invert).toBe(true);
  });

  test("app array produces multiple activeApp conditions (OR-ed)", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: "echo hi",
      app: ["Safari", "Chrome", "Firefox"],
    });

    const conditions = commands[0]?.conditions as {
      activeApp: Array<{ name?: string }>;
    };
    expect(conditions.activeApp).toHaveLength(3);
    expect(conditions.activeApp.map((c) => c.name)).toEqual([
      "Safari",
      "Chrome",
      "Firefox",
    ]);
  });

  test("no app condition sends empty conditions object", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, { key: "F1", execute: "echo hi" });

    expect(commands[0]?.conditions).toEqual({});
  });
});

// ─── Rule handles ─────────────────────────────────────────────────────────────

describe("registerRule — rule handles", () => {
  test("returned handle has id, remove, enable, disable", () => {
    const { send } = makeSend();
    const emitter = makeEmitter();

    const handle = registerRule(send, emitter, {
      key: "escape",
      execute: "echo hi",
    });

    expect(typeof handle.id).toBe("string");
    expect(handle.id.length).toBeGreaterThan(0);
    expect(typeof handle.remove).toBe("function");
    expect(typeof handle.enable).toBe("function");
    expect(typeof handle.disable).toBe("function");
  });

  test("handle.remove() sends remove_rule", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    const handle = registerRule(send, emitter, {
      key: "escape",
      execute: "echo hi",
    });
    const id = handle.id;
    commands.length = 0; // clear the add_rule command

    handle.remove();

    expect(commands[0]?.cmd).toBe("remove_rule");
    expect(commands[0]?.id).toBe(id);
  });

  test("handle.disable() sends set_rule_enabled with enabled:false", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    const handle = registerRule(send, emitter, {
      key: "escape",
      execute: "echo hi",
    });
    commands.length = 0;

    handle.disable();

    expect(commands[0]?.cmd).toBe("set_rule_enabled");
    expect(commands[0]?.enabled).toBe(false);
  });

  test("handle.enable() sends set_rule_enabled with enabled:true", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    const handle = registerRule(send, emitter, {
      key: "escape",
      execute: "echo hi",
    });
    commands.length = 0;

    handle.enable();

    expect(commands[0]?.cmd).toBe("set_rule_enabled");
    expect(commands[0]?.enabled).toBe(true);
  });

  test("sequence handle remove() sends remove_sequence", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    const handle = registerRule(send, emitter, {
      key: "Ctrl+J Ctrl+K",
      execute: "echo hi",
    });
    commands.length = 0;

    handle.remove();

    expect(commands[0]?.cmd).toBe("remove_sequence");
  });

  test("disabled:true sends rule with enabled:false", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: "echo hi",
      disabled: true,
    });

    expect(commands[0]?.enabled).toBe(false);
  });

  test("custom id is used for the rule", () => {
    const { send, commands } = makeSend();
    const emitter = makeEmitter();

    registerRule(send, emitter, {
      key: "F1",
      execute: "echo hi",
      id: "my-custom-id",
    });

    expect(commands[0]?.id).toBe("my-custom-id");
  });
});

// ─── rethocker() handle ───────────────────────────────────────────────────────

describe("rethocker() handle", () => {
  test("creates a handle with expected methods", () => {
    const rk = rethocker();
    expect(typeof rk.add).toBe("function");
    expect(typeof rk.remove).toBe("function");
    expect(typeof rk.enable).toBe("function");
    expect(typeof rk.disable).toBe("function");
    expect(typeof rk.on).toBe("function");
    expect(typeof rk.start).toBe("function");
    expect(typeof rk.stop).toBe("function");
    expect(typeof rk.unref).toBe("function");
    expect(typeof rk.execute).toBe("function");
    expect(typeof rk.ready).toBe("boolean");
    rk.stop();
  });

  test("ready is false before daemon starts", () => {
    const rk = rethocker();
    expect(rk.ready).toBe(false);
    rk.stop();
  });

  test("add() accepts a single rule without throwing", () => {
    const rk = rethocker();
    expect(() => rk.add({ key: "escape", execute: "echo hi" })).not.toThrow();
    rk.stop();
  });

  test("add() accepts an array of rules without throwing", () => {
    const rk = rethocker();
    expect(() =>
      rk.add([
        { key: "F1", execute: "echo one" },
        { key: "F2", execute: "echo two" },
      ]),
    ).not.toThrow();
    rk.stop();
  });

  test("initial rules are registered at construction without throwing", () => {
    const rk = rethocker([
      { key: "F1", execute: "echo one" },
      { key: "F2", execute: "echo two" },
    ]);
    rk.stop();
  });

  test("on() returns an unsubscribe function", () => {
    const rk = rethocker();
    const off = rk.on("error", () => {
      /* listener */
    });
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
    rk.stop();
  });

  test("execute() with string array joins with && and returns a promise", async () => {
    const rk = rethocker();
    const result = rk.execute(["echo a", "echo b"]);
    expect(result instanceof Promise).toBe(true);
    await result;
    rk.stop();
  });

  test("execute() with plain string also returns a promise", async () => {
    const rk = rethocker();
    const result = rk.execute("echo hello");
    expect(result instanceof Promise).toBe(true);
    await result;
    rk.stop();
  });

  test("remove(id) does not throw for a registered rule id", () => {
    const rk = rethocker();
    rk.add({ key: "F1", execute: "echo hi", id: "test-remove-id" });
    expect(() => rk.remove("test-remove-id")).not.toThrow();
    rk.stop();
  });

  test("remove(id) does not throw for an unknown id", () => {
    const rk = rethocker();
    expect(() => rk.remove("nonexistent")).not.toThrow();
    rk.stop();
  });

  test("enable(id) enables a specific rule without throwing", () => {
    const rk = rethocker();
    rk.add({ key: "F1", execute: "echo hi", id: "test-enable-id" });
    expect(() => rk.enable("test-enable-id")).not.toThrow();
    rk.stop();
  });

  test("enable() with no arg enables all rules without throwing", () => {
    const rk = rethocker([
      { key: "F1", execute: "echo one", id: "rule-a" },
      { key: "F2", execute: "echo two", id: "rule-b" },
    ]);
    expect(() => rk.enable()).not.toThrow();
    rk.stop();
  });

  test("disable(id) disables a specific rule without throwing", () => {
    const rk = rethocker();
    rk.add({ key: "F1", execute: "echo hi", id: "test-disable-id" });
    expect(() => rk.disable("test-disable-id")).not.toThrow();
    rk.stop();
  });

  test("disable() with no arg disables all rules without throwing", () => {
    const rk = rethocker([
      { key: "F1", execute: "echo one", id: "rule-c" },
      { key: "F2", execute: "echo two", id: "rule-d" },
    ]);
    expect(() => rk.disable()).not.toThrow();
    rk.stop();
  });
});

// ─── actions ─────────────────────────────────────────────────────────────────

describe("actions.window", () => {
  test("all window actions return strings", () => {
    expect(typeof actions.window.halfLeft()).toBe("string");
    expect(typeof actions.window.halfRight()).toBe("string");
    expect(typeof actions.window.halfTop()).toBe("string");
    expect(typeof actions.window.halfBottom()).toBe("string");
    expect(typeof actions.window.thirdLeft()).toBe("string");
    expect(typeof actions.window.thirdCenter()).toBe("string");
    expect(typeof actions.window.thirdRight()).toBe("string");
    expect(typeof actions.window.quarterTopLeft()).toBe("string");
    expect(typeof actions.window.quarterTopRight()).toBe("string");
    expect(typeof actions.window.quarterBottomLeft()).toBe("string");
    expect(typeof actions.window.quarterBottomRight()).toBe("string");
    expect(typeof actions.window.maximize()).toBe("string");
  });

  test("window actions contain osascript", () => {
    expect(actions.window.halfLeft()).toContain("osascript");
    expect(actions.window.maximize()).toContain("osascript");
  });

  test("window actions with app name include the app name", () => {
    expect(actions.window.halfLeft("Figma")).toContain("Figma");
    expect(actions.window.maximize("iTerm")).toContain("iTerm");
  });

  test("without app targets frontmost via System Events", () => {
    expect(actions.window.halfLeft()).toContain("System Events");
  });

  test("with app uses tell application block", () => {
    expect(actions.window.halfLeft("Figma")).toContain(
      'tell application "Figma"',
    );
  });
});

describe("actions.app", () => {
  test("focus by name uses open -a", () => {
    expect(actions.app.focus("Slack")).toContain("open -a");
    expect(actions.app.focus("Slack")).toContain("Slack");
  });

  test("focus by bundle ID uses open -b", () => {
    expect(actions.app.focus("com.tinyspeck.slackmacgap")).toContain("open -b");
    expect(actions.app.focus("com.tinyspeck.slackmacgap")).toContain(
      "com.tinyspeck.slackmacgap",
    );
  });

  test("quit by name uses tell application by name", () => {
    const cmd = actions.app.quit("Slack");
    expect(cmd).toContain("osascript");
    expect(cmd).toContain("Slack");
    expect(cmd).toContain("quit");
  });

  test("quit by bundle ID uses tell application id", () => {
    const cmd = actions.app.quit("com.tinyspeck.slackmacgap");
    expect(cmd).toContain("application id");
    expect(cmd).toContain("com.tinyspeck.slackmacgap");
  });
});

describe("actions.shortcut", () => {
  test("returns shortcuts run command with the name", () => {
    const cmd = actions.shortcut("Morning Routine");
    expect(cmd).toContain("shortcuts run");
    expect(cmd).toContain("Morning Routine");
  });
});

describe("actions.media", () => {
  test("all media actions return strings", () => {
    expect(typeof actions.media.playPause()).toBe("string");
    expect(typeof actions.media.next()).toBe("string");
    expect(typeof actions.media.previous()).toBe("string");
    expect(typeof actions.media.mute()).toBe("string");
    expect(typeof actions.media.setVolume(50)).toBe("string");
    expect(typeof actions.media.volumeUp()).toBe("string");
    expect(typeof actions.media.volumeDown()).toBe("string");
  });

  test("setVolume clamps to maximum 100", () => {
    expect(actions.media.setVolume(150)).toContain("100");
  });

  test("setVolume clamps to minimum 0", () => {
    expect(actions.media.setVolume(-10)).toContain("0");
  });

  test("setVolume passes through values in range", () => {
    expect(actions.media.setVolume(50)).toContain("50");
  });

  test("volumeUp accepts custom step", () => {
    expect(actions.media.volumeUp(5)).toContain("5");
  });

  test("volumeDown accepts custom step", () => {
    expect(actions.media.volumeDown(15)).toContain("15");
  });
});

describe("actions.system", () => {
  test("all system actions return strings", () => {
    expect(typeof actions.system.sleep()).toBe("string");
    expect(typeof actions.system.lockScreen()).toBe("string");
    expect(typeof actions.system.showDesktop()).toBe("string");
    expect(typeof actions.system.missionControl()).toBe("string");
    expect(typeof actions.system.emptyTrash()).toBe("string");
  });

  test("sleep uses System Events", () => {
    expect(actions.system.sleep()).toContain("System Events");
    expect(actions.system.sleep()).toContain("sleep");
  });

  test("lockScreen references CGSession", () => {
    expect(actions.system.lockScreen()).toContain("CGSession");
  });
});

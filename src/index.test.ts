import { expect, test } from "bun:test";
import { actions, Key, KeyModifier, rethocker } from "./index.ts";

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
});

test("Key interpolation produces valid key strings", () => {
  expect(`${Key.capsLock}`).toBe("capsLock");
  expect(`Cmd+${Key.v}`).toBe("Cmd+v");
  expect(`${Key.brightnessDown} ${Key.brightnessUp}`).toBe(
    "brightnessDown brightnessUp",
  );
});

test("actions.window returns shell command strings", () => {
  expect(typeof actions.window.halfLeft()).toBe("string");
  expect(typeof actions.window.halfRight()).toBe("string");
  expect(typeof actions.window.maximize()).toBe("string");
  expect(typeof actions.window.halfLeft("Figma")).toBe("string");
});

test("actions.app returns shell command strings", () => {
  expect(typeof actions.app.focus("Slack")).toBe("string");
  expect(typeof actions.app.focus("com.tinyspeck.slackmacgap")).toBe("string");
  expect(typeof actions.app.quit("Slack")).toBe("string");
});

test("actions.media returns shell command strings", () => {
  expect(typeof actions.media.playPause()).toBe("string");
  expect(typeof actions.media.mute()).toBe("string");
  expect(typeof actions.media.setVolume(50)).toBe("string");
});

test("actions.system returns shell command strings", () => {
  expect(typeof actions.system.sleep()).toBe("string");
  expect(typeof actions.system.lockScreen()).toBe("string");
});

test("rethocker() creates a handle with expected methods", () => {
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
  // Stop immediately — don't actually start the daemon in tests
  rk.stop();
});

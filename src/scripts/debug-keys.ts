/**
 * Key code explorer: prints every key event with its keyCode, modifiers,
 * and the currently active app.
 *
 * Useful for discovering key codes and verifying app conditions before
 * writing rules.
 *
 * Run with:
 *   bun src/scripts/debug-keys.ts
 */

import type { KeyEvent } from "../index.ts";
import { rethocker } from "../index.ts";

const rk = rethocker();

rk.on("accessibilityDenied", () => {
  console.error(
    "Accessibility permission required.\n" +
      "Go to System Settings → Privacy & Security → Accessibility\n" +
      "and enable this terminal / app.",
  );
});

await rk.start();
console.log("Press any key (Ctrl+C to quit):\n");

rk.on("key", ({ type, keyCode, modifiers, app, appBundleID }: KeyEvent) => {
  const parts: string[] = [
    `${type.padEnd(7)}  keyCode: ${String(keyCode).padEnd(4)}`,
  ];

  if (modifiers.length > 0) {
    parts.push(`mods: [${modifiers.join(", ")}]`);
  }

  if (app) parts.push(`app: ${app}${appBundleID ? ` (${appBundleID})` : ""}`);

  console.log(parts.join("  "));
});

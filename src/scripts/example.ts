/**
 * Example: rethocker capabilities showcase
 *
 * Run with:
 *   bun src/scripts/example.ts
 *
 * Requires Accessibility permission on first run.
 * macOS will prompt automatically.
 */

import { actions, Key, rethocker } from "../index.ts";

const rk = rethocker([
  // ── Remap Caps Lock → Escape ──────────────────────────────────────────────
  //
  // Caps Lock fires a special "flagsChanged" event (not a normal keydown),
  // but rethocker handles it transparently — this just works.
  {
    key: "capsLock",
    remap: "escape",
  },
  {
    // you can also remap chords
    key: "Ctrl+H E",
    // or remap to a chord, use `Key` for autocomplete and typesafety
    remap: `h e l l o Shift+n1 n1 ${Key.delete}`,
  },
  {
    key: `${Key.brightnessDown} ${Key.brightnessUp}`,
    /**
     * install zwussh first:
     *  brew tap benjamine/homebrew-tap
     *  brew install zwuush
     */
    execute: "zwuush https://benjamine.github.io/zwuush/wow.mov",
  },
  {
    key: "Cmd+R T",
    sequenceTimeoutMs: 10_000,
    // optionally include or exclude specific apps (by bundle identifier).
    app: ["!com.google.Chrome", "!com.apple.Safari"],
    // optionally consume the key event so it doesn't reach the app
    consume: true,
    // execute: `osascript -e 'display notification "Cmd+R → T sequence detected" with title "rethocker"'`,
    handler: async () => {
      // using a custom handler allows for more complex actions, e.g. multiple commands, async/await, etc.
      await rk.execute(actions.window.halfTop());
      // actions. provide quick access to common OSX tasks like window management
    },
  },
]);

rk.on("accessibilityDenied", () => {
  console.error(
    "Accessibility permission required.\n" +
      "Go to System Settings → Privacy & Security → Accessibility\n" +
      "and enable this terminal / app.",
  );
});

rk.on("error", (code, message) => {
  console.error(`[rethocker error] ${code}: ${message}`);
});

rk.on("exit", (code) => {
  console.error(
    `Native daemon exited unexpectedly (code ${code}). Restarting...`,
  );
  rk.start().catch(console.error);
});

console.log("rethocker running. Press Ctrl+C to quit.");
console.log("  • Caps Lock → Escape");
console.log("  • Cmd+R then T (within 10s, consumed) → macOS notification");

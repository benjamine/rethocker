# rethocker

Global key interception and remapping for macOS. Intercept any key or combo system-wide, remap keys, fire shell commands, react to key sequences, and scope rules to specific apps — all from TypeScript.

Requires **macOS 13+** and **Accessibility permission** (prompted automatically on first run).

## Install

```bash
bun add rethocker
```

## Usage

```ts
import { actions, Key, rethocker } from "rethocker"

const rk = rethocker([
  // Remap Caps Lock → Escape
  // Caps Lock is handled transparently — no extra setup needed
  {
    key: Key.capsLock,
    remap: Key.escape,
  },

  // Remap a chord to another chord — single key or a whole sequence
  // Use Key.* constants for autocomplete and safe string interpolation
  {
    key: "Ctrl+H E",
    remap: `h e l l o Shift+n1 n1 ${Key.delete}`,
  },

  // Media / system keys are fully interceptable
  // Use spaces for key sequences (steps pressed in order)
  {
    key: `${Key.brightnessDown} ${Key.brightnessUp}`,
    execute: "open -a 'My App'",
  },

  // Sequence with app filter, consume, and a TypeScript handler
  {
    key: "Cmd+R T",
    sequenceTimeoutMs: 10_000,
    // exclude specific apps by bundle ID (prefix with ! to negate)
    app: ["!com.google.Chrome", "!com.apple.Safari"],
    // consume: swallow the keys so they don't reach the app
    consume: true,
    handler: async () => {
      // handlers allow async/await and full access to the rk instance
      await rk.execute(actions.window.halfTop())
      // actions.* provide quick access to common macOS tasks
    },
  },
])

// Handle lifecycle events
rk.on("accessibilityDenied", () => {
  console.error("Go to System Settings → Privacy & Security → Accessibility")
})
rk.on("error", (code, message) => console.error(`[${code}] ${message}`))
rk.on("exit", (code) => {
  console.error(`daemon exited (${code}), restarting...`)
  rk.start().catch(console.error)
})
```

The daemon starts automatically in the background. Rules take effect as soon as it's ready — no `await` needed. Call `await rk.start()` only if you want to explicitly catch startup errors.

## Key syntax

Rules use a readable string syntax for keys and combos:

```ts
"escape"          // single key by name
"Cmd+A"           // modifier + key
"Cmd+Shift+K"     // multiple modifiers
"Cmd+R T"         // sequence: Cmd+R then T (space-separated steps)
"Ctrl+J Ctrl+K"   // sequence with modifiers on each step
```

Modifier names are case-insensitive: `Cmd`, `Shift`, `Alt` / `Opt` / `Option`, `Ctrl` / `Control`, `Fn`.

### `Key` constants

Import `Key` for autocomplete and safe string interpolation. Values are key name strings, so they compose naturally:

```ts
import { Key } from "rethocker"

Key.capsLock      // "capsLock"
Key.escape        // "escape"
Key.brightnessDown // "brightnessDown"

// Interpolation always produces valid key strings
`Cmd+${Key.v}`                              // "Cmd+v"
`${Key.brightnessDown} ${Key.brightnessUp}` // "brightnessDown brightnessUp"
`Cmd+${Key.r} ${Key.t}`                     // "Cmd+r t"
```

Key names are case-insensitive. Common aliases:

| Name | Aliases |
|---|---|
| `escape` | `esc` |
| `return` | `enter` |
| `delete` | `backspace`, `back` |
| `forwardDelete` | `del` |
| `capsLock` | `caps` |
| `left` / `right` / `up` / `down` | `arrowLeft` etc. |
| `numpadEnter` | `numenter` |
| `numpadAdd` | `numpadplus`, `numadd` |
| `numpadSubtract` | `numpadminus`, `numsubtract` |
| `numpadDecimal` | `numpadperiod`, `numdecimal` |
| `numpad0`–`numpad9` | `num0`–`num9` |

### Media / system keys

Top-row physical keys (volume, brightness, media control, keyboard backlight) are fully interceptable:

```ts
{ key: Key.volumeUp,      execute: "..." }
{ key: Key.playPause,     handler: () => {} }
{ key: Key.brightnessDown, remap: Key.brightnessUp }
{ key: `${Key.mediaNext} ${Key.mediaPrevious}`, handler: () => {} }
```

Available: `volumeUp`, `volumeDown`, `mute`, `brightnessUp`, `brightnessDown`, `playPause`, `mediaNext`, `mediaPrevious`, `mediaFastForward`, `mediaRewind`, `eject`, `illuminationUp`, `illuminationDown`, `illuminationToggle`.

## Rules

All rules share these common fields:

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Key or sequence that triggers the rule |
| `id` | `string?` | Stable ID for later enable/disable/remove. Auto-generated if omitted. |
| `app` | `string \| string[]?` | Only fire when this app is frontmost (see [App filter](#app-filter)) |
| `conditions` | `RuleConditions?` | Advanced condition control |
| `disabled` | `boolean?` | Start the rule disabled |

### Remap

Replace a key with a different key — or a whole sequence of keys:

```ts
{ key: Key.capsLock,   remap: Key.escape }
{ key: "NumpadEnter",  remap: "Cmd+return" }
{ key: "Ctrl+h",       remap: "left" }

// Remap to a sequence: original key is suppressed, steps are posted in order
{ key: "Ctrl+H E",     remap: `h e l l o Shift+n1 n1 ${Key.delete}` }
{ key: Key.eject,      remap: "Cmd+Ctrl+q" }  // single target, no sequence
```

### Execute

Run a shell command when a key fires. The key is consumed:

```ts
{ key: "Cmd+Shift+Space", execute: "open -a 'Alfred 5'" }

// Multiple commands run sequentially
{ key: Key.playPause, execute: [actions.media.playPause(), actions.app.focus("Spotify")] }
```

### Handler

Call a TypeScript function when a key fires. The key is consumed:

```ts
{ key: "Ctrl+J", handler: (e) => console.log("fired", e.keyCode) }

// Async handlers work too
{
  key: "Ctrl+Shift+L",
  handler: async () => {
    await rk.execute(actions.window.halfLeft())
  },
}
```

### Sequences

Space-separated steps in `key` make a sequence. Steps must be pressed within `sequenceTimeoutMs` (default: 5000ms):

```ts
{
  key: "Cmd+R T",
  execute: `osascript -e 'display notification "done"'`,
  consume: true,         // swallow Cmd+R and T so they don't reach the app
  sequenceTimeoutMs: 10_000,
}
```

`consume` is available on `execute` and `handler` rules. When true, all intermediate key events in the sequence are suppressed.

## App filter

Scope any rule to specific frontmost apps with the `app` field. Use a **bundle ID** (contains a dot) or a **display name** (prefix match, case-insensitive). Prefix with `!` to negate. Multiple values are OR-ed (negations are AND-ed).

```ts
// Only in Figma
{ key: "Cmd+W", execute: "...", app: "com.figma.Desktop" }

// Only in Terminal (display name prefix match)
{ key: "Ctrl+L", remap: "escape", app: "Terminal" }

// In any browser
{ key: "Cmd+L", handler: () => {}, app: ["Safari", "Chrome", "Firefox"] }

// Everywhere except VSCode
{ key: "Ctrl+P", handler: () => {}, app: "!com.microsoft.VSCode" }

// Everywhere except Chrome and Safari
{ key: "Cmd+R T", execute: "...", app: ["!com.google.Chrome", "!com.apple.Safari"] }
```

## Actions

Built-in helpers for common macOS tasks. Each returns a shell command string for use in `execute`, or can be run directly with `rk.execute()`.

```ts
import { actions } from "rethocker"

// Window layout (targets frontmost app, or pass app name/bundle ID)
actions.window.halfLeft()
actions.window.halfRight()
actions.window.halfTop()
actions.window.halfBottom()
actions.window.thirdLeft()
actions.window.thirdCenter()
actions.window.thirdRight()
actions.window.quarterTopLeft()
actions.window.maximize()
actions.window.halfLeft("Figma")      // move specific app

// App management
actions.app.focus("Slack")            // open if not running, bring to front
actions.app.focus("com.tinyspeck.slackmacgap") // by bundle ID
actions.app.quit("Slack")

// Media
actions.media.playPause()
actions.media.next()
actions.media.previous()
actions.media.mute()
actions.media.setVolume(50)
actions.media.volumeUp(10)
actions.media.volumeDown(10)

// System
actions.system.sleep()
actions.system.lockScreen()
actions.system.missionControl()
actions.system.emptyTrash()

// Run a Shortcut from the macOS Shortcuts app
actions.shortcut("My Shortcut Name")

// Use in rules
{ key: "Ctrl+Left",      execute: actions.window.halfLeft() }
{ key: "Ctrl+Shift+S",   execute: actions.app.focus("Slack") }
{ key: "F8",             execute: actions.media.playPause() }

// Multiple actions at once
{ key: "Ctrl+Alt+W", execute: [actions.window.halfLeft("Figma"), actions.app.focus("Slack")] }

// Run imperatively from a handler
{
  key: "Ctrl+Shift+L",
  handler: async () => {
    await rk.execute(actions.window.halfLeft())
  },
}
```

## Managing rules

```ts
const rk = rethocker([
  { key: Key.capsLock, remap: Key.escape, id: "caps-remap" },
])

// Add more rules later
rk.add({ key: "Ctrl+J", handler: () => {} })
rk.add([
  { key: "Ctrl+K", handler: () => {} },
  { key: "Ctrl+L", remap: "right" },
])

// Enable / disable by ID
rk.disable("caps-remap")
rk.enable("caps-remap")

// Disable / enable ALL rules on this instance
rk.disable()
rk.enable()

// Remove permanently
rk.remove("caps-remap")
```

## Discover key codes

Run the included debug script to see what keys produce:

```bash
bun node_modules/rethocker/src/scripts/debug-keys.ts
```

Output shows keyCode, modifiers, and active app for every keypress — useful for finding the right key name or checking that app filters work correctly.

## Events and lifecycle

```ts
const rk = rethocker([...])

// Daemon lifecycle
rk.on("ready", () => console.log("daemon ready"))
rk.on("exit",  (code) => { console.error(`exited (${code}), restarting...`); rk.start() })

// Permissions
rk.on("accessibilityDenied", () => {
  console.error("Go to System Settings → Privacy & Security → Accessibility")
})

// Errors
rk.on("error", (code, message) => console.error(`[${code}] ${message}`))

// Listen to all key events (key recorder / debugging)
// Stream activates automatically when subscribed, stops when unsubscribed.
const off = rk.on("key", (e) => {
  console.log(e.type, e.keyCode, e.modifiers, e.app, e.appBundleID)
})
off() // unsubscribe — stream deactivates automatically

// Optionally await startup to catch errors explicitly
await rk.start()

// Stop the daemon
await rk.stop()

// Let the process exit even while the daemon is running
// (by default rethocker keeps the event loop alive)
rk.unref()
```

## API reference

### `rethocker(rules?, options?)` → `RethockerHandle`

| Option | Type | Description |
|---|---|---|
| `binaryPath` | `string?` | Override the native binary path |

### `RethockerHandle`

| Method | Returns | Description |
|---|---|---|
| `add(rule \| rule[])` | `void` | Add one or more rules |
| `remove(id)` | `void` | Remove a rule permanently |
| `enable(id?)` | `void` | Enable a rule by ID, or all rules if no ID |
| `disable(id?)` | `void` | Disable a rule by ID, or all rules if no ID |
| `on(event, listener)` | `() => void` | Subscribe to an event; returns an unsubscribe function |
| `execute(command)` | `Promise<void>` | Run a shell command immediately (accepts `string \| string[]`) |
| `start()` | `Promise<void>` | Await daemon readiness (optional) |
| `stop()` | `Promise<void>` | Stop the daemon |
| `unref()` | `void` | Allow the process to exit while the daemon runs |
| `ready` | `boolean` | Whether the daemon is ready |

### Events

| Event | Arguments | Description |
|---|---|---|
| `"ready"` | — | Daemon ready |
| `"key"` | `KeyEvent` | Every key event (stream auto-activates on subscribe) |
| `"accessibilityDenied"` | — | Accessibility permission not granted |
| `"error"` | `code, message` | Native daemon error |
| `"exit"` | `code` | Native process exited unexpectedly |

### `KeyEvent`

| Field | Type | Description |
|---|---|---|
| `type` | `"keydown" \| "keyup" \| "flags"` | Event type |
| `keyCode` | `number` | macOS virtual key code |
| `modifiers` | `Modifier[]` | Active modifiers |
| `app` | `string?` | Frontmost app display name |
| `appBundleID` | `string?` | Frontmost app bundle ID |
| `suppressed` | `boolean` | Whether the key was consumed |
| `ruleID` | `string?` | ID of the matched rule |

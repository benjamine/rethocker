/**
 * Built-in macOS action helpers.
 *
 * Each function returns a shell command string suitable for use in the
 * `execute` field of a rule. Pass an array to `execute` to run multiple
 * actions together.
 *
 * @example
 * import { rethocker, actions } from "rethocker"
 *
 * const rk = rethocker([
 *   { key: "Ctrl+Left",      execute: actions.window.halfLeft() },
 *   { key: "Ctrl+Shift+S",   execute: actions.app.focus("Slack") },
 *   { key: "F8",             execute: actions.media.playPause() },
 *   // Multiple actions at once:
 *   { key: "Ctrl+Alt+L",     execute: [actions.window.halfLeft(), actions.app.focus("Slack")] },
 * ])
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Wrap an AppleScript string into a one-liner osascript call. */
function osascript(script: string): string {
  // Escape single quotes in the script for shell safety
  const escaped = script.replace(/'/g, "'\\''");
  return `osascript -e '${escaped}'`;
}

/**
 * Multi-line AppleScript — written to a temp file to avoid shell quoting issues.
 * Uses a heredoc so the script is passed cleanly regardless of content.
 */
function osascriptMultiline(script: string): string {
  // Use process substitution to avoid temp file cleanup concerns
  return `osascript << 'RETHOCKER_EOF'\n${script}\nRETHOCKER_EOF`;
}

// ─── Window layout ────────────────────────────────────────────────────────────

/**
 * AppleScript that positions a window on screen.
 * Gets screen bounds dynamically so it works on any display size.
 * Optionally targets a specific app by name; defaults to the frontmost app.
 * If the app is not running, it is launched first.
 */
function windowScript(
  posExpr: string, // e.g. "{0, menuBarH}"
  sizeExpr: string, // e.g. "{screenW / 2, screenH - menuBarH}"
  appName?: string,
): string {
  const activateBlock = appName
    ? `tell application "${appName}" to activate\ndelay 0.1`
    : "";
  const targetBlock = appName
    ? `tell application "${appName}"
        set bounds of window 1 to {item 1 of pos, item 2 of pos, (item 1 of pos) + (item 1 of sz), (item 2 of pos) + (item 2 of sz)}
    end tell`
    : `tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        tell process frontApp
            set position of window 1 to pos
            set size of window 1 to sz
        end tell
    end tell`;

  return osascriptMultiline(
    `
${activateBlock}
tell application "Finder"
    set screenBounds to bounds of window of desktop
end tell
set screenW to item 3 of screenBounds
set screenH to item 4 of screenBounds
set menuBarH to item 2 of screenBounds
set pos to ${posExpr}
set sz to ${sizeExpr}
${targetBlock}
`.trim(),
  );
}

export type AppTarget = string | undefined;

export const window = {
  /** Left half of screen */
  halfLeft: (app?: AppTarget) =>
    windowScript("{0, menuBarH}", "{screenW / 2, screenH - menuBarH}", app),

  /** Right half of screen */
  halfRight: (app?: AppTarget) =>
    windowScript(
      "{screenW / 2, menuBarH}",
      "{screenW / 2, screenH - menuBarH}",
      app,
    ),

  /** Top half of screen */
  halfTop: (app?: AppTarget) =>
    windowScript("{0, menuBarH}", "{screenW, (screenH - menuBarH) / 2}", app),

  /** Bottom half of screen */
  halfBottom: (app?: AppTarget) =>
    windowScript(
      "{0, menuBarH + (screenH - menuBarH) / 2}",
      "{screenW, (screenH - menuBarH) / 2}",
      app,
    ),

  /** Left third of screen */
  thirdLeft: (app?: AppTarget) =>
    windowScript("{0, menuBarH}", "{screenW / 3, screenH - menuBarH}", app),

  /** Center third of screen */
  thirdCenter: (app?: AppTarget) =>
    windowScript(
      "{screenW / 3, menuBarH}",
      "{screenW / 3, screenH - menuBarH}",
      app,
    ),

  /** Right third of screen */
  thirdRight: (app?: AppTarget) =>
    windowScript(
      "{(screenW / 3) * 2, menuBarH}",
      "{screenW / 3, screenH - menuBarH}",
      app,
    ),

  /** Top-left quadrant */
  quarterTopLeft: (app?: AppTarget) =>
    windowScript(
      "{0, menuBarH}",
      "{screenW / 2, (screenH - menuBarH) / 2}",
      app,
    ),

  /** Top-right quadrant */
  quarterTopRight: (app?: AppTarget) =>
    windowScript(
      "{screenW / 2, menuBarH}",
      "{screenW / 2, (screenH - menuBarH) / 2}",
      app,
    ),

  /** Bottom-left quadrant */
  quarterBottomLeft: (app?: AppTarget) =>
    windowScript(
      "{0, menuBarH + (screenH - menuBarH) / 2}",
      "{screenW / 2, (screenH - menuBarH) / 2}",
      app,
    ),

  /** Bottom-right quadrant */
  quarterBottomRight: (app?: AppTarget) =>
    windowScript(
      "{screenW / 2, menuBarH + (screenH - menuBarH) / 2}",
      "{screenW / 2, (screenH - menuBarH) / 2}",
      app,
    ),

  /** Maximize (fill the screen below the menu bar) */
  maximize: (app?: AppTarget) =>
    windowScript("{0, menuBarH}", "{screenW, screenH - menuBarH}", app),
};

// ─── App management ───────────────────────────────────────────────────────────

export const app = {
  /**
   * Open the app if not running, then bring it to the foreground.
   *
   * @example
   * execute: actions.app.focus("Slack")
   * execute: actions.app.focus("com.tinyspeck.slackmacgap") // bundle ID also works
   */
  focus: (nameOrBundleID: string): string => {
    // Bundle IDs contain dots — use `open -b` for them, `open -a` for names
    const isBundleID = nameOrBundleID.includes(".");
    return isBundleID
      ? `open -b '${nameOrBundleID}'`
      : `open -a '${nameOrBundleID}'`;
  },

  /**
   * Quit an app by name or bundle ID.
   *
   * @example
   * execute: actions.app.quit("Slack")
   */
  quit: (nameOrBundleID: string): string => {
    const isBundleID = nameOrBundleID.includes(".");
    return isBundleID
      ? osascript(`tell application id "${nameOrBundleID}" to quit`)
      : osascript(`tell application "${nameOrBundleID}" to quit`);
  },
};

// ─── Shortcuts app ────────────────────────────────────────────────────────────

/**
 * Run a named shortcut from the macOS Shortcuts app.
 *
 * @example
 * execute: actions.shortcut("Morning Routine")
 */
export function shortcut(name: string): string {
  return `shortcuts run '${name}'`;
}

// ─── Media ────────────────────────────────────────────────────────────────────

export const media = {
  /** Toggle play / pause in the active media app. */
  playPause: (): string =>
    osascript(`tell application "System Events" to key code 100`),

  /** Skip to next track. */
  next: (): string =>
    osascript(`tell application "System Events" to key code 101`),

  /** Go to previous track. */
  previous: (): string =>
    osascript(`tell application "System Events" to key code 98`),

  /** Toggle system audio mute. */
  mute: (): string =>
    osascript(
      `set volume output muted not (output muted of (get volume settings))`,
    ),

  /** Set system volume (0–100). */
  setVolume: (level: number): string =>
    osascript(`set volume output volume ${Math.max(0, Math.min(100, level))}`),

  /** Increase system volume by a step (default 10). */
  volumeUp: (step = 10): string =>
    osascript(
      `set vol to output volume of (get volume settings)\nset volume output volume (vol + ${step})`,
    ),

  /** Decrease system volume by a step (default 10). */
  volumeDown: (step = 10): string =>
    osascript(
      `set vol to output volume of (get volume settings)\nset volume output volume (vol - ${step})`,
    ),
};

// ─── System ───────────────────────────────────────────────────────────────────

export const system = {
  /** Put the Mac to sleep immediately. */
  sleep: (): string => osascript(`tell application "System Events" to sleep`),

  /** Lock the screen. */
  lockScreen: (): string =>
    `/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend`,

  /** Show the desktop (Mission Control: show desktop). */
  showDesktop: (): string =>
    osascript(
      `tell application "System Events" to key code 103 using {command down}`,
    ),

  /** Open Mission Control. */
  missionControl: (): string =>
    osascript(`tell application "Mission Control" to launch`),

  /** Empty the Trash. */
  emptyTrash: (): string =>
    osascript(`tell application "Finder" to empty trash`),
};

// ─── Top-level actions object ─────────────────────────────────────────────────

export const actions = {
  window,
  app,
  shortcut,
  media,
  system,
};

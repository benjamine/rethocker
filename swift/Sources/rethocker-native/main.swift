import ApplicationServices
import AppKit
import Foundation

// Disable stdout buffering immediately — critical so Bun sees output right away
setbuf(stdout, nil)

// MARK: - Accessibility permission check

func checkAccessibility() -> Bool {
    return AXIsProcessTrusted()
}

func requestAccessibility() -> Bool {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
    return AXIsProcessTrustedWithOptions(options as CFDictionary)
}

// MARK: - Startup sequence

// We need NSApplication to be initialized so AppKit (NSWorkspace) works.
// Running as a command-line tool, we use the shared app without activating it.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)  // no Dock icon, no menu bar

// Start IPC reader (reads stdin on a background thread)
IPCHandler.shared.startReadingStdin()

// Check accessibility — prompt the user if needed
if !requestAccessibility() {
    // Permission not yet granted. Emit an error and poll until granted.
    RuleEngine.shared.emit([
        "type": "error",
        "code": "accessibility_denied",
        "message": "Accessibility permission is required. Please grant it in System Preferences → Privacy & Security → Accessibility, then try again."
    ])

    // Poll every 500ms; once granted, set up the event tap
    var tapStarted = false
    Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { timer in
        if checkAccessibility() && !tapStarted {
            tapStarted = true
            timer.invalidate()
            DeviceMap.shared.start()
            AppWatcher.shared.start()
            EventTap.shared.start()
        }
    }
} else {
    // Permission already granted
    DeviceMap.shared.start()
    AppWatcher.shared.start()
    EventTap.shared.start()
}

// Run the main RunLoop — required for CGEventTap, NSWorkspace notifications, and timers.
// This blocks forever (until the process is killed or stdin closes).
RunLoop.main.run()

import AppKit
import Foundation

// Observes frontmost app changes and running app list using NSWorkspace.
// Runs on the main thread; updates are posted synchronously before the event tap
// callback reads them, so no locking is needed for the hot path.

final class AppWatcher {
    static let shared = AppWatcher()

    private(set) var frontmostBundleID: String? = nil
    private(set) var frontmostAppName: String? = nil
    private(set) var runningBundleIDs: Set<String> = []
    private(set) var runningAppNames: Set<String> = []

    private init() {}

    func start() {
        // Capture initial state
        refresh()

        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(
            self,
            selector: #selector(appActivated(_:)),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )
        nc.addObserver(
            self,
            selector: #selector(appLaunched(_:)),
            name: NSWorkspace.didLaunchApplicationNotification,
            object: nil
        )
        nc.addObserver(
            self,
            selector: #selector(appTerminated(_:)),
            name: NSWorkspace.didTerminateApplicationNotification,
            object: nil
        )
    }

    private func refresh() {
        let ws = NSWorkspace.shared
        frontmostBundleID = ws.frontmostApplication?.bundleIdentifier
        frontmostAppName = ws.frontmostApplication?.localizedName

        var bids = Set<String>()
        var names = Set<String>()
        for app in ws.runningApplications where app.activationPolicy == .regular {
            if let bid = app.bundleIdentifier { bids.insert(bid) }
            if let n = app.localizedName { names.insert(n) }
        }
        runningBundleIDs = bids
        runningAppNames = names
    }

    @objc private func appActivated(_ note: Notification) {
        if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
            frontmostBundleID = app.bundleIdentifier
            frontmostAppName = app.localizedName
        }
    }

    @objc private func appLaunched(_ note: Notification) {
        if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
            if let bid = app.bundleIdentifier { runningBundleIDs.insert(bid) }
            if let n = app.localizedName { runningAppNames.insert(n) }
        }
    }

    @objc private func appTerminated(_ note: Notification) {
        if let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication {
            if let bid = app.bundleIdentifier { runningBundleIDs.remove(bid) }
            if let n = app.localizedName { runningAppNames.remove(n) }
        }
    }

    // MARK: - Condition matching (called from event tap callback — must be fast)

    func matchesActiveApp(_ conditions: [AppCondition]) -> Bool {
        // Positive conditions are OR-ed: rule fires if frontmost app matches any of them.
        // Negative conditions (invert=true) are AND-ed: rule fires only if frontmost
        // app matches NONE of them.
        // If both are present, both must be satisfied.
        let positives = conditions.filter { !$0.invert }
        let negatives = conditions.filter { $0.invert }

        // Check negatives first (AND — any match means excluded)
        for cond in negatives {
            let match: Bool
            switch cond.kind {
            case .bundleID(let bid): match = frontmostBundleID == bid
            case .name(let n): match = frontmostAppName?.lowercased().hasPrefix(n.lowercased()) == true
            }
            if match { return false }  // excluded app is frontmost
        }

        // If there are positive conditions, at least one must match (OR)
        if !positives.isEmpty {
            for cond in positives {
                let match: Bool
                switch cond.kind {
                case .bundleID(let bid): match = frontmostBundleID == bid
                case .name(let n): match = frontmostAppName?.lowercased().hasPrefix(n.lowercased()) == true
                }
                if match { return true }
            }
            return false  // positives specified but none matched
        }

        return true  // only negatives, and none matched
    }

    func matchesRunningApps(_ conditions: [AppCondition]) -> Bool {
        let positives = conditions.filter { !$0.invert }
        let negatives = conditions.filter { $0.invert }

        for cond in negatives {
            let match: Bool
            switch cond.kind {
            case .bundleID(let bid): match = runningBundleIDs.contains(bid)
            case .name(let n):
                let lower = n.lowercased()
                match = runningAppNames.contains { $0.lowercased().hasPrefix(lower) }
            }
            if match { return false }
        }

        if !positives.isEmpty {
            for cond in positives {
                let match: Bool
                switch cond.kind {
                case .bundleID(let bid): match = runningBundleIDs.contains(bid)
                case .name(let n):
                    let lower = n.lowercased()
                    match = runningAppNames.contains { $0.lowercased().hasPrefix(lower) }
                }
                if match { return true }
            }
            return false
        }

        return true
    }
}

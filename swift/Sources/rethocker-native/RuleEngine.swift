import CoreGraphics
import Foundation

// The rule engine is the hot path: called from the CGEventTap callback for every keypress.
// It must complete in microseconds. All work that can be done off the hot path is:
//   - App state (AppWatcher) — updated via NSWorkspace notifications on main thread
//   - Text input state (TextInputDetector) — cached with 50ms TTL
//   - Rule list updates (IPCHandler) — swapped atomically

final class RuleEngine {
    static let shared = RuleEngine()
    private init() {}

    // Protected by being always mutated on the main RunLoop thread (same as CGEventTap)
    private var rules: [String: Rule] = [:]  // id → Rule
    private var keydownSequences: [SequenceRule] = []
    private var listenAll: Bool = false  // if true, emit every key event (for debugging/monitoring)

    // MARK: - Rule management (called from IPCHandler, dispatched to main thread)

    func upsertRule(_ rule: Rule) {
        rules[rule.id] = rule
    }

    func removeRule(id: String) {
        rules.removeValue(forKey: id)
    }

    func setRuleEnabled(id: String, enabled: Bool) {
        rules[id]?.enabled = enabled
    }

    func addSequenceRule(_ seq: SequenceRule) {
        keydownSequences.append(seq)
    }

    func removeSequenceRule(id: String) {
        keydownSequences.removeAll { $0.id == id }
    }

    func setSequenceRuleEnabled(id: String, enabled: Bool) {
        if let idx = keydownSequences.firstIndex(where: { $0.id == id }) {
            keydownSequences[idx].enabled = enabled
        }
    }

    func setListenAll(_ value: Bool) {
        listenAll = value
    }

    // MARK: - Media key hot path

    // Media keys arrive as NX_SYSDEFINED events (type 14) with NX_KEYTYPE_* codes.
    // We map them to a virtual keyCode space starting at 1000 to avoid collisions
    // with regular key codes (which max out around 127).
    // NX_KEYTYPE_SOUND_UP=0, SOUND_DOWN=1, BRIGHTNESS_UP=2, BRIGHTNESS_DOWN=3,
    // MUTE=7, PLAY=16, NEXT=17, PREVIOUS=18, ILLUMINATION_UP=21, etc.
    static let mediaKeyOffset: Int64 = 1000

    func processMediaKey(cgEvent: CGEvent, mediaKeyCode: Int, isKeyDown: Bool) -> CGEvent? {
        let virtualKeyCode = RuleEngine.mediaKeyOffset + Int64(mediaKeyCode)
        let combo = KeyCombo(keyCode: virtualKeyCode, modifiers: Modifiers())

        if listenAll {
            emit(keyEvent(
                type: isKeyDown ? "keydown" : "keyup",
                keyCode: virtualKeyCode,
                modifiers: Modifiers(),
                device: nil, ruleID: nil, eventID: nil, suppressed: false
            ))
        }

        if isKeyDown {
            for seq in keydownSequences where seq.enabled {
                if conditionsMatch(seq.conditions, device: nil) {
                    let suppress = SequenceTracker.shared.feed(
                        keyCode: virtualKeyCode, modifiers: Modifiers(), seqRule: seq
                    )
                    if suppress { return nil }
                }
            }
        }

        for rule in rules.values {
            guard rule.enabled else { continue }
            guard rule.trigger == combo else { continue }
            guard (isKeyDown && !rule.onKeyUp) || (!isKeyDown && rule.onKeyUp) else { continue }
            guard conditionsMatch(rule.conditions, device: nil) else { continue }
            return applyAction(rule.action, cgEvent: cgEvent, ruleID: rule.id)
        }

        return cgEvent
    }

    // MARK: - Hot path

    // Returns nil to suppress the event, or the (possibly modified) event to pass through.
    // Also emits JSON to stdout for matched rules.
    func process(
        cgEvent: CGEvent,
        eventType: CGEventType,
        keyCode: Int64,
        modifiers: Modifiers,
        device: DeviceInfo?
    ) -> CGEvent? {

        // ── Caps Lock special handling ──────────────────────────────────────
        // Caps Lock generates flagsChanged with keyCode 57, not keyDown/keyUp.
        //
        // macOS hardware-debounces Caps Lock: every physical press sends exactly
        // one flagsChanged event (unlike other modifiers which send press+release).
        // The maskAlphaShift flag toggles on that event.
        //
        // We treat each flagsChanged(keyCode=57) as a keyDown press — matching
        // how tools like Karabiner-Elements handle it. This makes remap rules
        // work: we suppress the original flagsChanged and post a synthetic
        // keyDown + keyUp pair for the target key.
        let isCapsLockEvent = eventType == .flagsChanged && keyCode == 57

        // Build the canonical combo for rule matching
        let combo = KeyCombo(keyCode: keyCode, modifiers: modifiers.canonical)

        let isKeyDown = eventType == .keyDown || isCapsLockEvent
        let isKeyUp   = eventType == .keyUp   // Caps Lock has no separate keyUp

        // Emit raw event if listenAll
        if listenAll {
            let typeStr: String
            if isCapsLockEvent            { typeStr = "keydown" }
            else if eventType == .keyDown { typeStr = "keydown" }
            else if eventType == .keyUp   { typeStr = "keyup" }
            else                          { typeStr = "flags" }
            emit(keyEvent(
                type: typeStr,
                keyCode: keyCode,
                modifiers: modifiers,
                device: device,
                ruleID: nil,
                eventID: nil,
                suppressed: false
            ))
        }

        // Skip unrelated flagsChanged events (other modifier keys, not Caps Lock)
        if eventType == .flagsChanged && !isCapsLockEvent {
            return cgEvent
        }

        // Feed sequence detectors on keydown only
        if isKeyDown {
            for seq in keydownSequences where seq.enabled {
                if conditionsMatch(seq.conditions, device: device) {
                    let suppress = SequenceTracker.shared.feed(
                        keyCode: keyCode,
                        modifiers: modifiers.canonical,
                        seqRule: seq
                    )
                    if suppress { return nil }
                }
            }
        }

        // Match individual rules
        for rule in rules.values {
            guard rule.enabled else { continue }
            guard rule.trigger == combo else { continue }
            guard (isKeyDown && !rule.onKeyUp) || (isKeyUp && rule.onKeyUp) else { continue }
            guard conditionsMatch(rule.conditions, device: device) else { continue }

            return applyAction(rule.action, cgEvent: cgEvent, ruleID: rule.id)
        }

        return cgEvent
    }

    // MARK: - Condition evaluation (fast path)

    private func conditionsMatch(_ conds: RuleConditions, device: DeviceInfo?) -> Bool {
        // Active app filter
        if let appConds = conds.activeApp {
            if !AppWatcher.shared.matchesActiveApp(appConds) { return false }
        }

        // Running apps filter
        if let runningConds = conds.runningApps {
            if !AppWatcher.shared.matchesRunningApps(runningConds) { return false }
        }

        return true
    }

    private func conditionsMatch(_ conds: SequenceConditions, device: DeviceInfo?) -> Bool {
        if let appConds = conds.activeApp {
            if !AppWatcher.shared.matchesActiveApp(appConds) { return false }
        }
        return true
    }

    // MARK: - Action execution

    private func applyAction(_ action: RuleAction, cgEvent: CGEvent, ruleID: String) -> CGEvent? {
        let originalKeyCode = cgEvent.getIntegerValueField(.keyboardEventKeycode)
        let originalModifiers = Modifiers.from(cgFlags: cgEvent.flags)
        let isCapsLock = cgEvent.type == .flagsChanged && originalKeyCode == 57

        switch action {
        case .suppress:
            emit(keyEvent(
                type: "matched", keyCode: originalKeyCode,
                modifiers: originalModifiers,
                device: nil, ruleID: ruleID, eventID: nil, suppressed: true
            ))
            return nil  // suppress

        case .remap(let toKeyCode, let toModifiers):
            let targetFlags = toModifiers.toCGEventFlags()

            if isCapsLock {
                // Caps Lock comes in as flagsChanged — we can't replace it inline.
                // Post a synthetic keyDown + keyUp pair directly into the event stream,
                // then suppress the original flagsChanged event.
                if let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(toKeyCode), keyDown: true) {
                    down.flags = targetFlags
                    down.post(tap: .cgSessionEventTap)
                }
                if let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(toKeyCode), keyDown: false) {
                    up.flags = targetFlags
                    up.post(tap: .cgSessionEventTap)
                }
                emit(keyEvent(
                    type: "matched", keyCode: originalKeyCode,
                    modifiers: originalModifiers,
                    device: nil, ruleID: ruleID, eventID: nil, suppressed: true
                ))
                return nil  // suppress the original Caps Lock flagsChanged
            } else {
                // Normal key: replace the event inline (efficient, no extra posting)
                let newEvent = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(toKeyCode), keyDown: true)
                newEvent?.flags = targetFlags
                emit(keyEvent(
                    type: "matched", keyCode: originalKeyCode,
                    modifiers: originalModifiers,
                    device: nil, ruleID: ruleID, eventID: nil, suppressed: false
                ))
                return newEvent ?? cgEvent
            }

        case .remapSequence(let steps):
            // Post each step as a keyDown+keyUp pair, with a small delay between steps
            // to ensure apps process them as distinct keystrokes.
            DispatchQueue.global(qos: .userInteractive).async {
                for (index, step) in steps.enumerated() {
                    if let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(step.keyCode), keyDown: true) {
                        down.flags = step.modifiers.toCGEventFlags()
                        down.post(tap: .cgSessionEventTap)
                    }
                    if let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(step.keyCode), keyDown: false) {
                        up.flags = step.modifiers.toCGEventFlags()
                        up.post(tap: .cgSessionEventTap)
                    }
                    // Small delay between steps (not after the last one)
                    if index < steps.count - 1 {
                        Thread.sleep(forTimeInterval: 0.02)
                    }
                }
            }
            emit(keyEvent(
                type: "matched", keyCode: originalKeyCode,
                modifiers: originalModifiers,
                device: nil, ruleID: ruleID, eventID: nil, suppressed: true
            ))
            return nil  // suppress the original key

        case .run(let command):
            // Fire-and-forget: don't block the event tap
            let cmd = command
            DispatchQueue.global(qos: .userInitiated).async {
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: "/bin/sh")
                proc.arguments = ["-c", cmd]
                try? proc.run()
                // We don't wait for completion — the TS layer can listen for process events
            }
            emit(keyEvent(
                type: "matched", keyCode: cgEvent.getIntegerValueField(.keyboardEventKeycode),
                modifiers: Modifiers.from(cgFlags: cgEvent.flags),
                device: nil, ruleID: ruleID, eventID: nil, suppressed: false
            ))
            return nil  // suppress the original key when running a command

        case .emit(let eventID):
            emit(keyEvent(
                type: "matched", keyCode: cgEvent.getIntegerValueField(.keyboardEventKeycode),
                modifiers: Modifiers.from(cgFlags: cgEvent.flags),
                device: nil, ruleID: ruleID, eventID: eventID, suppressed: true
            ))
            return nil
        }
    }

    // MARK: - JSON output

    func emitSequenceMatch(id: String, eventID: String?) {
        var obj: [String: Any] = ["type": "sequence_matched", "ruleID": id]
        if let eid = eventID { obj["eventID"] = eid }
        emit(obj)
    }

    private func keyEvent(
        type: String,
        keyCode: Int64,
        modifiers: Modifiers,
        device: DeviceInfo?,
        ruleID: String?,
        eventID: String?,
        suppressed: Bool
    ) -> [String: Any] {
        var obj: [String: Any] = [
            "type": type,
            "keyCode": keyCode,
            "modifiers": modifiers.toStringArray(),
            "suppressed": suppressed,
        ]
        if let rid = ruleID { obj["ruleID"] = rid }
        if let eid = eventID { obj["eventID"] = eid }
        if let dev = device {
            obj["device"] = dev.id
            if let name = dev.name { obj["deviceName"] = name }
        }
        if let appName = AppWatcher.shared.frontmostAppName { obj["app"] = appName }
        if let bundleID = AppWatcher.shared.frontmostBundleID { obj["appBundleID"] = bundleID }
        return obj
    }

    func emit(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let str = String(data: data, encoding: .utf8) else { return }
        print(str)
    }
}

// MARK: - Modifiers → CGEventFlags

extension Modifiers {
    func toCGEventFlags() -> CGEventFlags {
        var flags = CGEventFlags()
        if contains(.cmd) || contains(.leftCmd) || contains(.rightCmd) { flags.insert(.maskCommand) }
        if contains(.shift) || contains(.leftShift) || contains(.rightShift) { flags.insert(.maskShift) }
        if contains(.alt) || contains(.leftAlt) || contains(.rightAlt) { flags.insert(.maskAlternate) }
        if contains(.ctrl) || contains(.leftCtrl) || contains(.rightCtrl) { flags.insert(.maskControl) }
        if contains(.fn) { flags.insert(.maskSecondaryFn) }
        return flags
    }
}

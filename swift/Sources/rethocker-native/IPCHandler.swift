import Foundation

// Reads newline-delimited JSON commands from stdin and dispatches them to
// RuleEngine / SequenceTracker on the main thread.
// All mutations of RuleEngine state are dispatched to the main RunLoop thread
// so they are serialized with the CGEventTap callback — no locks needed.

final class IPCHandler {
    static let shared = IPCHandler()
    private init() {}

    func startReadingStdin() {
        Thread.detachNewThread {
            while let line = readLine(strippingNewline: true) {
                guard !line.isEmpty else { continue }
                guard
                    let data = line.data(using: .utf8),
                    let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let cmd = obj["cmd"] as? String
                else {
                    self.emitError("parse_error", message: "Could not parse command: \(line)")
                    continue
                }
                // Dispatch mutations to main thread (same as event tap callback)
                DispatchQueue.main.async {
                    self.handle(cmd: cmd, payload: obj)
                }
            }
            // stdin closed → parent process died → exit
            exit(0)
        }
    }

    // MARK: - Command dispatch

    private func handle(cmd: String, payload: [String: Any]) {
        switch cmd {
        case "add_rule":
            guard let rule = parseRule(payload) else {
                emitError("parse_error", message: "Invalid add_rule payload")
                return
            }
            RuleEngine.shared.upsertRule(rule)
            emitAck(payload["id"] as? String)

        case "remove_rule":
            guard let id = payload["id"] as? String else { return }
            RuleEngine.shared.removeRule(id: id)
            emitAck(id)

        case "set_rule_enabled":
            guard let id = payload["id"] as? String,
                  let enabled = payload["enabled"] as? Bool else { return }
            RuleEngine.shared.setRuleEnabled(id: id, enabled: enabled)
            emitAck(id)

        case "add_sequence":
            guard let seq = parseSequenceRule(payload) else {
                emitError("parse_error", message: "Invalid add_sequence payload")
                return
            }
            RuleEngine.shared.addSequenceRule(seq)
            SequenceTracker.shared.addSequence(seq)
            emitAck(payload["id"] as? String)

        case "remove_sequence":
            guard let id = payload["id"] as? String else { return }
            RuleEngine.shared.removeSequenceRule(id: id)
            SequenceTracker.shared.removeSequence(id: id)
            emitAck(id)

        case "set_sequence_enabled":
            guard let id = payload["id"] as? String,
                  let enabled = payload["enabled"] as? Bool else { return }
            RuleEngine.shared.setSequenceRuleEnabled(id: id, enabled: enabled)
            if !enabled { SequenceTracker.shared.removeSequence(id: id) }
            emitAck(id)

        case "listen_all":
            let enable = payload["enabled"] as? Bool ?? true
            RuleEngine.shared.setListenAll(enable)
            emitAck(nil)

        case "ping":
            RuleEngine.shared.emit(["type": "pong"])

        default:
            emitError("unknown_command", message: "Unknown command: \(cmd)")
        }
    }

    // MARK: - Parsing helpers

    private func parseRule(_ p: [String: Any]) -> Rule? {
        guard
            let id = p["id"] as? String,
            let triggerMap = p["trigger"] as? [String: Any],
            let keyCode = triggerMap["keyCode"] as? Int
        else { return nil }

        let modStrings = (triggerMap["modifiers"] as? [String]) ?? []
        let modifiers = parseModifiers(modStrings).canonical

        guard let action = parseAction(p["action"] as? [String: Any]) else { return nil }
        let conditions = parseConditions(p["conditions"] as? [String: Any])

        return Rule(
            id: id,
            enabled: p["enabled"] as? Bool ?? true,
            trigger: KeyCombo(keyCode: Int64(keyCode), modifiers: modifiers),
            conditions: conditions,
            action: action,
            onKeyUp: p["onKeyUp"] as? Bool ?? false
        )
    }

    private func parseSequenceRule(_ p: [String: Any]) -> SequenceRule? {
        guard
            let id = p["id"] as? String,
            let stepsRaw = p["steps"] as? [[String: Any]]
        else { return nil }

        let steps: [KeyCombo] = stepsRaw.compactMap { step in
            guard let keyCode = step["keyCode"] as? Int else { return nil }
            let mods = parseModifiers((step["modifiers"] as? [String]) ?? []).canonical
            return KeyCombo(keyCode: Int64(keyCode), modifiers: mods)
        }
        guard !steps.isEmpty else { return nil }

        guard let action = parseAction(p["action"] as? [String: Any]) else { return nil }

        let condMap = p["conditions"] as? [String: Any]
        let seqConds = SequenceConditions(
            activeApp: parseAppConditions(condMap, key: "activeApp")
        )

        return SequenceRule(
            id: id,
            enabled: p["enabled"] as? Bool ?? true,
            steps: steps,
            timeoutMs: p["timeoutMs"] as? Int ?? 5000,
            conditions: seqConds,
            action: action,
            eventID: p["eventID"] as? String,
            consume: p["consume"] as? Bool ?? false
        )
    }

    private func parseAction(_ p: [String: Any]?) -> RuleAction? {
        guard let p, let type = p["type"] as? String else { return nil }
        switch type {
        case "suppress":
            return .suppress
        case "remap":
            guard let keyCode = p["keyCode"] as? Int else { return nil }
            let mods = parseModifiers((p["modifiers"] as? [String]) ?? [])
            return .remap(keyCode: Int64(keyCode), modifiers: mods)
        case "remap_sequence":
            guard let stepsRaw = p["steps"] as? [[String: Any]] else { return nil }
            let steps: [KeyStep] = stepsRaw.compactMap { s in
                guard let keyCode = s["keyCode"] as? Int else { return nil }
                let mods = parseModifiers((s["modifiers"] as? [String]) ?? [])
                return KeyStep(keyCode: Int64(keyCode), modifiers: mods)
            }
            guard !steps.isEmpty else { return nil }
            return .remapSequence(steps: steps)
        case "run":
            guard let command = p["command"] as? String else { return nil }
            return .run(command: command)
        case "emit":
            guard let eventID = p["eventID"] as? String else { return nil }
            return .emit(eventID: eventID)
        default:
            return nil
        }
    }

    private func parseConditions(_ p: [String: Any]?) -> RuleConditions {
        return RuleConditions(
            activeApp: parseAppConditions(p, key: "activeApp"),
            runningApps: parseAppConditions(p, key: "runningApps")
        )
    }

    private func parseAppConditions(_ p: [String: Any]?, key: String) -> [AppCondition]? {
        guard let arr = p?[key] as? [[String: Any]], !arr.isEmpty else { return nil }
        return arr.compactMap { item -> AppCondition? in
            let invert = item["invert"] as? Bool ?? false
            if let bid = item["bundleID"] as? String {
                return AppCondition(kind: .bundleID(bid), invert: invert)
            } else if let name = item["name"] as? String {
                return AppCondition(kind: .name(name), invert: invert)
            }
            return nil
        }
    }

    private func parseModifiers(_ strings: [String]) -> Modifiers {
        var m = Modifiers()
        for s in strings {
            switch s {
            case "cmd":        m.insert(.cmd)
            case "shift":      m.insert(.shift)
            case "alt":        m.insert(.alt)
            case "ctrl":       m.insert(.ctrl)
            case "fn":         m.insert(.fn)
            case "leftCmd":    m.insert([.cmd, .leftCmd])
            case "rightCmd":   m.insert([.cmd, .rightCmd])
            case "leftShift":  m.insert([.shift, .leftShift])
            case "rightShift": m.insert([.shift, .rightShift])
            case "leftAlt":    m.insert([.alt, .leftAlt])
            case "rightAlt":   m.insert([.alt, .rightAlt])
            case "leftCtrl":   m.insert([.ctrl, .leftCtrl])
            case "rightCtrl":  m.insert([.ctrl, .rightCtrl])
            default: break
            }
        }
        return m
    }

    // MARK: - Emit helpers

    private func emitAck(_ id: String?) {
        var obj: [String: Any] = ["type": "ack"]
        if let id { obj["id"] = id }
        RuleEngine.shared.emit(obj)
    }

    private func emitError(_ code: String, message: String) {
        RuleEngine.shared.emit(["type": "error", "code": code, "message": message])
    }
}

import CoreGraphics
import Foundation

// A sequence rule: a series of key combos that must be pressed within a timeout.

struct SequenceConditions {
    var activeApp: [AppCondition]?
}

struct SequenceRule {
    let id: String
    var enabled: Bool
    let steps: [KeyCombo]       // ordered list of combos to match
    let timeoutMs: Int
    let conditions: SequenceConditions
    let action: RuleAction
    let eventID: String?
    // When true, all key events that are part of the sequence are consumed —
    // they never reach the active app.
    let consume: Bool
}

final class SequenceTracker {
    static let shared = SequenceTracker()
    private init() {}

    private struct State {
        var nextStep: Int = 0
        var lastMatchTime: UInt64 = 0
    }
    private var states: [String: State] = [:]

    func addSequence(_ rule: SequenceRule) {
        states[rule.id] = State()
    }

    func removeSequence(id: String) {
        states.removeValue(forKey: id)
    }

    // Feed a keydown event into all matching sequences.
    // Returns true if the key should be consumed (i.e. it completed a consume-sequence,
    // or it is an intermediate step of one and consume is enabled for that sequence).
    @discardableResult
    func feed(keyCode: Int64, modifiers: Modifiers, seqRule: SequenceRule) -> Bool {
        guard var state = states[seqRule.id] else {
            states[seqRule.id] = State()
            return feed(keyCode: keyCode, modifiers: modifiers, seqRule: seqRule)
        }

        let now = DispatchTime.now().uptimeNanoseconds
        let timeoutNs = UInt64(seqRule.timeoutMs) * 1_000_000

        // Reset if timeout expired
        if state.nextStep > 0 && (now - state.lastMatchTime) > timeoutNs {
            state.nextStep = 0
        }

        let expectedStep = seqRule.steps[state.nextStep]
        let combo = KeyCombo(keyCode: keyCode, modifiers: modifiers)

        if combo == expectedStep {
            state.nextStep += 1
            state.lastMatchTime = now

            if state.nextStep == seqRule.steps.count {
                // Sequence complete — fire the action
                state.nextStep = 0
                states[seqRule.id] = state
                fireSequence(seqRule)
                // Consume this final key if consume is on
                return seqRule.consume
            } else {
                // Intermediate step matched — consume if consume is on
                states[seqRule.id] = state
                return seqRule.consume
            }
        } else {
            // Mismatch: reset, then check if this key starts the sequence over
            state.nextStep = 0
            if combo == seqRule.steps[0] {
                state.nextStep = 1
                state.lastMatchTime = now
                states[seqRule.id] = state
                // First step matched — consume if consume is on
                return seqRule.consume
            }
            states[seqRule.id] = state
            return false
        }
    }

    private func fireSequence(_ rule: SequenceRule) {
        switch rule.action {
        case .emit(let eventID):
            RuleEngine.shared.emitSequenceMatch(id: rule.id, eventID: eventID)
        case .run(let command):
            DispatchQueue.global(qos: .userInitiated).async {
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: "/bin/sh")
                proc.arguments = ["-c", command]
                try? proc.run()
            }
            RuleEngine.shared.emitSequenceMatch(id: rule.id, eventID: nil)
        case .remap(let keyCode, let modifiers):
            // Post a single remap key event
            DispatchQueue.global(qos: .userInteractive).async {
                if let down = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: true) {
                    down.flags = modifiers.toCGEventFlags()
                    down.post(tap: .cgSessionEventTap)
                }
                if let up = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: false) {
                    up.flags = modifiers.toCGEventFlags()
                    up.post(tap: .cgSessionEventTap)
                }
            }
            RuleEngine.shared.emitSequenceMatch(id: rule.id, eventID: nil)
        case .remapSequence(let steps):
            // Post each step in order
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
                    if index < steps.count - 1 {
                        Thread.sleep(forTimeInterval: 0.02)
                    }
                }
            }
            RuleEngine.shared.emitSequenceMatch(id: rule.id, eventID: nil)
        case .suppress:
            break  // sequence already consumed — nothing to post
        }
    }
}

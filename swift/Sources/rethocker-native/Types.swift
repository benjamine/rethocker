import CoreGraphics
import Foundation

// MARK: - Modifier flags

struct Modifiers: OptionSet, Hashable, Codable {
    let rawValue: UInt32

    static let cmd      = Modifiers(rawValue: 1 << 0)
    static let shift    = Modifiers(rawValue: 1 << 1)
    static let alt      = Modifiers(rawValue: 1 << 2)  // Option/Alt
    static let ctrl     = Modifiers(rawValue: 1 << 3)
    static let fn       = Modifiers(rawValue: 1 << 4)
    static let leftCmd  = Modifiers(rawValue: 1 << 5)
    static let rightCmd = Modifiers(rawValue: 1 << 6)
    static let leftShift  = Modifiers(rawValue: 1 << 7)
    static let rightShift = Modifiers(rawValue: 1 << 8)
    static let leftAlt  = Modifiers(rawValue: 1 << 9)
    static let rightAlt = Modifiers(rawValue: 1 << 10)
    static let leftCtrl = Modifiers(rawValue: 1 << 11)
    static let rightCtrl = Modifiers(rawValue: 1 << 12)

    // NX device-specific bitmasks from <IOKit/hidsystem/IOLLEvent.h>
    private static let NX_DEVICELCTLKEYMASK:  CGEventFlags = CGEventFlags(rawValue: 0x00000001)
    private static let NX_DEVICELSHIFTKEYMASK: CGEventFlags = CGEventFlags(rawValue: 0x00000002)
    private static let NX_DEVICERSHIFTKEYMASK: CGEventFlags = CGEventFlags(rawValue: 0x00000004)
    private static let NX_DEVICELCMDKEYMASK:  CGEventFlags = CGEventFlags(rawValue: 0x00000008)
    private static let NX_DEVICERCMDKEYMASK:  CGEventFlags = CGEventFlags(rawValue: 0x00000010)
    private static let NX_DEVICELALTKEYMASK:  CGEventFlags = CGEventFlags(rawValue: 0x00000020)
    private static let NX_DEVICERALTKEYMASK:  CGEventFlags = CGEventFlags(rawValue: 0x00000040)
    private static let NX_DEVICERCTLKEYMASK:  CGEventFlags = CGEventFlags(rawValue: 0x00002000)

    static func from(cgFlags: CGEventFlags) -> Modifiers {
        var m = Modifiers()
        // Combined (side-agnostic) flags
        if cgFlags.contains(.maskCommand)       { m.insert(.cmd) }
        if cgFlags.contains(.maskShift)         { m.insert(.shift) }
        if cgFlags.contains(.maskAlternate)     { m.insert(.alt) }
        if cgFlags.contains(.maskControl)       { m.insert(.ctrl) }
        if cgFlags.contains(.maskSecondaryFn)   { m.insert(.fn) }
        // Left/right specific
        if cgFlags.rawValue & NX_DEVICELCMDKEYMASK.rawValue != 0  { m.insert(.leftCmd) }
        if cgFlags.rawValue & NX_DEVICERCMDKEYMASK.rawValue != 0  { m.insert(.rightCmd) }
        if cgFlags.rawValue & NX_DEVICELSHIFTKEYMASK.rawValue != 0 { m.insert(.leftShift) }
        if cgFlags.rawValue & NX_DEVICERSHIFTKEYMASK.rawValue != 0 { m.insert(.rightShift) }
        if cgFlags.rawValue & NX_DEVICELALTKEYMASK.rawValue != 0  { m.insert(.leftAlt) }
        if cgFlags.rawValue & NX_DEVICERALTKEYMASK.rawValue != 0  { m.insert(.rightAlt) }
        if cgFlags.rawValue & NX_DEVICELCTLKEYMASK.rawValue != 0  { m.insert(.leftCtrl) }
        if cgFlags.rawValue & NX_DEVICERCTLKEYMASK.rawValue != 0  { m.insert(.rightCtrl) }
        return m
    }

    func toStringArray() -> [String] {
        var result: [String] = []
        if contains(.cmd)        { result.append("cmd") }
        if contains(.shift)      { result.append("shift") }
        if contains(.alt)        { result.append("alt") }
        if contains(.ctrl)       { result.append("ctrl") }
        if contains(.fn)         { result.append("fn") }
        if contains(.leftCmd)    { result.append("leftCmd") }
        if contains(.rightCmd)   { result.append("rightCmd") }
        if contains(.leftShift)  { result.append("leftShift") }
        if contains(.rightShift) { result.append("rightShift") }
        if contains(.leftAlt)    { result.append("leftAlt") }
        if contains(.rightAlt)   { result.append("rightAlt") }
        if contains(.leftCtrl)   { result.append("leftCtrl") }
        if contains(.rightCtrl)  { result.append("rightCtrl") }
        return result
    }

    // Canonical (side-agnostic) subset for rule matching
    var canonical: Modifiers {
        var m = Modifiers()
        if contains(.cmd) || contains(.leftCmd) || contains(.rightCmd) { m.insert(.cmd) }
        if contains(.shift) || contains(.leftShift) || contains(.rightShift) { m.insert(.shift) }
        if contains(.alt) || contains(.leftAlt) || contains(.rightAlt) { m.insert(.alt) }
        if contains(.ctrl) || contains(.leftCtrl) || contains(.rightCtrl) { m.insert(.ctrl) }
        if contains(.fn) { m.insert(.fn) }
        return m
    }
}

// MARK: - Key combo

struct KeyCombo: Hashable {
    let keyCode: Int64
    let modifiers: Modifiers  // canonical modifiers for matching
}

// MARK: - Rule condition

struct AppCondition {
    enum Kind {
        case bundleID(String)       // e.g. "com.apple.Terminal"
        case name(String)           // e.g. "Terminal" (display name, prefix match)
    }
    let kind: Kind
    let invert: Bool               // if true: "not this app"
}

struct RuleConditions {
    var activeApp: [AppCondition]?   // OR within the array; nil = any app
    var runningApps: [AppCondition]? // OR; nil = any
    var textInput: Bool?             // nil = don't care; true = only in text fields; false = only outside
}

// MARK: - Rule actions

struct KeyStep {
    let keyCode: Int64
    let modifiers: Modifiers
}

enum RuleAction {
    case suppress                                          // eat the keydown, do nothing
    case remap(keyCode: Int64, modifiers: Modifiers)       // send a different key
    case remapSequence(steps: [KeyStep])                   // send multiple keys in order
    case run(command: String)                              // run a shell command async
    case emit(eventID: String)                             // emit a named event to the TS layer
}

// MARK: - Rule

struct Rule {
    let id: String
    var enabled: Bool
    let trigger: KeyCombo
    let conditions: RuleConditions
    let action: RuleAction
    var onKeyUp: Bool  // fire on keyup instead of keydown (for suppress, emit only)
}

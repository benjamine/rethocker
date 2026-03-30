import AppKit
import CoreGraphics
import Foundation

final class EventTap {
    static let shared = EventTap()
    private init() {}

    private var tapPort: CFMachPort?
    private var runLoopSource: CFRunLoopSource?

    func start() {
        // NX_SYSDEFINED (14) carries media/system keys: volume, brightness,
        // play/pause, next/previous, keyboard illumination, etc.
        let nxSysDefined = CGEventType(rawValue: 14)!
        let mask: CGEventMask =
            (1 << CGEventType.keyDown.rawValue) |
            (1 << CGEventType.keyUp.rawValue) |
            (1 << CGEventType.flagsChanged.rawValue) |
            (1 << nxSysDefined.rawValue)

        tapPort = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: eventTapCallback,
            userInfo: nil   // we use singletons, no context needed
        )

        guard let tapPort else {
            RuleEngine.shared.emit(["type": "error", "code": "tap_create_failed",
                "message": "CGEvent.tapCreate returned nil — Accessibility permission likely denied"])
            return
        }

        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tapPort, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tapPort, enable: true)

        RuleEngine.shared.emit(["type": "ready"])
    }

    func reenable() {
        if let tapPort {
            CGEvent.tapEnable(tap: tapPort, enable: true)
        }
    }
}

// Top-level C-convention callback — required by CGEventTap API.
// Must return quickly (< a few ms) or macOS will auto-disable the tap.
private func eventTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {

    // If tap got auto-disabled (slow callback), re-enable immediately
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        EventTap.shared.reenable()
        return nil
    }

    // NX_SYSDEFINED (type 14) — media/system keys
    // data1 encoding: bits 16-23 = NX_KEYTYPE_*, bit 0 = 0 (keydown) / 1 (keyup)
    if type.rawValue == 14 {
        let data1 = event.getIntegerValueField(CGEventField(rawValue: 119)!)  // kCGEventSourceUserData holds compound data
        // The compound event data is in a non-public field; use NSEvent to decode it
        if let nsEvent = NSEvent(cgEvent: event),
           nsEvent.subtype.rawValue == 8 {  // NX_SUBTYPE_AUX_CONTROL_BUTTONS = 8
            let d1 = nsEvent.data1
            let mediaKeyCode = Int((d1 & 0xFFFF0000) >> 16)
            let keyDown = (d1 & 0xFF00) == 0x0A00  // 0x0A00 = down, 0x0B00 = up
            let result = RuleEngine.shared.processMediaKey(
                cgEvent: event,
                mediaKeyCode: mediaKeyCode,
                isKeyDown: keyDown
            )
            guard let result else { return nil }
            return Unmanaged.passUnretained(result)
        }
        return Unmanaged.passUnretained(event)
    }

    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    let modifiers = Modifiers.from(cgFlags: event.flags)

    // Invalidate text-input cache on app switch
    if type == .flagsChanged {
        TextInputDetector.shared.invalidate()
    }

    let result = RuleEngine.shared.process(
        cgEvent: event,
        eventType: type,
        keyCode: keyCode,
        modifiers: modifiers
    )

    guard let result else { return nil }  // suppressed
    return Unmanaged.passUnretained(result)
}

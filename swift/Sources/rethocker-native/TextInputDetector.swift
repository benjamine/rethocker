import ApplicationServices
import Foundation

// Detects whether a text input field is currently focused in the frontmost app.
// Uses the Accessibility API. This is an on-demand synchronous call made inside
// the event tap callback. It must be fast — we use a short timeout and a cache
// that expires every 50ms to avoid redundant AX calls on rapid key repeats.

final class TextInputDetector {
    static let shared = TextInputDetector()
    private init() {}

    // Text-accepting AX roles
    private static let textRoles: Set<String> = [
        "AXTextField",
        "AXTextArea",
        "AXComboBox",
        "AXSearchField",
        "AXSecureTextField",
        "AXIncrementor",   // number steppers accept text input
    ]

    // Subroles that indicate editable content in web browsers / Electron apps
    private static let textSubroles: Set<String> = [
        "AXTextFieldSubrole",
        "AXSearchFieldSubrole",
    ]

    // Simple cache: only re-check after 50ms
    private var cachedResult: Bool = false
    private var cacheTimestamp: UInt64 = 0
    private let cacheTTL: UInt64 = 50_000_000  // 50ms in nanoseconds

    func isTextInputFocused() -> Bool {
        let now = DispatchTime.now().uptimeNanoseconds
        if now - cacheTimestamp < cacheTTL {
            return cachedResult
        }

        let result = checkTextInputFocused()
        cachedResult = result
        cacheTimestamp = now
        return result
    }

    private func checkTextInputFocused() -> Bool {
        // Get the focused UI element of the system (frontmost app's focused element)
        let systemElement = AXUIElementCreateSystemWide()
        var focusedElement: CFTypeRef?

        let err = AXUIElementCopyAttributeValue(
            systemElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedElement
        )

        guard err == .success, let element = focusedElement else {
            return false
        }

        let axElement = element as! AXUIElement
        return isTextElement(axElement) || isTextElement(findFocusedDescendant(axElement))
    }

    private func isTextElement(_ element: AXUIElement?) -> Bool {
        guard let element else { return false }

        // Check role
        var roleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleRef)
        if let role = roleRef as? String {
            if TextInputDetector.textRoles.contains(role) { return true }
        }

        // Check subrole (catches some browser text fields)
        var subroleRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subroleRef)
        if let subrole = subroleRef as? String {
            if TextInputDetector.textSubroles.contains(subrole) { return true }
        }

        // Check if it's editable (AXEditable attribute or AXTextValue + not read-only)
        // Some apps (e.g. Electron) report a role of "AXWebArea" but the focused element
        // inside a contenteditable has AXEditable = true and AXValue.
        var editableRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, "AXEditable" as CFString, &editableRef)
        if let editable = editableRef as? Bool, editable {
            // Also verify it has a value (to exclude non-text editable containers)
            var valueRef: CFTypeRef?
            AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueRef)
            if valueRef != nil { return true }
        }

        return false
    }

    // Some apps (Electron, browsers) nest the real focused element under a container.
    // Walk up to two levels to find a text element.
    private func findFocusedDescendant(_ element: AXUIElement) -> AXUIElement? {
        var childRef: CFTypeRef?
        AXUIElementCopyAttributeValue(element, kAXFocusedUIElementAttribute as CFString, &childRef)
        guard let child = childRef else { return nil }
        return (child as! AXUIElement)
    }

    // Invalidate cache (e.g. on app switch)
    func invalidate() {
        cacheTimestamp = 0
    }
}

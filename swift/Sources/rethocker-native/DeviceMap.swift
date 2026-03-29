import Foundation
import IOKit
import IOKit.hid

// Tracks which physical HID keyboard/keypad most recently sent a keystroke,
// so the CGEventTap callback can attach a real device name to each event.
//
// Strategy: register an IOHIDManager input-value callback per device,
// passing the device ref as context. This fires just before the corresponding
// CGEvent reaches our tap — so lastDevice is always up to date.

final class DeviceMap {
    static let shared = DeviceMap()
    private init() {}

    // The device that most recently sent a HID key event.
    // Written on the main RunLoop (same thread as CGEventTap) — no locking needed.
    private(set) var lastDevice: DeviceInfo? = nil

    // All known devices, keyed by opaque pointer for fast lookup in C callbacks
    private var devicesByPtr: [UnsafeMutableRawPointer: DeviceInfo] = [:]

    func start() {
        guard let manager = IOHIDManagerCreate(
            kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone)
        ) as IOHIDManager? else { return }

        let matching: [[String: Any]] = [
            [kIOHIDDeviceUsagePageKey: kHIDPage_GenericDesktop,
             kIOHIDDeviceUsageKey: kHIDUsage_GD_Keyboard],
            [kIOHIDDeviceUsagePageKey: kHIDPage_GenericDesktop,
             kIOHIDDeviceUsageKey: kHIDUsage_GD_Keypad],
        ]
        IOHIDManagerSetDeviceMatchingMultiple(manager, matching as CFArray)
        IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))

        // Register existing devices and per-device input callbacks
        if let devices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice> {
            for device in devices { register(device) }
        }

        IOHIDManagerRegisterDeviceMatchingCallback(manager, { _, _, _, device in
            DeviceMap.shared.register(device)
        }, nil)
        IOHIDManagerRegisterDeviceRemovalCallback(manager, { _, _, _, device in
            DeviceMap.shared.unregister(device)
        }, nil)

        IOHIDManagerScheduleWithRunLoop(
            manager, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue
        )
    }

    var allDevices: [DeviceInfo] {
        return Array(devicesByPtr.values)
    }

    private func register(_ device: IOHIDDevice) {
        guard let info = makeDeviceInfo(device) else { return }

        // Use the device's opaque CFTypeRef pointer as key
        let ptr = Unmanaged.passUnretained(device).toOpaque()
        devicesByPtr[ptr] = info

        // Register a per-device input callback, passing the ptr as context so
        // we can look up the DeviceInfo without touching Swift objects from a C callback
        IOHIDDeviceRegisterInputValueCallback(device, { context, _, _, value in
            guard let ctx = context else { return }
            let element = IOHIDValueGetElement(value)
            let usagePage = IOHIDElementGetUsagePage(element)
            let usage = IOHIDElementGetUsage(element)
            // Only care about key press/release events (usage page 7)
            guard usagePage == UInt32(kHIDPage_KeyboardOrKeypad),
                  usage >= UInt32(kHIDUsage_KeyboardA),
                  usage <= UInt32(kHIDUsage_KeyboardRightGUI)
            else { return }
            DeviceMap.shared.lastDevice = DeviceMap.shared.devicesByPtr[ctx]
        }, ptr)

        IOHIDDeviceScheduleWithRunLoop(
            device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue
        )
    }

    private func unregister(_ device: IOHIDDevice) {
        let ptr = Unmanaged.passUnretained(device).toOpaque()
        if let info = devicesByPtr[ptr], lastDevice == info {
            lastDevice = nil
        }
        devicesByPtr.removeValue(forKey: ptr)
    }

    private func makeDeviceInfo(_ device: IOHIDDevice) -> DeviceInfo? {
        guard let name = IOHIDDeviceGetProperty(device, kIOHIDProductKey as CFString) as? String
        else { return nil }
        let vid = IOHIDDeviceGetProperty(device, kIOHIDVendorIDKey as CFString) as? Int ?? 0
        let pid = IOHIDDeviceGetProperty(device, kIOHIDProductIDKey as CFString) as? Int ?? 0
        let manufacturer = IOHIDDeviceGetProperty(device, kIOHIDManufacturerKey as CFString) as? String
        let transport = IOHIDDeviceGetProperty(device, kIOHIDTransportKey as CFString) as? String
        let locationID = IOHIDDeviceGetProperty(device, kIOHIDLocationIDKey as CFString) as? Int
        return DeviceInfo(
            vendorID: Int64(vid),
            productID: Int64(pid),
            name: name,
            manufacturer: manufacturer,
            transport: transport,
            locationID: locationID
        )
    }
}

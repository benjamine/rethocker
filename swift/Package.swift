// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "rethocker-native",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "rethocker-native",
            path: "Sources/rethocker-native",
            linkerSettings: [
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("Carbon"),
                .linkedFramework("AppKit"),
                .linkedFramework("IOKit"),
            ]
        )
    ]
)

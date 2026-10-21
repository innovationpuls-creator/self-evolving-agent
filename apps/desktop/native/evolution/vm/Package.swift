// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "D4Execution",
    platforms: [.macOS("26.0")],
    products: [.executable(name: "d4-vm-owner", targets: ["D4VMOwner"])],
    dependencies: [
        .package(url: "https://github.com/apple/containerization.git", exact: "0.52.1")
    ],
    targets: [
        .executableTarget(
            name: "D4VMOwner",
            dependencies: [
                .product(name: "Containerization", package: "containerization"),
                .product(name: "ContainerizationOS", package: "containerization"),
            ],
            resources: [.copy("guest-launcher.py")]
        )
    ]
)

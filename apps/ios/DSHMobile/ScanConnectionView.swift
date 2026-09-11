import SwiftUI
import VisionKit
import AVFoundation

/// A scanner only supplies input. HostAddress validation and explicit confirmation precede any load.
struct ScanConnectionView: View {
    @ObservedObject var browser: BrowserState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var permitted = false
    @State private var checking = true
    @State private var candidate: HostAddress?
    @State private var failure: String?
    @State private var scannerID = UUID()

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let candidate {
                    Image(systemName: "laptopcomputer").font(.system(size: 38)).foregroundStyle(.tint)
                    Text("连接这台电脑？").font(.title2)
                    // Show the authority, never the QR's token, and keep the candidate only in memory.
                    Text(candidate.origin.absoluteString).font(.callout).textSelection(.enabled)
                    Text("核对主机地址后，确认登录。").font(.footnote).foregroundStyle(.secondary)
                    Button("确认连接") {
                        browser.connect(candidate.loginURL.absoluteString)
                        if browser.failure == nil { self.candidate = nil; dismiss() }
                    }.buttonStyle(.borderedProminent).controlSize(.large)
                    Button("重新扫描") { self.candidate = nil; scannerID = UUID() }
                } else if checking {
                    ProgressView()
                } else if let failure {
                    ContentUnavailableView("暂时无法扫码", systemImage: "qrcode.viewfinder", description: Text(failure))
                    Button("重试") { self.failure = nil; scannerID = UUID() }
                } else if permitted && DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    Text("扫描电脑上显示的 DSH 登录二维码。").font(.callout).foregroundStyle(.secondary)
                    if scenePhase == .active {
                        QRScanner(onCode: receive, onUnavailable: { failure = "相机暂时不可用，请重试或手动输入登录链接。" })
                            .id(scannerID).frame(maxHeight: 400).clipShape(RoundedRectangle(cornerRadius: 24))
                    }
                } else {
                    ContentUnavailableView("无法使用相机", systemImage: "camera", description: Text("可在系统设置中允许相机访问，或手动输入电脑提供的登录链接。"))
                    Button("打开系统设置") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                }
                Button("手动输入地址") { browser.sheet = .settings }
                Spacer(minLength: 0)
            }.padding(24)
                .navigationTitle("扫码连接").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
                .task {
                    guard DataScannerViewController.isSupported else { checking = false; return }
                    permitted = await AVCaptureDevice.requestAccess(for: .video)
                    guard !Task.isCancelled else { return }
                    checking = false
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { permitted = AVCaptureDevice.authorizationStatus(for: .video) == .authorized }
                }
        }
    }

    private func receive(_ code: String) {
        do { candidate = try HostAddress(code) }
        catch { failure = "二维码不是有效的 HTTPS 主机地址或官方登录链接。" }
    }
}

private struct QRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    let onUnavailable: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode, onUnavailable: onUnavailable) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighFrameRateTrackingEnabled: false, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return scanner
    }
    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        guard !scanner.isScanning && !context.coordinator.delivered else { return }
        do { try scanner.startScanning() } catch { Task { @MainActor in onUnavailable() } }
    }
    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning(); scanner.delegate = nil
    }
    @MainActor final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        let onUnavailable: () -> Void
        var delivered = false
        init(onCode: @escaping (String) -> Void, onUnavailable: @escaping () -> Void) { self.onCode = onCode; self.onUnavailable = onUnavailable }
        func dataScanner(_ scanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) { receive(addedItems, scanner: scanner) }
        func dataScanner(_ scanner: DataScannerViewController, didTapOn item: RecognizedItem) { receive([item], scanner: scanner) }
        private func receive(_ items: [RecognizedItem], scanner: DataScannerViewController) {
            guard !delivered else { return }
            for case let .barcode(barcode) in items {
                if let code = barcode.payloadStringValue { delivered = true; scanner.stopScanning(); onCode(code); return }
            }
        }
        func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) { scanner.stopScanning(); onUnavailable() }
    }
}

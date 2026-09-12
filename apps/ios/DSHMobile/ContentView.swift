import SwiftUI
import WebKit

enum MobileSheet: String, Identifiable {
    case settings, scan
    var id: String { rawValue }
}

@MainActor
final class BrowserState: ObservableObject {
    @Published var host: HostAddress?
    @Published var failure: String?
    @Published var loading = false
    @Published var mobileAvailable = false
    @Published var chromeVisible = false
    @Published var sheet: MobileSheet?
    @Published var layoutDiagnostic = ""
    @Published var displayMode = "auto"
    @Published var pageBackground = UIColor.systemBackground
    weak var webView: WKWebView?

    init() {
        #if DEBUG
        let initial = ProcessInfo.processInfo.environment["DSH_MOBILE_TEST_URL"] ?? UserDefaults.standard.string(forKey: "hostOrigin")
        #else
        let initial = UserDefaults.standard.string(forKey: "hostOrigin")
        #endif
        if let initial { connect(initial) }
    }

    func connect(_ value: String) {
        do {
            #if DEBUG
            let address = try HostAddress(value, allowLoopbackHTTP: true)
            #else
            let address = try HostAddress(value)
            #endif
            host = address
            failure = nil
            mobileAvailable = false
            chromeVisible = false
            layoutDiagnostic = ""
            UserDefaults.standard.set(address.origin.absoluteString, forKey: "hostOrigin")
        } catch { failure = error.localizedDescription }
    }

    func disconnect() {
        webView?.stopLoading()
        host = nil
        mobileAvailable = false
        chromeVisible = false
        layoutDiagnostic = ""
        UserDefaults.standard.removeObject(forKey: "hostOrigin")
    }

    func clearLogin() async {
        // The App owns this website data store. This clears local cookies, not
        // server-side authorization or other browsers' sessions.
        await WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        disconnect()
    }
}

struct ContentView: View {
    @StateObject private var browser = BrowserState()
    @AppStorage("appearance") private var appearance = "system"
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if let host = browser.host {
                ZStack(alignment: .top) {
                    HarnessWebView(host: host, state: browser).id(host.loginURL)
                    if browser.loading { ProgressView().padding(10).background(.regularMaterial, in: Capsule()).padding(.top, 6) }
                    if let failure = browser.failure {
                        VStack(spacing: 12) {
                            Text(failure).font(.callout)
                            Button("重新载入") { browser.failure = nil; browser.webView?.reload() }
                            Button("连接设置") { browser.sheet = .settings }
                        }.padding(24).frame(maxWidth: .infinity).background(.regularMaterial)
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if !browser.chromeVisible {
                        HStack {
                            Text("DSH Mobile")
                            Spacer()
                            Button("连接设置", systemImage: "slider.horizontal.3") { browser.sheet = .settings }
                        }.font(.caption).padding(.horizontal, 16).padding(.vertical, 8).background(.bar)
                    }
                }
            } else { ConnectionView(browser: browser) }
        }
        .background(Color(uiColor: browser.pageBackground).ignoresSafeArea())
        .tint(Color(red: 0.30, green: 0.42, blue: 1))
        .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
        .sheet(item: $browser.sheet) { page in
            if page == .scan { ScanConnectionView(browser: browser) }
            else { ConnectionView(browser: browser).presentationDetents([.large]) }
        }
        .onChange(of: phase) { _, newValue in
            if newValue == .active {
                // Reconnect belongs to the official Client; this event
                // never replays a send/edit/withdraw command.
                browser.webView?.evaluateJavaScript("window.dispatchEvent(new Event('dsh-mobile-foreground'))", completionHandler: nil)
            }
        }
    }
}

struct ConnectionView: View {
    @ObservedObject var browser: BrowserState
    @State private var address = ""
    @State private var clearConfirmation = false
    @AppStorage("appearance") private var appearance = "system"
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let host = browser.host {
                    Section("当前主机") {
                        Label(host.origin.host ?? "Harness", systemImage: "laptopcomputer")
                        Text(host.origin.absoluteString).font(.footnote).foregroundStyle(.secondary)
                        Text(browser.mobileAvailable ? "移动插件已连接" : "尚未检测到移动插件").font(.footnote)
                        Button("重新载入") { browser.failure = nil; browser.webView?.reload(); dismiss() }
                    }
                }
                Section {
                    Button("扫码连接电脑", systemImage: "qrcode.viewfinder") { browser.sheet = .scan }
                    SecureField("主机地址或官方登录链接", text: $address)
                        .textContentType(.none).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Button("连接主机") {
                        browser.connect(address)
                        if browser.failure == nil { address = ""; dismiss() }
                    }.disabled(address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } header: { Text("连接") } footer: { Text("首次连接使用电脑提供的官方登录链接。仅保存主机地址，登录 token 不保存到设置中。") }
                if let failure = browser.failure { Section { Text(failure).foregroundStyle(.red) } }
                Section("此设备") {
                    if browser.mobileAvailable {
                        Picker("布局", selection: Binding(get: { browser.displayMode }, set: { mode in
                            guard ["auto", "mobile", "desktop"].contains(mode) else { return }
                            browser.displayMode = mode
                            browser.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('dsh-mobile-display', {detail:{mode:'\(mode)'}}))", completionHandler: nil)
                        })) {
                            Text("跟随屏幕尺寸").tag("auto")
                            Text("移动布局").tag("mobile")
                            Text("桌面布局").tag("desktop")
                        }
                    }
                    Picker("外观", selection: $appearance) {
                        Text("跟随系统").tag("system")
                        Text("浅色").tag("light")
                        Text("深色").tag("dark")
                    }
                }
                if browser.host != nil {
                    Section {
                        Button("断开连接") { browser.disconnect(); dismiss() }
                        Button("清除本 App 的登录数据", role: .destructive) { clearConfirmation = true }
                    }
                }
                #if DEBUG
                if !browser.layoutDiagnostic.isEmpty {
                    Section("开发诊断") { Text(browser.layoutDiagnostic).font(.caption).foregroundStyle(.secondary) }
                }
                #endif
                Section { Text("电脑需保持唤醒和联网。跨网络访问使用已配置的 HTTPS 入口。").font(.footnote).foregroundStyle(.secondary) }
            }
            .navigationTitle(browser.host == nil ? "连接电脑" : "设置").navigationBarTitleDisplayMode(.inline)
            .toolbar { if browser.host != nil { Button("完成") { dismiss() } } }
            .confirmationDialog("清除本 App 的登录和缓存？", isPresented: $clearConfirmation, titleVisibility: .visible) {
                Button("清除", role: .destructive) { Task { await browser.clearLogin(); dismiss() } }
            } message: { Text("不会删除电脑上的会话，也不会撤销其他设备的登录。") }
        }
    }
}

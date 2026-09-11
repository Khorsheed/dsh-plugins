import SwiftUI
import WebKit

@MainActor
final class BrowserState: ObservableObject {
    @Published var host: HostAddress?
    @Published var failure: String?
    @Published var loading = false
    @Published var mobileAvailable = false
    @Published var layoutDiagnostic = ""
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
            layoutDiagnostic = ""
            UserDefaults.standard.set(address.origin.absoluteString, forKey: "hostOrigin")
        } catch { failure = error.localizedDescription }
    }

    func disconnect() {
        webView?.stopLoading()
        host = nil
        mobileAvailable = false
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
    @State private var showConnection = false
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
                            Button("连接设置") { showConnection = true }
                        }.padding(24).frame(maxWidth: .infinity).background(.regularMaterial)
                    }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    HStack {
                        Label(host.origin.host ?? "DSH", systemImage: "network").lineLimit(1)
                        Spacer()
                        Button("连接", systemImage: "slider.horizontal.3") { showConnection = true }
                    }.font(.caption).padding(.horizontal, 16).padding(.vertical, 8).background(.bar)
                }
            } else { ConnectionView(browser: browser) }
        }
        .tint(Color(red: 0.30, green: 0.42, blue: 1))
        .sheet(isPresented: $showConnection) { ConnectionView(browser: browser).presentationDetents([.large]) }
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
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Spacer().frame(height: 36)
                    Image(systemName: "bubble.left.and.text.bubble.right").font(.system(size: 48, weight: .light)).foregroundStyle(.tint)
                    Text("工作空间，\n随身同行。 ").font(.system(size: 36, weight: .regular)).tracking(-1)
                    Text("连接电脑上的 Harness，继续你的会话。").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("主机地址或官方登录链接").font(.subheadline)
                        SecureField("https://your-host.example", text: $address)
                            .textContentType(.none).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .keyboardType(.URL).padding(16).background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 18))
                        Text("首次连接使用电脑提供的官方登录链接。只保存主机地址，登录 token 不会保存到设置中。").font(.caption).foregroundStyle(.secondary)
                    }
                    if let failure = browser.failure { Text(failure).font(.callout).foregroundStyle(.red) }
                    Button {
                        browser.connect(address)
                        if browser.failure == nil { address = ""; dismiss() }
                    } label: {
                        Text("连接主机").frame(maxWidth: .infinity).padding(.vertical, 10)
                    }.buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if let host = browser.host {
                        Text(host.origin.absoluteString).font(.footnote).foregroundStyle(.secondary)
                        Text(browser.mobileAvailable ? "移动插件已连接" : "尚未检测到移动插件，可继续使用官方页面").font(.footnote)
                        #if DEBUG
                        if !browser.layoutDiagnostic.isEmpty { Text(browser.layoutDiagnostic).font(.caption).foregroundStyle(.secondary) }
                        #endif
                        Button("断开连接") { browser.disconnect(); dismiss() }
                        Button("清除本 App 的登录数据", role: .destructive) { clearConfirmation = true }
                    }
                    Text("跨网络使用需要可达的 HTTPS 入口。电脑需保持唤醒和联网。").font(.footnote).foregroundStyle(.secondary)
                }.padding(28)
            }.background(LinearGradient(colors: [Color(red: 0.61, green: 0.76, blue: 0.91).opacity(0.35), Color(.systemBackground)], startPoint: .top, endPoint: .center))
            .toolbar { if browser.host != nil { Button("完成") { dismiss() } } }
            .confirmationDialog("清除本 App 的登录和缓存？", isPresented: $clearConfirmation, titleVisibility: .visible) {
                Button("清除", role: .destructive) { Task { await browser.clearLogin(); dismiss() } }
            } message: { Text("不会删除电脑上的会话，也不会撤销其他设备的登录。") }
        }
    }
}

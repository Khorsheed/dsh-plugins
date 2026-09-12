import SwiftUI
import WebKit

struct HarnessWebView: UIViewRepresentable {
    let host: HostAddress
    @ObservedObject var state: BrowserState

    func makeCoordinator() -> Coordinator { Coordinator(host: host, state: state) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(WKUserScript(
            source: "window.__DSH_MOBILE_SHELL__ = Object.freeze({ bridgeVersion: 1, capabilities: Object.freeze(['settings', 'scan']) });",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(context.coordinator, name: "dshMobile")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.isOpaque = false
        view.backgroundColor = state.pageBackground
        view.allowsBackForwardNavigationGestures = true
        #if DEBUG
        view.isInspectable = true
        #endif
        state.webView = view
        view.load(URLRequest(url: host.loginURL))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "dshMobile")
        view.configuration.userContentController.removeAllUserScripts()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let host: HostAddress
        let state: BrowserState
        init(host: HostAddress, state: BrowserState) { self.host = host; self.state = state }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame,
                  let url = message.frameInfo.request.url, host.contains(url),
                  let body = message.body as? [String: Any], body["bridgeVersion"] as? Int == 1,
                  let type = body["type"] as? String else { return }
            if type == "ready" {
                state.mobileAvailable = true
                if let layout = body["layout"] as? [String: Any], let mode = layout["mode"] as? String,
                   ["auto", "mobile", "desktop"].contains(mode) { state.displayMode = mode }
                #if DEBUG
                if let layout = body["layout"] as? [String: Any], let anchors = body["anchors"] as? [String: Any] {
                    let active = layout["active"] as? Bool ?? false
                    let supported = layout["supported"] as? Bool ?? false
                    let mode = layout["mode"] as? String ?? "unknown"
                    state.layoutDiagnostic = "布局 \(active ? "mobile" : "desktop") · mode \(mode) · frame \(supported) · navigation \(body["navigation"] as? Bool ?? false) · anchors \(anchors)"
                    print("DSH mobile diagnostic: \(state.layoutDiagnostic)")
                }
                #endif
            }
            if type == "chrome" {
                state.chromeVisible = body["visible"] as? Bool ?? false
                state.webView?.allowsBackForwardNavigationGestures = !state.chromeVisible
                #if DEBUG
                print("DSH chrome visible: \(state.chromeVisible)")
                #endif
            }
            if type == "appearance", let rgb = body["background"] as? [Double], rgb.count == 3,
               rgb.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 255 }) {
                let color = UIColor(red: rgb[0] / 255, green: rgb[1] / 255, blue: rgb[2] / 255, alpha: 1)
                state.pageBackground = color
                state.webView?.backgroundColor = color
                state.webView?.scrollView.backgroundColor = color
                state.webView?.underPageBackgroundColor = color
            }
            if type == "settings" { state.sheet = .settings }
            if type == "scan" { state.sheet = .scan }
            if type == "unloaded" { state.mobileAvailable = false; state.chromeVisible = false }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
            if host.contains(url) { decisionHandler(.allow); return }
            // An explicit external link opens outside the privileged host view.
            if action.navigationType == .linkActivated, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            state.loading = true
            state.mobileAvailable = false
            state.chromeVisible = false
            state.layoutDiagnostic = ""
        }
        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode == 401 {
                state.loading = false
                state.chromeVisible = false
                state.mobileAvailable = false
                state.failure = String(localized: "登录已失效，请在连接设置中输入新的官方登录链接，或重新扫码。")
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            state.loading = false
            #if DEBUG
            Task { @MainActor [weak webView] in
                try? await Task.sleep(for: .seconds(2))
                let probe = """
                (() => {
                  const q = s => document.querySelector(s);
                  const rect = e => e ? {top:Math.round(e.getBoundingClientRect().top),bottom:Math.round(e.getBoundingClientRect().bottom),height:Math.round(e.getBoundingClientRect().height)} : null;
                  return JSON.stringify({errors:Array.from(document.querySelectorAll('[data-slot-error]')).map(e=>e.getAttribute('data-slot-error')),
                    toolbar:!!q('[data-mobile-toolbar]'),library:!!q('[data-mobile-library]'),welcome:!!q('[data-mobile-welcome]'),
                    phase:q('[data-slot="main.conversation"] [data-phase]')?.dataset.phase,
                    frame:rect(q('[data-mobile-frame]')),composer:rect(q('[data-composer-card]')),context:rect(q('[data-mobile-context-row]')),
                    stats:rect(q('[data-composer-stats]')),viewport:Math.round(window.visualViewport?.height || innerHeight)});
                })()
                """
                webView?.evaluateJavaScript(probe) { value, _ in
                    if let value { print("DSH rendered surface: \(value)") }
                }
            }
            #endif
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
        private func fail(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            state.loading = false
            state.chromeVisible = false
            // Network errors may embed an authenticated URL; display no raw error text.
            state.failure = String(localized: "连接暂时不可用。请检查电脑和网络后重试。")
        }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            state.chromeVisible = false
            state.mobileAvailable = false
            state.failure = String(localized: "页面已暂停，请重新载入以恢复会话。")
        }
    }
}

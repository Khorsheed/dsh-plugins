import Foundation

/// Only the configured host receives the WebView's native message bridge.
struct HostAddress: Equatable {
    let loginURL: URL
    let origin: URL

    enum Failure: LocalizedError {
        case invalid, insecure
        var errorDescription: String? {
            switch self {
            case .invalid: return String(localized: "请输入完整的主机 HTTPS 地址或官方登录链接。")
            case .insecure: return String(localized: "请使用 HTTPS 安全连接。")
            }
        }
    }

    init(_ text: String, allowLoopbackHTTP: Bool = false) throws {
        guard var parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.fragment == nil,
              parts.port.map({ (1...65535).contains($0) }) ?? true,
              parts.queryItems?.allSatisfy({ $0.name == "token" && !($0.value ?? "").isEmpty }) ?? true,
              (parts.queryItems?.count ?? 0) <= 1 else { throw Failure.invalid }
        let local = ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host.lowercased())
        guard parts.scheme?.lowercased() == "https" ||
                (allowLoopbackHTTP && local && parts.scheme?.lowercased() == "http") else { throw Failure.insecure }
        parts.path = "/"
        guard let login = parts.url else { throw Failure.invalid }
        loginURL = login
        parts.query = nil
        guard let clean = parts.url else { throw Failure.invalid }
        origin = clean
    }

    func contains(_ url: URL) -> Bool {
        func port(_ url: URL) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }
        return url.scheme?.lowercased() == origin.scheme?.lowercased()
            && url.host?.lowercased() == origin.host?.lowercased() && port(url) == port(origin)
    }
}

import Foundation

var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message); checks += 1
}
func rejects(_ input: String, debug: Bool = false) {
    do { _ = try HostAddress(input, allowLoopbackHTTP: debug); fatalError("Accepted invalid address") }
    catch { checks += 1 }
}
let address = try HostAddress("https://host.example/?token=test-login")
expect(address.origin.absoluteString == "https://host.example/", "Credential must not enter saved origin")
expect(address.loginURL.query == "token=test-login", "Official login exchange must receive token")
expect(address.contains(URL(string: "https://host.example:443/api")!), "Default HTTPS port")
expect(!address.contains(URL(string: "https://other.example/")!), "Foreign host denied")
expect(!address.contains(URL(string: "http://host.example/")!), "Downgrade denied")
expect(!address.contains(URL(string: "https://host.example:8443/")!), "Foreign port denied")
for input in ["file:///a", "javascript:alert(1)", "http://host.example", "https://user:pass@host.example", "https://host.example/path", "https://host.example/#fragment", "https://host.example/?token=", "https://host.example/?token=a&token=b", "https://host.example/?redirect=x", "https://host.example:0", "https://host.example:65536"] { rejects(input) }
rejects("http://127.0.0.1:3181")
rejects("http://192.168.1.2:3080", debug: true)
let debugAddress = try HostAddress("http://127.0.0.1:3181", allowLoopbackHTTP: true)
expect(debugAddress.origin.port == 3181, "Debug permits loopback only")
print("HostAddress: \(checks) checks passed")

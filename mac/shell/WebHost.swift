// The overlay page: a WKWebView serving the bundled web/ directory on the alder scheme, and the thin bridge
// between the page and the Player (contract in mac/web/bridge.js). Neither logs nor emits the link.
import AppKit
import WebKit

/// alder://app/<path> -> <Resources>/web/<path>; nothing outside that directory is served.
final class AlderSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    private static let mime: [String: String] = [
        "html": "text/html", "js": "text/javascript", "css": "text/css", "json": "application/json",
        "svg": "image/svg+xml", "png": "image/png", "ico": "image/x-icon",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let type = AlderSchemeHandler.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: "utf-8")
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

/// JS to native dispatcher: load, pause, seek, setProp, getProp, quit. Every message gets one reply event.
final class Bridge: NSObject, WKScriptMessageHandler {
    private let player: Player
    weak var webView: WKWebView?

    init(player: Player) {
        self.player = player
        super.init()
        player.emit = { [weak self] event in self?.emit(event) }
    }

    /// Native to JS: window.alderNative.onEvent(event). Props are skipped while the overlay is hidden.
    func emit(_ event: [String: Any]) {
        guard let wv = webView else { return }
        if wv.isHidden, (event["type"] as? String) == "prop" { return }
        guard JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        wv.evaluateJavaScript("window.alderNative&&window.alderNative.onEvent(\(json))", completionHandler: nil)
    }

    private func reply(_ id: Int, ok: Bool, value: Any? = nil, error: String? = nil) {
        var r: [String: Any] = ["type": "reply", "id": id, "ok": ok]
        if let v = value { r["value"] = v }
        if let e = error { r["error"] = e }
        emit(r)
    }

    /// JSON value -> the string the mpv property API takes.
    private func mpvString(_ v: Any) -> String? {
        if let n = v as? NSNumber {
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "yes" : "no" }
            return n.stringValue
        }
        return v as? String
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let idNum = body["id"] as? NSNumber, let cmd = body["cmd"] as? String else { return }
        let id = idNum.intValue
        let args = body["args"] as? [String: Any] ?? [:]
        switch cmd {
        case "load":
            guard let url = args["url"] as? String, !url.isEmpty else {
                reply(id, ok: false, error: "load needs a link")
                return
            }
            // Async: the reply event (userdata = id) says whether mpv accepted it.
            let rc = player.command(["loadfile", url, "replace"], replyID: UInt64(id))
            if rc < 0 { reply(id, ok: false, error: Player.errorText(rc)) }
        case "seek":
            guard let s = (args["seconds"] as? NSNumber)?.doubleValue else {
                reply(id, ok: false, error: "seek needs seconds")
                return
            }
            let rc = player.command(["seek", String(s), "absolute"], replyID: UInt64(id))
            if rc < 0 { reply(id, ok: false, error: Player.errorText(rc)) }
        case "pause":
            let paused = (args["paused"] as? NSNumber)?.boolValue ?? true
            let rc = player.setString("pause", paused ? "yes" : "no")
            reply(id, ok: rc >= 0, error: rc < 0 ? Player.errorText(rc) : nil)
        case "setProp":
            guard let name = args["name"] as? String, let raw = args["value"], let value = mpvString(raw) else {
                reply(id, ok: false, error: "setProp needs name and value")
                return
            }
            let rc = player.setString(name, value)
            reply(id, ok: rc >= 0, error: rc < 0 ? Player.errorText(rc) : nil)
        case "getProp":
            guard let name = args["name"] as? String else {
                reply(id, ok: false, error: "getProp needs name")
                return
            }
            if let v = player.getString(name) { reply(id, ok: true, value: v) }
            else { reply(id, ok: false, error: "property unavailable") }
        case "quit":
            reply(id, ok: true)
            NSApp.terminate(nil)
        default:
            reply(id, ok: false, error: "unknown command")
        }
    }
}

/// The web view that goes over the video view: transparent, with the bridge attached.
func makeWebView(root: URL, bridge: Bridge) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(AlderSchemeHandler(root: root), forURLScheme: "alder")
    config.userContentController.add(bridge, name: "alder")
    let wv = WKWebView(frame: .zero, configuration: config)
    wv.setValue(false, forKey: "drawsBackground") // private key, accepted for this app (no App Store)
    wv.autoresizingMask = [.width, .height]
    bridge.webView = wv
    return wv
}

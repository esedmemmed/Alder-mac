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
        "woff": "font/woff", "woff2": "font/woff2", "webp": "image/webp",
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

/// JS to native dispatcher (wire: docs/ops/INDEX.md, Bridge v2 wire): load, pause, seek, observe, setProp, getProp,
/// subAdd, fullscreen, saveFile, quit, log, report. Every message gets one reply event.
final class Bridge: NSObject, WKScriptMessageHandler {
    private let player: Player
    private let reportPath: String?
    weak var webView: WKWebView?
    /// What the page's quit command does (the app sets it); without one the app terminates at once.
    var onQuit: (() -> Void)?
    private var subCount = 0

    init(player: Player, reportPath: String? = nil) {
        self.player = player
        self.reportPath = reportPath
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

    /// Appends one line of text to the --report file, if given. Written at once so a quit right after loses nothing.
    func appendReport(_ text: String) {
        guard let path = reportPath, let data = (text + "\n").data(using: .utf8) else { return }
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
        guard let handle = FileHandle(forWritingAtPath: path) else { return }
        handle.seekToEndOfFile()
        handle.write(data)
        handle.closeFile()
    }

    /// A file name that stays inside one folder: no separators, no control characters, no leading dots.
    private func sanitizedName(_ name: String) -> String {
        var out = ""
        for u in name.unicodeScalars {
            if u == "/" || u == "\\" || u == ":" || u.value < 32 { out.append("_") } else { out.unicodeScalars.append(u) }
        }
        while out.hasPrefix(".") { out.removeFirst() }
        if out.count > 120 { out = String(out.prefix(120)) }
        return out.isEmpty ? "alder.txt" : out
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
            var headers: [String: String] = [:]
            if let h = args["headers"] as? [String: Any] {
                for (k, v) in h { if let text = mpvString(v) { headers[k] = text } }
            }
            var start: Double?
            if let t = (args["start"] as? NSNumber)?.doubleValue, t.isFinite, t > 0 { start = t }
            // Async: the reply event (userdata = id) says whether mpv accepted it.
            let rc = player.load(url: url, headers: headers, start: start, replyID: UInt64(id))
            if rc < 0 { reply(id, ok: false, error: Player.errorText(rc)) }
        case "observe":
            guard let names = args["names"] as? [String], !names.isEmpty,
                  names.allSatisfy({ Player.observable.contains($0) }) else {
                reply(id, ok: false, error: "observe needs names the shell can observe")
                return
            }
            for n in names { player.observe(n, forPage: true) }
            reply(id, ok: true)
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
            guard Player.settable.contains(name) else {
                reply(id, ok: false, error: "property not settable")
                return
            }
            let rc = player.setString(name, value)
            reply(id, ok: rc >= 0, error: rc < 0 ? Player.errorText(rc) : nil)
        case "getProp":
            guard let name = args["name"] as? String else {
                reply(id, ok: false, error: "getProp needs name")
                return
            }
            guard Player.settable.contains(name) || Player.observable.contains(name) || Player.health.contains(name) else {
                reply(id, ok: false, error: "property not readable")
                return
            }
            if let v = player.getString(name) { reply(id, ok: true, value: v) }
            else { reply(id, ok: false, error: "property unavailable") }
        case "log":
            guard let line = args["line"] as? String else {
                reply(id, ok: false, error: "log needs line")
                return
            }
            appendReport("log: " + stripURLs(line))
            reply(id, ok: true)
        case "report":
            guard let text = args["text"] as? String else {
                reply(id, ok: false, error: "report needs text")
                return
            }
            appendReport(stripURLs(text))
            reply(id, ok: true)
        case "subAdd":
            guard let text = args["text"] as? String, !text.isEmpty else {
                reply(id, ok: false, error: "subAdd needs text")
                return
            }
            // The page fetched the subtitle; the shell only writes it where mpv can read it, and never fetches.
            subCount += 1
            let ext = text.hasPrefix("WEBVTT") ? "vtt" : "srt"
            let caches = NSSearchPathForDirectoriesInDomains(.cachesDirectory, .userDomainMask, true).first ?? NSTemporaryDirectory()
            let dir = caches + "/" + (Bundle.main.bundleIdentifier ?? "Alder") + "/subs"
            let path = dir + "/\(subCount).\(ext)"
            do {
                try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: nil)
                try text.write(toFile: path, atomically: true, encoding: .utf8)
            } catch {
                reply(id, ok: false, error: "subAdd could not write the file")
                return
            }
            let lang = args["lang"] as? String ?? ""
            let title = args["title"] as? String ?? ""
            var cmdArgs = ["sub-add", path, "select"]
            if !title.isEmpty || !lang.isEmpty { cmdArgs.append(title) }
            if !lang.isEmpty { cmdArgs.append(lang) }
            let rc = player.command(cmdArgs, replyID: UInt64(id))
            if rc < 0 { reply(id, ok: false, error: Player.errorText(rc)) }
        case "fullscreen":
            let on = (args["on"] as? NSNumber)?.boolValue ?? true
            if let w = webView?.window, w.styleMask.contains(.fullScreen) != on { w.toggleFullScreen(nil) }
            reply(id, ok: true)
        case "saveFile":
            guard let name = args["name"] as? String, let text = args["text"] as? String else {
                reply(id, ok: false, error: "saveFile needs name and text")
                return
            }
            let dir = NSHomeDirectory() + "/Downloads"
            let path = dir + "/" + sanitizedName(name)
            do {
                try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: nil)
                try text.write(toFile: path, atomically: true, encoding: .utf8)
            } catch {
                reply(id, ok: false, error: "saveFile could not write the file")
                return
            }
            reply(id, ok: true, value: path)
        case "quit":
            reply(id, ok: true)
            if let q = onQuit { q() } else { NSApp.terminate(nil) }
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
    wv.navigationDelegate = bridge // Bridge lives in AppDelegate, which outlives the weak reference
    bridge.webView = wv
    return wv
}

/// Navigation result of the page load goes to the --report file (no URL), so a page that never ran still leaves a trace.
extension Bridge: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        appendReport("nav: finished")
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        appendReport("nav: failed (\(e.domain) \(e.code))")
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        appendReport("nav: failed (\(e.domain) \(e.code))")
    }
}

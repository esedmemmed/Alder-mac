// One `play:` line per played file, written to the --report file at end-file (Bridge.appendReport). Fed by the
// Player: START_FILE, property changes, PLAYBACK_RESTART, warn-level log messages, END_FILE. Never holds or writes
// the link: the label is --label, else an 8-hex hash of it. Also home of the one URL strip function.
import Foundation

private let schemePattern = try? NSRegularExpression(pattern: "[A-Za-z][A-Za-z0-9+.\\-]*://[^\\s\"'<>]*", options: [])
private let queryPattern = try? NSRegularExpression(pattern: "\\?[^\\s\"'<>]+", options: [])

/// The one strip rule (same as stripUrls in mac/web/mock-bridge.js): scheme://... -> [link], ?query -> ?[query].
/// Applied to endFile.message, log lines and report lines.
func stripURLs(_ text: String) -> String {
    var out = text
    if let re = schemePattern {
        out = re.stringByReplacingMatches(in: out, options: [], range: NSRange(location: 0, length: (out as NSString).length),
                                          withTemplate: "[link]")
    }
    if let re = queryPattern {
        out = re.stringByReplacingMatches(in: out, options: [], range: NSRange(location: 0, length: (out as NSString).length),
                                          withTemplate: "?[query]")
    }
    return out
}

final class Recorder {
    private let fixedLabel: String?
    private let write: (String) -> Void
    /// Set by the app: whether the window is full screen right now.
    var isFullscreen: (() -> Bool)?

    private var nextLabel = "unknown"
    private var active = false
    private var label = "unknown"
    private var t0: CFAbsoluteTime?
    private var firstPos: Double?
    private var lastPos: Double?
    private var intervalWall: CFAbsoluteTime?
    private var intervalPos = 0.0
    private var dirty = false
    private var rt: [String] = []
    private var underruns = 0
    private var stallCount = 0
    private var stallSeconds = 0.0
    private var stallSince: CFAbsoluteTime?
    private var latest: [String: Any] = [:]
    private var restarts = 0

    init(label: String?, write: @escaping (String) -> Void) {
        fixedLabel = label
        self.write = write
    }

    /// The next file's label. Called when a load is issued; the file in play (if any) keeps its own label.
    func begin(_ url: String) {
        var h: UInt64 = 0xcbf29ce484222325 // FNV-1a 64
        for b in url.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }
        nextLabel = String(format: "%08x", UInt32(truncatingIfNeeded: h >> 16))
    }

    func startFile() {
        active = true
        label = fixedLabel ?? nextLabel
        t0 = nil
        firstPos = nil
        lastPos = nil
        intervalWall = nil
        dirty = false
        rt = []
        underruns = 0
        stallCount = 0
        stallSeconds = 0
        stallSince = nil
        restarts = 0
        latest = [:]
    }

    func restart() {
        guard active else { return }
        restarts += 1
        if t0 == nil { t0 = CFAbsoluteTimeGetCurrent() } else { dirty = true } // a later restart is a seek
    }

    func log(_ text: String) {
        if active && text.lowercased().contains("underrun") { underruns += 1 }
    }

    func prop(_ name: String, _ value: Any) {
        guard active, !(value is NSNull) else { return } // a null is the file going away: keep the last real value
        latest[name] = value
        let now = CFAbsoluteTimeGetCurrent()
        if name == "time-pos", let pos = value as? Double {
            if firstPos == nil { firstPos = pos }
            lastPos = pos
            guard t0 != nil else { return }
            guard let since = intervalWall else {
                intervalWall = now
                intervalPos = pos
                return
            }
            if now - since >= 30 {
                rt.append(dirty ? "-" : String(format: "%.3f", (pos - intervalPos) / (now - since)))
                intervalWall = now
                intervalPos = pos
                dirty = false
            }
        } else if name == "pause", let paused = value as? Bool, paused {
            dirty = true
        } else if name == "paused-for-cache", let stalled = value as? Bool {
            if stalled {
                dirty = true
                if stallSince == nil { stallSince = now; stallCount += 1 }
            } else if let since = stallSince {
                stallSeconds += now - since
                stallSince = nil
            }
        }
    }

    func end(_ reason: String) {
        guard active else { return }
        active = false
        let now = CFAbsoluteTimeGetCurrent()
        if let since = stallSince { stallSeconds += now - since; stallSince = nil }
        let wall = t0.map { now - $0 } ?? 0
        var advanced = 0.0
        if let a = firstPos, let b = lastPos { advanced = b - a }
        let tracks = latest["track-list"] as? [[String: Any]] ?? []
        let video = tracks.first { ($0["type"] as? String) == "video" && ($0["selected"] as? Bool) == true }
        let audio = tracks.first { ($0["type"] as? String) == "audio" && ($0["selected"] as? Bool) == true }
        let vp = latest["video-params"] as? [String: Any] ?? [:]
        let ap = latest["audio-params"] as? [String: Any] ?? [:]
        let pix = vp["pixelformat"] as? String ?? "unknown"
        let w = vp["w"] as? Int ?? 0
        let h = vp["h"] as? Int ?? 0
        let fps = video?["demux-fps"] as? Double ?? 0
        let channels = ap["channel-count"] as? Int ?? audio?["demux-channel-count"] as? Int ?? 0
        func count(_ name: String) -> Int { latest[name] as? Int ?? 0 }
        let fs = (isFullscreen?() ?? false) ? "yes" : "no"
        var line = "play: label=\(label)"
        line += String(format: " wall=%.1f adv=%.1f", wall, advanced)
        line += " rt=" + (rt.isEmpty ? "-" : rt.joined(separator: ","))
        line += " fdrop=\(count("frame-drop-count")) ddrop=\(count("decoder-frame-drop-count"))"
        line += " vodelay=\(count("vo-delayed-frame-count")) mistimed=\(count("mistimed-frame-count"))"
        line += " hwdec=\(latest["hwdec-current"] as? String ?? "unavailable")"
        line += " video=\(video?["codec"] as? String ?? "unknown") \(w)x\(h) " + String(format: "%.2ffps", fps)
        line += " \(Recorder.bitDepth(pix))bit pix=\(pix)"
        line += " audio=\(audio?["codec"] as? String ?? "unknown") \(channels)ch"
        line += " underruns=\(underruns)"
        line += String(format: " cache=%d/%.1fs", stallCount, stallSeconds)
        line += " fs=\(fs) end=\(reason)"
        write(line)
    }

    /// Bits per sample from an mpv pixel format name (yuv420p10le -> 10); 8 when it carries no depth.
    static func bitDepth(_ pixfmt: String) -> Int {
        for depth in [16, 14, 12, 10, 9] {
            if pixfmt.contains("p\(depth)") || pixfmt.contains("\(depth)le") || pixfmt.contains("\(depth)be") { return depth }
        }
        return 8
    }
}

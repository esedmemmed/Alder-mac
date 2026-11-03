// Command line of the shell. Shape is the contract in the phase plan:
// AlderProof [--url <link>] [--overlay shown|hidden] [--end <seconds>] [--measure <script> --label <label>]
//            [--hwdec <value>] [--selftest <file>] [--page <file[?query]>] [--report <path>] [--quit-after <seconds>]
//            [--mpv-opt <key=value>]...   (repeatable; appended after the shell's own mpv options, so it wins)
import Foundation

struct Options {
    var url: String?
    var overlayShown = true
    var end: Double?
    var measureScript: String?
    var label: String?
    var hwdec = "videotoolbox"
    var selftest: String?
    var page = "index.html"
    var report: String?
    var quitAfter: Double?
    var mpvOpts: [(String, String)] = []

    static let usage = "usage: AlderProof [--url <link>] [--overlay shown|hidden] [--end <seconds>] "
        + "[--measure <script> --label <label>] [--hwdec <value>] [--selftest <file>] "
        + "[--page <file[?query]>] [--report <path>] [--quit-after <seconds>] [--mpv-opt <key=value>]..."

    /// Parses the arguments; prints the usage and exits 64 on anything it does not know.
    static func parse(_ argv: [String]) -> Options {
        var o = Options()
        var i = 1
        func fail(_ why: String) -> Never {
            fputs("AlderProof: \(why)\n\(usage)\n", stderr)
            exit(64)
        }
        func value(_ flag: String) -> String {
            i += 1
            if i >= argv.count { fail("\(flag) needs a value") }
            return argv[i]
        }
        while i < argv.count {
            let a = argv[i]
            switch a {
            case "--url": o.url = value(a)
            case "--overlay":
                let v = value(a)
                if v == "shown" { o.overlayShown = true }
                else if v == "hidden" { o.overlayShown = false }
                else { fail("--overlay must be shown or hidden") }
            case "--end":
                guard let d = Double(value(a)), d > 0 else { fail("--end needs seconds > 0") }
                o.end = d
            case "--measure": o.measureScript = value(a)
            case "--label": o.label = value(a)
            case "--hwdec": o.hwdec = value(a)
            case "--selftest": o.selftest = value(a)
            case "--page": o.page = value(a)
            case "--report": o.report = value(a)
            case "--mpv-opt":
                let v = value(a)
                guard let eq = v.firstIndex(of: "="), eq != v.startIndex else { fail("--mpv-opt needs key=value") }
                o.mpvOpts.append((String(v[..<eq]), String(v[v.index(after: eq)...])))
            case "--quit-after":
                guard let d = Double(value(a)), d > 0 else { fail("--quit-after needs seconds > 0") }
                o.quitAfter = d
            default:
                if a.hasPrefix("-psn_") { break } // Finder launch argument
                fail("unknown argument \(a)")
            }
            i += 1
        }
        if o.measureScript != nil && (o.label ?? "").isEmpty { fail("--measure needs --label") }
        return o
    }
}

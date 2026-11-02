// --selftest <file>: no NSApplication, no window, no WebKit. vo=null, ao=null, plays to the end, prints
// hwdec-current, exits 0 only on END_FILE reason EOF. Anything else is nonzero; a watchdog ends a hang.
//   exit 0 eof · 1 other end reason · 2 setup failed or core shut down · 3 watchdog
import Foundation

func runSelftest(_ file: String, hwdec: String) -> Never {
    // The watchdog runs on a global queue, so it fires even when mpv_wait_event never returns.
    DispatchQueue.global().asyncAfter(deadline: .now() + 180) {
        fputs("selftest: watchdog timeout\n", stderr)
        exit(3)
    }
    guard let h = mpv_create() else {
        fputs("selftest: mpv_create failed\n", stderr)
        exit(2)
    }
    for (k, v) in [("vo", "null"), ("ao", "null"), ("hwdec", hwdec), ("terminal", "yes")] {
        let rc = mpv_set_option_string(h, k, v)
        if rc < 0 { fputs("selftest: option \(k) rejected: \(String(cString: mpv_error_string(rc)))\n", stderr) }
    }
    let irc = mpv_initialize(h)
    if irc < 0 {
        fputs("selftest: mpv_initialize failed: \(String(cString: mpv_error_string(irc)))\n", stderr)
        exit(2)
    }
    var args: [UnsafePointer<CChar>?] = [UnsafePointer(strdup("loadfile")), UnsafePointer(strdup(file)), nil]
    let crc = mpv_command(h, &args)
    for p in args { free(UnsafeMutableRawPointer(mutating: p)) }
    if crc < 0 {
        fputs("selftest: loadfile failed: \(String(cString: mpv_error_string(crc)))\n", stderr)
        exit(2)
    }

    var hwdecSeen = "unavailable"
    var code: Int32 = 2
    loop: while true {
        guard let ev = mpv_wait_event(h, 1.0) else { continue }
        switch ev.pointee.event_id {
        case MPV_EVENT_PLAYBACK_RESTART:
            if let s = mpv_get_property_string(h, "hwdec-current") {
                hwdecSeen = String(cString: s)
                mpv_free(UnsafeMutableRawPointer(s))
            }
        case MPV_EVENT_END_FILE:
            let reason = ev.pointee.data!.assumingMemoryBound(to: mpv_event_end_file.self).pointee.reason
            if reason == MPV_END_FILE_REASON_EOF { code = 0 } else {
                code = 1
                fputs("selftest: end-file reason \(reason.rawValue)\n", stderr)
            }
            break loop
        case MPV_EVENT_SHUTDOWN:
            fputs("selftest: core shut down before end-file\n", stderr)
            break loop
        default:
            break
        }
    }
    print("hwdec-current=\(hwdecSeen)")
    print("selftest: exit \(code)")
    mpv_terminate_destroy(h)
    exit(code)
}

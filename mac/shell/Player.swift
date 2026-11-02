// One libmpv core and its render context. Main thread only, except the wakeup and update callbacks, which
// only hop to another queue. Events go out as plain dictionaries in the bridge's event shapes (mac/web/bridge.js).
// Nothing here logs, stores or emits the link: load arguments are passed straight to mpv.
import Foundation
import OpenGL

final class Player {
    let handle: OpaquePointer
    /// Receives reply/prop/fileLoaded/playbackRestart/endFile dictionaries on the main thread.
    var emit: (([String: Any]) -> Void)?
    /// Called on END_FILE with the reason name (eof, stop, quit, error, redirect).
    var onEndFile: ((String) -> Void)?
    private var core: RenderCore?
    private var down = false
    private var lastProp: [String: CFAbsoluteTime] = [:]

    init?(options: [(String, String)]) {
        guard let h = mpv_create() else { return nil }
        for (k, v) in options {
            let rc = mpv_set_option_string(h, k, v)
            if rc < 0 { fputs("warn: option \(k) rejected: \(String(cString: mpv_error_string(rc)))\n", stderr) }
        }
        let irc = mpv_initialize(h)
        if irc < 0 {
            fputs("error: mpv_initialize: \(String(cString: mpv_error_string(irc)))\n", stderr)
            mpv_terminate_destroy(h)
            return nil
        }
        handle = h
    }

    /// Creates the render context on the core, with the GL context current, and wires the update callback.
    func attachRender(_ core: RenderCore) -> Bool {
        CGLLockContext(core.context)
        defer { CGLUnlockContext(core.context) }
        CGLSetCurrentContext(core.context)
        defer { CGLSetCurrentContext(nil) }

        let getProc: @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>?) -> UnsafeMutableRawPointer? = { _, name in
            guard let name = name else { return nil }
            guard let sym = CFStringCreateWithCString(kCFAllocatorDefault, name, CFStringBuiltInEncodings.ASCII.rawValue),
                  let bundle = CFBundleGetBundleWithIdentifier("com.apple.opengl" as CFString) else { return nil }
            return CFBundleGetFunctionPointerForName(bundle, sym)
        }
        var initParams = mpv_opengl_init_params(get_proc_address: getProc, get_proc_address_ctx: nil)
        var advanced: Int32 = 1 // MPV_RENDER_PARAM_ADVANCED_CONTROL: the obligations are in VideoView.swift
        var rc: OpaquePointer?
        let err: Int32 = "opengl".withCString { (api: UnsafePointer<CChar>) -> Int32 in
            withUnsafeMutablePointer(to: &initParams) { (ip: UnsafeMutablePointer<mpv_opengl_init_params>) -> Int32 in
                withUnsafeMutablePointer(to: &advanced) { (ap: UnsafeMutablePointer<Int32>) -> Int32 in
                    var params = [
                        mpv_render_param(type: MPV_RENDER_PARAM_API_TYPE, data: UnsafeMutableRawPointer(mutating: api)),
                        mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, data: UnsafeMutableRawPointer(ip)),
                        mpv_render_param(type: MPV_RENDER_PARAM_ADVANCED_CONTROL, data: UnsafeMutableRawPointer(ap)),
                        mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
                    ]
                    return mpv_render_context_create(&rc, handle, &params)
                }
            }
        }
        guard err >= 0, let ctx = rc else {
            fputs("error: mpv_render_context_create: \(String(cString: mpv_error_string(err)))\n", stderr)
            return false
        }
        self.core = core
        core.render = ctx
        mpv_render_context_set_update_callback(ctx, { raw in
            guard let raw = raw else { return }
            Unmanaged<RenderCore>.fromOpaque(raw).takeUnretainedValue().requestDraw()
        }, Unmanaged.passUnretained(core).toOpaque())
        return true
    }

    /// Wakeup callback (any thread) hops to main, where the events are drained.
    func startEvents() {
        mpv_set_wakeup_callback(handle, { raw in
            guard let raw = raw else { return }
            let p = Unmanaged<Player>.fromOpaque(raw).takeUnretainedValue()
            DispatchQueue.main.async { p.drain() }
        }, Unmanaged.passUnretained(self).toOpaque())
        mpv_observe_property(handle, 0, "time-pos", MPV_FORMAT_DOUBLE)
        mpv_observe_property(handle, 0, "duration", MPV_FORMAT_DOUBLE)
        mpv_observe_property(handle, 0, "pause", MPV_FORMAT_FLAG)
    }

    // MARK: commands

    /// mpv_command_async; the reply arrives as an event with replyID (0 means no reply wanted).
    func command(_ args: [String], replyID: UInt64) -> Int32 {
        var c: [UnsafePointer<CChar>?] = args.map { UnsafePointer(strdup($0)) }
        c.append(nil)
        defer { for p in c { free(UnsafeMutableRawPointer(mutating: p)) } }
        return mpv_command_async(handle, replyID, &c)
    }

    func setString(_ name: String, _ value: String) -> Int32 {
        return mpv_set_property_string(handle, name, value)
    }

    func getString(_ name: String) -> String? {
        guard let s = mpv_get_property_string(handle, name) else { return nil }
        defer { mpv_free(UnsafeMutableRawPointer(s)) }
        return String(cString: s)
    }

    static func errorText(_ code: Int32) -> String { String(cString: mpv_error_string(code)) }

    // MARK: events

    func drain() {
        while !down {
            guard let ev = mpv_wait_event(handle, 0) else { return }
            let id = ev.pointee.event_id
            if id == MPV_EVENT_NONE { return }
            if id == MPV_EVENT_SHUTDOWN {
                down = true // the core is going away: nothing more to read
                return
            } else if id == MPV_EVENT_COMMAND_REPLY {
                let user = ev.pointee.reply_userdata
                if user != 0 {
                    var r: [String: Any] = ["type": "reply", "id": Int(user), "ok": ev.pointee.error >= 0]
                    if ev.pointee.error < 0 { r["error"] = Player.errorText(ev.pointee.error) }
                    emit?(r)
                }
            } else if id == MPV_EVENT_FILE_LOADED {
                emit?(["type": "fileLoaded"])
            } else if id == MPV_EVENT_PLAYBACK_RESTART {
                // Info line for the measuring runs: the decoder in use, never the link.
                fputs("info: hwdec-current=\(getString("hwdec-current") ?? "unavailable")\n", stderr)
                emit?(["type": "playbackRestart"])
            } else if id == MPV_EVENT_END_FILE {
                endFile(ev)
            } else if id == MPV_EVENT_PROPERTY_CHANGE {
                propertyChange(ev)
            }
        }
    }

    private func endFile(_ ev: UnsafeMutablePointer<mpv_event>) {
        guard let raw = ev.pointee.data else { return }
        let d = raw.assumingMemoryBound(to: mpv_event_end_file.self).pointee
        var reason = "stop"
        if d.reason == MPV_END_FILE_REASON_EOF { reason = "eof" }
        else if d.reason == MPV_END_FILE_REASON_STOP { reason = "stop" }
        else if d.reason == MPV_END_FILE_REASON_QUIT { reason = "quit" }
        else if d.reason == MPV_END_FILE_REASON_ERROR { reason = "error" }
        else if d.reason == MPV_END_FILE_REASON_REDIRECT { reason = "redirect" }
        var e: [String: Any] = ["type": "endFile", "reason": reason]
        if reason == "error" {
            e["error"] = Int(d.error)
            e["message"] = Player.errorText(d.error)
        }
        emit?(e)
        onEndFile?(reason)
    }

    private func propertyChange(_ ev: UnsafeMutablePointer<mpv_event>) {
        guard let raw = ev.pointee.data else { return }
        let p = raw.assumingMemoryBound(to: mpv_event_property.self).pointee
        guard let cname = p.name else { return }
        let name = String(cString: cname)
        var value: Any = NSNull()
        if p.format == MPV_FORMAT_DOUBLE, let d = p.data {
            let x = d.assumingMemoryBound(to: Double.self).pointee
            // time-pos changes every frame: pass it on four times a second, the overlay needs no more.
            if name == "time-pos" {
                let now = CFAbsoluteTimeGetCurrent()
                if now - (lastProp[name] ?? 0) < 0.25 { return }
                lastProp[name] = now
            }
            if x.isFinite { value = x }
        } else if p.format == MPV_FORMAT_FLAG, let d = p.data {
            value = d.assumingMemoryBound(to: Int32.self).pointee != 0
        }
        emit?(["type": "prop", "name": name, "value": value])
    }

    // MARK: teardown

    /// Update callback cleared and render context freed under the GL lock, then the core destroyed.
    func shutdown() {
        guard !destroyed else { return }
        destroyed = true
        down = true
        mpv_set_wakeup_callback(handle, nil, nil)
        core?.destroyRender()
        mpv_terminate_destroy(handle)
    }
    private var destroyed = false
}

// AlderProof shell entry. --selftest runs before any AppKit object exists; otherwise one window holds the video
// view (CAOpenGLLayer) and, as its sibling above, the WKWebView overlay.
import AppKit
import CoreAudio
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let opts: Options
    private var window: NSWindow?
    private var core: RenderCore?
    private var player: Player?
    private var bridge: Bridge?
    private var recorder: Recorder?
    private var quitApproved = false
    private var quitTimer: Timer?

    init(options: Options) {
        opts = options
        super.init()
    }

    private func die(_ why: String) -> Never {
        fputs("AlderProof: \(why)\n", stderr)
        exit(2)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Options before mpv_initialize. framedrop=vo so frame-drop-count counts; gpu-hwdec-interop=auto as IINA does.
        // No video-sync=display-*, no interpolation: both need a real vsync/presentation time, which this host (a CAOpenGLLayer, no
        // report_swap) does not have. video-sync stays at its default (audio). T8.1, R1.3-006.
        var mpvOptions: [(String, String)] = [
            ("vo", "libmpv"), ("hwdec", opts.hwdec), ("gpu-hwdec-interop", "auto"), ("framedrop", "vo"), ("osc", "no"),
            // coreaudio, decoded to PCM: an empty audio-spdif list means no passthrough of ac3/dts/eac3/truehd.
            ("ao", "coreaudio"), ("audio-spdif", ""),
        ]
        if let e = opts.end { mpvOptions.append(("end", String(e))) }
        if let script = opts.measureScript, let label = opts.label {
            let base = ProcessInfo.processInfo.environment["ALDERPROOF_DIR"] ?? (NSHomeDirectory() + "/AlderProof")
            let mode = opts.overlayShown ? "shell-shown" : "shell-hidden"
            // "scripts" is the list option itself ("script" is only a CLI alias); terminal+warn put a script's
            // load errors in the caller's log, which libmpv otherwise swallows (T7.1.1: no tsv, no reason).
            mpvOptions.append(("scripts", script))
            mpvOptions.append(("terminal", "yes"))
            mpvOptions.append(("msg-level", "all=warn"))
            mpvOptions.append(("script-opts", "measure-label=\(label),measure-mode=\(mode),measure-dir=\(base)/results"))
        }
        mpvOptions.append(contentsOf: opts.mpvOpts) // last, so --mpv-opt overrides anything above
        guard let player = Player(options: mpvOptions) else { die("mpv failed to start") }
        guard let core = RenderCore() else { die("no OpenGL context") }
        self.player = player
        self.core = core

        let rect = NSRect(x: 0, y: 0, width: 1280, height: 720)
        let win = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
        win.title = "Alder"
        win.collectionBehavior = [.fullScreenPrimary]
        win.isReleasedWhenClosed = false
        win.delegate = self
        // The window fills the visible screen (under the menu bar and Dock); it stays resizable.
        if let visible = NSScreen.main?.visibleFrame { win.setFrame(visible, display: false) } else { win.center() }
        win.backgroundColor = .black
        let content = NSView(frame: rect)
        win.contentView = content

        let video = VideoView(core: core)
        video.frame = content.bounds
        video.autoresizingMask = [.width, .height]
        content.addSubview(video)

        let bridge = Bridge(player: player, reportPath: opts.report)
        self.bridge = bridge
        bridge.onQuit = { [weak self] in self?.forceQuit() }
        let recorder = Recorder(label: opts.label, write: { [weak bridge] line in bridge?.appendReport(line) })
        recorder.isFullscreen = { [weak self] in self?.window?.styleMask.contains(.fullScreen) ?? false }
        self.recorder = recorder
        player.recorder = recorder
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("web") else { die("no bundled web directory") }
        let web = makeWebView(root: root, bridge: bridge)
        web.frame = content.bounds
        web.isHidden = !opts.overlayShown
        content.addSubview(web, positioned: .above, relativeTo: video)
        window = win
        win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // The VO waits for the render context, so attach it before anything is loaded.
        if !player.attachRender(core) { die("render context failed") }
        player.onEndFile = { [weak self] _ in
            // A timed or measured run ends with the file; the app goes with it so the caller can finish.
            if self?.opts.end != nil || self?.opts.measureScript != nil { self?.forceQuit() }
        }
        player.startEvents()
        guard let pageURL = URL(string: "alder://app/" + opts.page) else { die("bad --page \(opts.page)") }
        web.load(URLRequest(url: pageURL))
        if let secs = opts.quitAfter {
            // Backstop so an unattended run always ends, whatever the page does.
            Timer.scheduledTimer(withTimeInterval: secs, repeats: false) { [weak self] _ in
                self?.bridge?.appendReport("shell: quit-after reached")
                self?.forceQuit()
            }
        }
        if let url = opts.url {
            let rc = player.load(url: url, headers: [:], start: nil, replyID: 0)
            if rc < 0 { fputs("AlderProof: loadfile refused: \(Player.errorText(rc))\n", stderr) }
        }
        watchPowerAndAudio()
    }

    /// Sleep pauses mpv first, then tells the page; wake and a changed default output device are just told.
    private func watchPowerAndAudio() {
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.player?.releaseAwake()
            _ = self?.player?.setString("pause", "yes")
            self?.bridge?.emit(["type": "sleep"])
        }
        center.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.bridge?.emit(["type": "wake"])
        }
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                                 mScope: kAudioObjectPropertyScopeGlobal,
                                                 mElement: kAudioObjectPropertyElementMaster)
        let status = AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address,
                                                         DispatchQueue.main) { [weak self] _, _ in
            self?.bridge?.emit(["type": "audioDevice"])
        }
        if status != noErr { fputs("warn: no default-output-device listener (\(status))\n", stderr) }
    }

    // MARK: quitting
    // Cmd-Q and the window's close button tell the page (willQuit) and wait: the app ends on the page's quit command,
    // or after 3 s whatever the page does. Internal quits (--end, --quit-after, the page's own quit) go through forceQuit.

    private func requestQuit() {
        if quitTimer != nil { return }
        guard let bridge = bridge, bridge.webView != nil else { forceQuit(); return }
        bridge.emit(["type": "willQuit"])
        quitTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { [weak self] _ in self?.forceQuit() }
    }

    func forceQuit() {
        quitApproved = true
        quitTimer?.invalidate()
        NSApp.terminate(nil)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitApproved { return .terminateNow }
        requestQuit()
        return .terminateCancel
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        requestQuit()
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        player?.shutdown()
    }
}

let options = Options.parse(CommandLine.arguments)
if let file = options.selftest { runSelftest(file, hwdec: options.hwdec) }

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let mainMenu = NSMenu()
let appItem = NSMenuItem()
mainMenu.addItem(appItem)
let appMenu = NSMenu()
appMenu.addItem(withTitle: "Quit Alder", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
appItem.submenu = appMenu
let viewItem = NSMenuItem()
mainMenu.addItem(viewItem)
let viewMenu = NSMenu(title: "View")
let fullScreenItem = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
fullScreenItem.keyEquivalentModifierMask = [.command, .control]
viewMenu.addItem(fullScreenItem)
viewItem.submenu = viewMenu
app.mainMenu = mainMenu
let delegate = AppDelegate(options: options)
app.delegate = delegate
app.run()

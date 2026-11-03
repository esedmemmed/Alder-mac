// AlderProof shell entry. --selftest runs before any AppKit object exists; otherwise one window holds the video
// view (CAOpenGLLayer) and, as its sibling above, the WKWebView overlay.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let opts: Options
    private var window: NSWindow?
    private var core: RenderCore?
    private var player: Player?
    private var bridge: Bridge?

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
        var mpvOptions: [(String, String)] = [
            ("vo", "libmpv"), ("hwdec", opts.hwdec), ("gpu-hwdec-interop", "auto"), ("framedrop", "vo"), ("osc", "no"),
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
        guard let player = Player(options: mpvOptions) else { die("mpv failed to start") }
        guard let core = RenderCore() else { die("no OpenGL context") }
        self.player = player
        self.core = core

        let rect = NSRect(x: 0, y: 0, width: 1280, height: 720)
        let win = NSWindow(contentRect: rect, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                           backing: .buffered, defer: false)
        win.title = "Alder"
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
            if self?.opts.end != nil || self?.opts.measureScript != nil { NSApp.terminate(nil) }
        }
        player.startEvents()
        guard let pageURL = URL(string: "alder://app/" + opts.page) else { die("bad --page \(opts.page)") }
        web.load(URLRequest(url: pageURL))
        if let url = opts.url {
            let rc = player.command(["loadfile", url, "replace"], replyID: 0)
            if rc < 0 { fputs("AlderProof: loadfile refused: \(Player.errorText(rc))\n", stderr) }
        }
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
app.mainMenu = mainMenu
let delegate = AppDelegate(options: options)
app.delegate = delegate
app.run()

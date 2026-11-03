// Video surface: a CAOpenGLLayer that mpv renders into through the libmpv render API, on the pattern of IINA's
// ViewLayer (R1.1-009). The layer is not asynchronous. The mpv update callback only hops to a serial queue, which
// calls layer.display() inside an explicit CATransaction (display() off the main thread needs one, IINA issue 5038).
// canDraw/draw run on that queue; every mpv_render_* call runs under the CGL context lock, one at a time.
// render.h on MPV_RENDER_PARAM_ADVANCED_CONTROL: mpv_render_context_update must follow every update callback (done in
// canDraw), and the render thread must not call other libmpv API or wait on one (draw calls none).
// mpv_render_context_report_swap is not called (T8.1): glFlush is not the vsync and CA presents later; see draw().
import AppKit
import OpenGL    // CGL
import OpenGL.GL // gl.h is an explicit submodule: plain `import OpenGL` does not expose it (run 41389747748)
import QuartzCore

/// GL context, pixel format and the mpv render context, shared by the layer and its presentation copies.
final class RenderCore {
    let pixelFormat: CGLPixelFormatObj
    let context: CGLContextObj
    let queue = DispatchQueue(label: "alder.gl", qos: .userInteractive)
    weak var layer: ViewLayer?
    /// Guarded by the CGL context lock: set by Player.attachRender, cleared by destroyRender.
    var render: OpaquePointer?
    private let flagLock = NSLock()
    private var forceFlag = false
    private var frameReady = false   // render queue only
    private var cachedFBO: GLint = 0 // render queue only

    init?() {
        // 3.2 core first (what mpv's own macOS VO asks for), the legacy profile when it is refused.
        let core: [CGLPixelFormatAttribute] = [
            kCGLPFAOpenGLProfile, CGLPixelFormatAttribute(rawValue: 0x3200), // 0x3200 = kCGLOGLPVersion_3_2_Core
            kCGLPFAAccelerated, kCGLPFADoubleBuffer, CGLPixelFormatAttribute(rawValue: 0),
        ]
        let legacy: [CGLPixelFormatAttribute] = [
            kCGLPFAAccelerated, kCGLPFADoubleBuffer, CGLPixelFormatAttribute(rawValue: 0),
        ]
        var pf: CGLPixelFormatObj?
        var n: GLint = 0
        if CGLChoosePixelFormat(core, &pf, &n) != kCGLNoError || pf == nil {
            pf = nil
            if CGLChoosePixelFormat(legacy, &pf, &n) != kCGLNoError || pf == nil { return nil }
        }
        var ctx: CGLContextObj?
        if CGLCreateContext(pf!, nil, &ctx) != kCGLNoError || ctx == nil { return nil }
        var interval: GLint = 1
        CGLSetParameter(ctx!, kCGLCPSwapInterval, &interval)
        pixelFormat = pf!
        context = ctx!
    }

    func forceNextDraw() {
        flagLock.lock(); forceFlag = true; flagLock.unlock()
    }
    private func forceSet(clear: Bool) -> Bool {
        flagLock.lock(); defer { flagLock.unlock() }
        let f = forceFlag
        if clear { forceFlag = false }
        return f
    }

    /// Any thread: mpv's update callback, and the main thread on resize.
    func requestDraw() {
        queue.async { [weak self] in
            guard let layer = self?.layer else { return }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.display()
            CATransaction.commit()
        }
    }

    /// Render queue, from canDraw. The FRAME flag from mpv_render_context_update is kept for the draw that follows.
    func canDraw() -> Bool {
        CGLLockContext(context)
        defer { CGLUnlockContext(context) }
        CGLSetCurrentContext(context)
        if let rc = render {
            // MPV_RENDER_UPDATE_FRAME is 1 << 0 (render.h); the literal avoids depending on how Swift imports that enum.
            if (mpv_render_context_update(rc) & 1) != 0 { frameReady = true }
        }
        return frameReady || forceSet(clear: false)
    }

    /// Render queue, from draw.
    func draw(width: Int32, height: Int32) {
        CGLLockContext(context)
        defer { CGLUnlockContext(context) }
        CGLSetCurrentContext(context)
        _ = forceSet(clear: true)
        frameReady = false
        var binding: GLint = 0
        glGetIntegerv(0x8CA6, &binding) // GL_DRAW_FRAMEBUFFER_BINDING, defined in gl3.h/glext.h only
        if binding != 0 { cachedFBO = binding }
        guard let rc = render else {
            glClearColor(0, 0, 0, 1)
            glClear(GLbitfield(GL_COLOR_BUFFER_BIT))
            glFlush()
            return
        }
        var fbo = mpv_opengl_fbo(fbo: binding != 0 ? binding : cachedFBO, w: width, h: height, internal_format: 0)
        var flip: Int32 = 1
        withUnsafeMutablePointer(to: &fbo) { fboPtr in
            withUnsafeMutablePointer(to: &flip) { flipPtr in
                var params = [
                    mpv_render_param(type: MPV_RENDER_PARAM_OPENGL_FBO, data: UnsafeMutableRawPointer(fboPtr)),
                    mpv_render_param(type: MPV_RENDER_PARAM_FLIP_Y, data: UnsafeMutableRawPointer(flipPtr)),
                    mpv_render_param(type: MPV_RENDER_PARAM_INVALID, data: nil),
                ]
                _ = mpv_render_context_render(rc, &params)
            }
        }
        glFlush()
        // was: mpv_render_context_report_swap(rc)
        // Off (T8.1, R1.3-006): this ran at glFlush, not at the vsync; CoreAnimation presents the layer later. render.h: report_swap
        // used inconsistently makes playback bad, and the periodic ~0.5 s hitch was seen with it on. Re-enable only with a real
        // presentation-time source (a CVDisplayLink, not this layer).
    }

    /// Main thread, teardown: clear the update callback, free the render context under the lock. After this
    /// no render call can start (draw sees render == nil and clears to black).
    func destroyRender() {
        CGLLockContext(context)
        defer { CGLUnlockContext(context) }
        CGLSetCurrentContext(context)
        if let rc = render {
            render = nil
            mpv_render_context_set_update_callback(rc, nil, nil)
            mpv_render_context_free(rc)
        }
        CGLSetCurrentContext(nil)
    }
}

final class ViewLayer: CAOpenGLLayer {
    let core: RenderCore

    init(core: RenderCore) {
        self.core = core
        super.init()
        core.layer = self
        isAsynchronous = false
        isOpaque = true
        backgroundColor = CGColor(gray: 0, alpha: 1)
    }

    // CA makes presentation copies of a layer through this initializer.
    override init(layer: Any) {
        core = (layer as! ViewLayer).core
        super.init(layer: layer)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func copyCGLPixelFormat(forDisplayMask mask: UInt32) -> CGLPixelFormatObj {
        // "copy" in a Cocoa name: the caller releases what it gets, so hand out a retain.
        return CGLRetainPixelFormat(core.pixelFormat)
    }

    override func copyCGLContext(forPixelFormat pf: CGLPixelFormatObj) -> CGLContextObj {
        return CGLRetainContext(core.context)
    }

    override func canDraw(inCGLContext ctx: CGLContextObj, pixelFormat pf: CGLPixelFormatObj,
                          forLayerTime t: CFTimeInterval, displayTime ts: UnsafePointer<CVTimeStamp>?) -> Bool {
        return core.canDraw()
    }

    override func draw(inCGLContext ctx: CGLContextObj, pixelFormat pf: CGLPixelFormatObj,
                       forLayerTime t: CFTimeInterval, displayTime ts: UnsafePointer<CVTimeStamp>?) {
        let w = Int32(max(1, (bounds.width * contentsScale).rounded()))
        let h = Int32(max(1, (bounds.height * contentsScale).rounded()))
        core.draw(width: w, height: h)
    }
}

final class VideoView: NSView {
    let videoLayer: ViewLayer

    init(core: RenderCore) {
        videoLayer = ViewLayer(core: core)
        super.init(frame: .zero)
        layer = videoLayer      // before wantsLayer: the view then hosts this layer instead of making its own
        wantsLayer = true
        wantsBestResolutionOpenGLSurface = true
        autoresizingMask = [.width, .height]
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) {}

    private func syncLayer() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        videoLayer.frame = bounds
        videoLayer.contentsScale = window?.backingScaleFactor ?? 1
        CATransaction.commit()
        videoLayer.core.forceNextDraw()
        videoLayer.core.requestDraw()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        syncLayer()
    }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        syncLayer()
    }
    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        syncLayer()
    }
}

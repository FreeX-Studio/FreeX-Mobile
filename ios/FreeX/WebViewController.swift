/*
 * Copyright (c) 2026 MirraNET, Niklas Linz. All rights reserved.
 *
 * This file is part of the MirraNET project and is licensed under the
 * GNU Lesser General Public License v3.0 (LGPLv3).
 *
 * You may use, distribute and modify this code under the terms
 * of the LGPLv3 license. You should have received a copy of the
 * license along with this file. If not, see <https://www.gnu.org/licenses/lgpl-3.0.html>
 * or contact: niklas.linz@mirranet.de
 */

import AVKit
import CoreMedia
import UIKit
import VideoToolbox
import WebKit

/// The whole app: the shared interface (web/) in a transparent WKWebView with the AVPlayer view
/// behind it. The page describes the app through `window.FreeXHostInfo`, sends commands to the
/// message handler `freex` and hears back through `window.FreeXHostEvent` (see web/js/host.js).
final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {

    private var webView: WKWebView!
    private lazy var player = NativePlayer { [weak self] event in self?.send(event) }
    private let routePicker = AVRoutePickerView()
    private var videoMode = false
    private var keyboardHeight: CGFloat = 0
    private let defaults = UserDefaults.standard
    private static let stateKey = "state"
    private static let ink = UIColor(red: 0x12 / 255.0, green: 0x18 / 255.0, blue: 0x21 / 255.0, alpha: 1)

    var orientations: UIInterfaceOrientationMask {
        if videoMode { return .landscape }
        return UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { orientations }
    override var prefersStatusBarHidden: Bool { videoMode }
    override var prefersHomeIndicatorAutoHidden: Bool { videoMode }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { videoMode ? .all : [] }

    private var version: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
    }

    override func loadView() {
        let root = UIView()
        root.backgroundColor = Self.ink
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(), forURLScheme: SchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        config.applicationNameForUserAgent = "FreeXMobile/\(version)"
        let content = WKUserContentController()
        content.add(WeakMessageHandler(self), name: "freex")
        config.userContentController = content
        installInfo(content)

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        // The page lays itself out with env(safe-area-inset-*) and scrolls inside; the web view itself stays put.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        player.onPip = { [weak self] on in self?.send(["type": "pip", "on": on]) }
        view.addSubview(player.view)
        view.addSubview(webView)
        routePicker.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        routePicker.alpha = 0.02
        routePicker.isUserInteractionEnabled = false
        view.addSubview(routePicker)

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)

        webView.load(URLRequest(url: SchemeHandler.start))
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        player.view.frame = view.bounds
        // The keyboard makes the page shorter (like adjustResize on Android) instead of pushing it up.
        var frame = view.bounds
        frame.size.height -= keyboardHeight
        webView.frame = frame
    }

    @objc private func keyboardChanged(_ n: Notification) {
        var height: CGFloat = 0
        if n.name != UIResponder.keyboardWillHideNotification,
           let end = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue {
            let local = view.convert(end, from: nil)
            height = max(0, view.bounds.maxY - local.minY)
        }
        guard height != keyboardHeight else { return }
        keyboardHeight = height
        let duration = (n.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        UIView.animate(withDuration: duration) { self.view.setNeedsLayout(); self.view.layoutIfNeeded() }
    }

    // MARK: - What the page learns at its start

    /// `window.FreeXHostInfo` before the page's own scripts (again before every load, with the saved state).
    private func installInfo(_ content: WKUserContentController) {
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(source: "window.FreeXHostInfo = \(infoJSON());",
                                           injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func infoJSON() -> String {
        let info: [String: Any] = [
            "platform": "ios",
            "version": version,
            "deviceName": UIDevice.current.name,
            "caps": Self.capabilities(),
            "stored": defaults.string(forKey: Self.stateKey) ?? "{}",
            "pip": AVPictureInPictureController.isPictureInPictureSupported(),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: info),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    /// What AVPlayer plays, as the server's playback decision expects it. AVPlayer opens MP4 and
    /// MOV files itself; everything else comes as HLS (fMP4), with the codecs copied where it can.
    static func capabilities() -> [String: Any] {
        var video = ["h264"]
        if VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC) { video.append("hevc") }
        // 'av01': A17 Pro, M3 and newer decode AV1 in hardware.
        if #available(iOS 17.0, *), VTIsHardwareDecodeSupported(CMVideoCodecType(0x6176_3031)) { video.append("av1") }
        return [
            "containers": ["mp4"],
            "video": video,
            "audio": ["aac", "mp3", "ac3", "eac3", "flac", "alac", "pcm_s16le", "pcm_s24le"],
            "mseVideo": video,
            "mseAudio": ["aac", "ac3", "eac3"],
        ]
    }

    // MARK: - Messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "save":
            if let s = body["data"] as? String { defaults.set(s, forKey: Self.stateKey) }
        case "open":
            player.open(body)
        case "play":
            player.play()
        case "pause":
            player.pause()
        case "seek":
            player.seek(ms: (body["ms"] as? NSNumber)?.doubleValue ?? 0)
        case "rate":
            player.setRate((body["value"] as? NSNumber)?.floatValue ?? 1)
        case "stop":
            player.stop()
        case "pip":
            player.startPip()
        case "airplay":
            showRoutes()
        case "video":
            setVideoMode((body["on"] as? NSNumber)?.boolValue ?? false)
        case "openUrl":
            if let s = body["url"] as? String, let url = URL(string: s), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
        case "haptic":
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        default:
            break
        }
    }

    private func send(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.FreeXHostEvent && window.FreeXHostEvent(\(json))", completionHandler: nil)
    }

    /// The player: sideways, without status bar and home indicator.
    private func setVideoMode(_ on: Bool) {
        guard on != videoMode else { return }
        videoMode = on
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        setNeedsUpdateOfScreenEdgesDeferringSystemGestures()
        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
            if let scene = view.window?.windowScene {
                let mask: UIInterfaceOrientationMask = on ? .landscape : (UIDevice.current.userInterfaceIdiom == .pad ? .all : .portrait)
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
                if !on {
                    // back to free rotation once the interface is upright again
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.setNeedsUpdateOfSupportedInterfaceOrientations() }
                }
            }
        } else {
            UIDevice.current.setValue((on ? UIInterfaceOrientation.landscapeRight : .portrait).rawValue, forKey: "orientation")
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }

    /// AirPlay: the system's route picker, opened through its own button.
    private func showRoutes() {
        for case let button as UIButton in routePicker.subviews {
            button.sendActions(for: .touchUpInside)
            return
        }
    }

    // MARK: - Life cycle

    @objc private func didEnterBackground() {
        // In picture in picture (or on an AirPlay screen) the video goes on; otherwise it pauses.
        if player.isActive && !player.isPipActive && !(player.view.playerLayer.player?.isExternalPlaybackActive ?? false) {
            player.pause()
        }
        send(["type": "app", "state": "background"])
    }

    @objc private func willEnterForeground() {
        send(["type": "app", "state": "foreground"])
    }

    // MARK: - Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == SchemeHandler.scheme || url.scheme == "about" { return decisionHandler(.allow) }
        if ["http", "https"].contains(url.scheme?.lowercased() ?? "") && action.targetFrame?.isMainFrame != false {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    /// window.open: in the browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") { UIApplication.shared.open(url) }
        return nil
    }

    /// The web content process ended (memory pressure in the background): start the page again.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        player.stop()
        if videoMode { setVideoMode(false) }
        installInfo(webView.configuration.userContentController)
        webView.load(URLRequest(url: SchemeHandler.start))
    }
}

/// Keeps the user content controller from holding on to the view controller.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

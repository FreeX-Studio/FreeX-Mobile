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

import AVFoundation
import AVKit
import MediaPlayer
import UIKit

/// A view whose layer shows an AVPlayer.
final class PlayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

/// AVPlayer for the page: plays one URL (the file itself or the server's HLS conversion), draws
/// behind the transparent WKWebView and reports its state as events (see web/js/host.js). It also
/// feeds the lock screen, Control Center, picture in picture and AirPlay. Main thread only.
final class NativePlayer: NSObject, AVPictureInPictureControllerDelegate {

    let view = PlayerView()
    var onPip: ((Bool) -> Void)?

    private let player = AVPlayer()
    private let emit: ([String: Any]) -> Void
    private var timeObserver: Any?
    private var observations: [NSKeyValueObservation] = []
    private var itemObservations: [NSKeyValueObservation] = []
    private var endObserver: NSObjectProtocol?
    private var failObserver: NSObjectProtocol?
    private var readySent = false
    private var startTime = CMTime.zero
    private var rate: Float = 1
    private var pip: AVPictureInPictureController?
    private var nowPlaying: [String: Any] = [:]
    private var artworkTask: URLSessionDataTask?

    var isActive: Bool { player.currentItem != nil }
    var isPlaying: Bool { player.timeControlStatus != .paused }
    var isPipActive: Bool { pip?.isPictureInPictureActive ?? false }

    init(emit: @escaping ([String: Any]) -> Void) {
        self.emit = emit
        super.init()
        view.backgroundColor = .black
        view.isHidden = true
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        player.allowsExternalPlayback = true
        player.preventsDisplaySleepDuringVideoPlayback = true
        if AVPictureInPictureController.isPictureInPictureSupported() {
            pip = AVPictureInPictureController(playerLayer: view.playerLayer)
            pip?.delegate = self
            pip?.canStartPictureInPictureAutomaticallyFromInline = true
        }
        observations.append(player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.timeControlChanged() }
        })
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 2), queue: .main) { [weak self] _ in
            guard let self, self.readySent else { return }
            self.send("time")
        }
        remoteCommands()
    }

    // MARK: - State for the page

    private func positionMs() -> Double {
        let s = CMTimeGetSeconds(player.currentTime())
        return s.isFinite ? max(0, s * 1000) : 0
    }

    private func durationMs() -> Double {
        guard let d = player.currentItem?.duration else { return 0 }
        let s = CMTimeGetSeconds(d)
        return s.isFinite ? s * 1000 : 0
    }

    private func send(_ type: String) {
        emit(["type": type, "position": positionMs(), "duration": durationMs(), "playing": isPlaying])
    }

    private func timeControlChanged() {
        guard player.currentItem != nil else { return }
        switch player.timeControlStatus {
        case .waitingToPlayAtSpecifiedRate:
            emit(["type": "buffering", "on": true])
        case .playing:
            emit(["type": "buffering", "on": false])
            send("state")
        default:
            send("state")
        }
        updateNowPlaying()
    }

    // MARK: - Commands

    /// `{url, hls, startMs, title, subtitle, artwork}` from the page.
    func open(_ o: [String: Any]) {
        guard let s = o["url"] as? String, let url = URL(string: s) else {
            emit(["type": "error", "message": "bad URL"])
            return
        }
        stop()
        readySent = false
        let startMs = (o["startMs"] as? NSNumber)?.doubleValue ?? 0
        startTime = CMTime(seconds: startMs / 1000, preferredTimescale: 1000)
        let item = AVPlayerItem(url: url)
        // Segments of a conversion are made on request: allow some buffer.
        item.preferredForwardBufferDuration = 30
        itemObservations.append(item.observe(\.status, options: [.new]) { [weak self] it, _ in
            DispatchQueue.main.async { self?.statusChanged(it) }
        })
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            self?.send("ended")
        }
        failObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { [weak self] n in
            let err = n.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            self?.emit(["type": "error", "message": err?.localizedDescription ?? "playback failed"])
        }
        player.replaceCurrentItem(with: item)
        view.isHidden = false
        nowPlaying = [
            MPMediaItemPropertyTitle: (o["title"] as? String) ?? "",
            MPMediaItemPropertyArtist: (o["subtitle"] as? String) ?? "",
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
        ]
        loadArtwork((o["artwork"] as? String) ?? "")
    }

    private func statusChanged(_ item: AVPlayerItem) {
        guard item === player.currentItem else { return }
        switch item.status {
        case .readyToPlay where !readySent:
            let tolerance = CMTime(seconds: 1, preferredTimescale: 1000)
            let ready = { [weak self] in
                guard let self, item === self.player.currentItem, !self.readySent else { return }
                self.readySent = true
                self.send("ready")
                self.updateNowPlaying()
            }
            if CMTimeGetSeconds(startTime) > 0 {
                player.seek(to: startTime, toleranceBefore: tolerance, toleranceAfter: tolerance) { _ in
                    DispatchQueue.main.async { ready() }
                }
            } else {
                ready()
            }
        case .failed:
            emit(["type": "error", "message": item.error?.localizedDescription ?? "failed"])
        default:
            break
        }
    }

    func play() {
        player.play()
        if rate != 1 { player.rate = rate }
    }

    func pause() {
        player.pause()
    }

    func seek(ms: Double) {
        let t = CMTime(seconds: max(0, ms) / 1000, preferredTimescale: 1000)
        let tolerance = CMTime(seconds: 0.5, preferredTimescale: 1000)
        player.seek(to: t, toleranceBefore: tolerance, toleranceAfter: tolerance) { [weak self] _ in
            DispatchQueue.main.async {
                self?.send("time")
                self?.updateNowPlaying()
            }
        }
    }

    func setRate(_ value: Float) {
        rate = min(4, max(0.25, value))
        if #available(iOS 16.0, *) { player.defaultRate = rate }
        if isPlaying { player.rate = rate }
        updateNowPlaying()
    }

    func stop() {
        player.pause()
        itemObservations.forEach { $0.invalidate() }
        itemObservations.removeAll()
        if let o = endObserver { NotificationCenter.default.removeObserver(o) }
        if let o = failObserver { NotificationCenter.default.removeObserver(o) }
        endObserver = nil
        failObserver = nil
        artworkTask?.cancel()
        player.replaceCurrentItem(with: nil)
        view.isHidden = true
        readySent = false
        nowPlaying = [:]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    // MARK: - Picture in picture

    func startPip() {
        guard let pip, isActive else { return }
        if pip.isPictureInPictureActive { pip.stopPictureInPicture() } else { pip.startPictureInPicture() }
    }

    func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        onPip?(true)
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        onPip?(false)
    }

    func pictureInPictureController(_ controller: AVPictureInPictureController,
                                    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }

    // MARK: - Lock screen and Control Center

    private func remoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            guard let self, self.isActive else { return .noActionableNowPlayingItem }
            self.play()
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            guard let self, self.isActive else { return .noActionableNowPlayingItem }
            self.pause()
            return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self, self.isActive else { return .noActionableNowPlayingItem }
            if self.isPlaying { self.pause() } else { self.play() }
            return .success
        }
        c.skipForwardCommand.preferredIntervals = [10]
        c.skipForwardCommand.addTarget { [weak self] _ in
            guard let self, self.isActive else { return .noActionableNowPlayingItem }
            self.seek(ms: self.positionMs() + 10_000)
            return .success
        }
        c.skipBackwardCommand.preferredIntervals = [10]
        c.skipBackwardCommand.addTarget { [weak self] _ in
            guard let self, self.isActive else { return .noActionableNowPlayingItem }
            self.seek(ms: self.positionMs() - 10_000)
            return .success
        }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let self, self.isActive, let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(ms: e.positionTime * 1000)
            return .success
        }
    }

    private func updateNowPlaying() {
        guard isActive, !nowPlaying.isEmpty else { return }
        var info = nowPlaying
        info[MPMediaItemPropertyPlaybackDuration] = durationMs() / 1000
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = positionMs() / 1000
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(rate) : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func loadArtwork(_ s: String) {
        guard let url = URL(string: s), url.scheme?.hasPrefix("http") == true else { return }
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, !self.nowPlaying.isEmpty else { return }
                self.nowPlaying[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.updateNowPlaying()
            }
        }
        artworkTask?.resume()
    }
}

// System media volume for iOS.
//
// iOS offers no public API to set the output volume directly. The sanctioned
// workaround is an (off-screen) MPVolumeView: driving its internal UISlider
// changes the real system volume.
//
// READING/WATCHING GOTCHA: AVAudioSession.outputVolume (and its KVO) only
// refreshes while OUR shared session is active — and it never is, because
// WebKit plays <audio>/<video> on its own private session. Polling it just
// re-reads a frozen value. The sources that DO track hardware buttons here:
//   1. The MPVolumeView's internal slider — the system moves it live and
//      fires .valueChanged (works even parked off-screen).
//   2. The "SystemVolumeDidChange" NotificationCenter notification
//      (public since iOS 15; userInfo["Volume"] carries the new value).
// We use both, plus a slow slider-value poll as a belt-and-braces fallback.
//
// IMPORTANT: we never call AVAudioSession.setActive here. WebKit manages the
// audio session for <audio>/<video> playback itself (that is what makes
// background audio work today) — activating our own session could interrupt it.

import AVFoundation
import MediaPlayer
import SwiftRs
import Tauri
import UIKit
import WebKit

class SetVolumeArgs: Decodable {
  let volume: Float
}

class SetBrightnessArgs: Decodable {
  let brightness: Float
}

class WatchVolumeArgs: Decodable {
  let channel: Channel
}

class SystemVolumePlugin: Plugin {
  private var volumeView: MPVolumeView?
  private var watcherChannels: [Channel] = []
  private var volumeNotificationObserver: NSObjectProtocol?
  private var pollTimer: Timer?
  private var lastSent: Float = -1

  @objc public override func load(webview: WKWebView) {
    DispatchQueue.main.async {
      // Parked far off-screen: never visible, but must be in the view
      // hierarchy for its slider to control (and mirror) the hardware volume.
      let view = MPVolumeView(frame: CGRect(x: -3000, y: -3000, width: 1, height: 1))
      view.clipsToBounds = true
      webview.addSubview(view)
      self.volumeView = view
      self.attachSliderTarget(attempt: 0)
    }

    // Public system notification — fires for hardware buttons and Control
    // Center regardless of our audio session state.
    volumeNotificationObserver = NotificationCenter.default.addObserver(
      forName: NSNotification.Name("SystemVolumeDidChange"),
      object: nil,
      queue: .main
    ) { [weak self] note in
      guard let volume = note.userInfo?["Volume"] as? Float else { return }
      self?.notifyWatchers(volume: volume)
    }
  }

  // The MPVolumeView builds its internal UISlider lazily — retry a few times.
  private func attachSliderTarget(attempt: Int) {
    if let slider = findSlider() {
      slider.addTarget(self, action: #selector(sliderChanged(_:)), for: .valueChanged)
    } else if attempt < 10 {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
        self.attachSliderTarget(attempt: attempt + 1)
      }
    }
  }

  @objc private func sliderChanged(_ slider: UISlider) {
    notifyWatchers(volume: slider.value)
  }

  // Prefer the slider (kept current by the system); outputVolume is only the
  // fallback before the slider exists and may be stale.
  private func currentVolume() -> Float {
    return findSlider()?.value ?? AVAudioSession.sharedInstance().outputVolume
  }

  @objc public func getVolume(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      invoke.resolve(["volume": self.currentVolume()])
    }
  }

  @objc public func setVolume(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetVolumeArgs.self)
    let target = max(0, min(1, args.volume))
    DispatchQueue.main.async {
      if let slider = self.findSlider() {
        slider.value = target
      } else {
        // The MPVolumeView builds its subviews lazily — retry once shortly.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
          self.findSlider()?.value = target
        }
      }
    }
    invoke.resolve()
  }

  @objc public func watchVolume(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WatchVolumeArgs.self)
    // All watcher mutation/iteration happens on the main queue (slider target,
    // notification observer, and timer all fire there).
    DispatchQueue.main.async {
      self.watcherChannels.append(args.channel)
      if self.pollTimer == nil {
        // Slow safety net in case both event paths miss a change; reads the
        // slider (not outputVolume), dedup'd in notifyWatchers. .common mode
        // so it keeps firing during scroll/touch tracking.
        let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
          guard let self = self else { return }
          self.notifyWatchers(volume: self.currentVolume())
        }
        RunLoop.main.add(timer, forMode: .common)
        self.pollTimer = timer
      }
    }
    invoke.resolve()
  }

  private func notifyWatchers(volume: Float) {
    if volume == lastSent { return }
    lastSent = volume
    for channel in watcherChannels {
      try? channel.send(["volume": volume])
    }
  }

  private func findSlider() -> UISlider? {
    return volumeView?.subviews.compactMap { $0 as? UISlider }.first
  }

  // ---- Screen brightness -------------------------------------------------
  // UIScreen.main.brightness is settable app-wide. NOTE: unlike Android's
  // per-window value, it PERSISTS after the app closes — the JS side captures
  // the original value and restores it when the video player exits.

  @objc public func getBrightness(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      invoke.resolve(["brightness": Float(UIScreen.main.brightness)])
    }
  }

  @objc public func setBrightness(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetBrightnessArgs.self)
    let target = CGFloat(max(0, min(1, args.brightness)))
    DispatchQueue.main.async {
      UIScreen.main.brightness = target
    }
    invoke.resolve()
  }

  @objc public func restoreBrightness(_ invoke: Invoke) throws {
    // iOS has no "follow system" sentinel to return to — restoration happens
    // in JS by re-setting the value captured before the first change.
    invoke.resolve()
  }
}

@_cdecl("init_plugin_system_volume")
func initPlugin() -> Plugin {
  return SystemVolumePlugin()
}

<p align="center">
  <img src="web/img/logo.svg" alt="FreeX" width="110">
</p>

<h1 align="center">FreeX Mobile</h1>

<p align="center">
  <strong>The iOS and Android apps for <a href="https://github.com/FreeX-Studio/freex-media-server">FreeX Media Server</a>:
  iPhone, iPad and Android phones and tablets.</strong>
</p>

FreeX Mobile brings your FreeX library to your phone: the home screen with *Continue watching*, *Up next* and
*Recently added*, your libraries as poster grids (sorting, filters, genres, the server's recommendations and
collections), the watchlist and search, detail pages with seasons and episodes, cast and extras, and a player made
for touch: double tap to jump, a seek bar with preview pictures, *Skip intro*, *Next episode*, subtitles, audio
tracks, quality and speed, picture in picture, and AirPlay on iOS.

Both apps share one interface (`web/`). Videos are played by the phone's own player, so many files play directly,
without conversion on the server:

| Platform | Interface | Player | Plays directly |
|---|---|---|---|
| **iOS / iPadOS** 15+ | WKWebView with the shared interface | **AVPlayer** | MP4 and MOV with H.264, HEVC (and AV1 on A17 Pro / M3 and newer); AAC, MP3, Dolby Digital (Plus), FLAC, ALAC. Everything else comes as HLS from the server, with the video copied where possible |
| **Android** 7.0+ | WebView with the shared interface | **ExoPlayer** (Media3) | MKV, MP4, WebM, TS, AVI, …; whatever the phone's decoders report (checked at runtime) |

Whatever the device cannot decode, the server converts on the fly, as for FreeX Web.

## Features

- Connecting to a server by its address (recent servers are remembered), sign-in with two-factor authentication,
  switching users with a PIN
- Tab bar with *Home*, *Libraries*, *Search*, *Watchlist* and *Settings*; pull down to refresh; swipe from the left
  edge to go back (Android: the back button)
- Player: native video under touch controls, double tap left / right for ±10 s, seek previews, chapters, *Skip intro*
  and *Skip credits*, *Next episode* with countdown, audio tracks and subtitles (text drawn by the app in your
  subtitle style, picture subtitles burned in by the server), quality, speed; picture in picture; lock screen and
  headset controls; AirPlay (iOS); progress is reported to the server like in FreeX Web
- Settings of your account: audio and subtitle language, subtitle mode and size, the quality at home and on the go,
  the display language (German and English)

## Requirements

- **FreeX Media Server with the app API** (CORS for apps and stream URLs with an access token, as for FreeX TV:
  [freex-media-server#2](https://github.com/FreeX-Studio/freex-media-server/pull/2), in the release after 0.21.0).
- The phone in the same network as the server, or the server reachable from the internet (HTTPS through a reverse
  proxy works too). Plain HTTP in the home network is allowed by both apps.

## Installing

### Android

Install `FreeX-Android-<version>.apk` from the [releases](../../releases) (allow installing from your browser or
file manager when Android asks). Start **FreeX**, enter the address of your server (e.g. `192.168.1.10`; without a
port, `32500` is used) and sign in.

### iPhone and iPad

iOS installs apps only from the App Store, TestFlight or signed with your own Apple ID:

- **With Xcode** (on a Mac): open `ios/FreeX.xcodeproj`, choose your team under *Signing & Capabilities* (a free
  Apple ID works for your own devices), connect the iPhone and press *Run*.
- **Without Xcode**: the releases have `FreeX-iOS-<version>-unsigned.ipa`, which you can sign and install with a
  tool such as AltStore or Sideloadly.

On the first connection iOS asks for access to the *local network*: allow it, otherwise a server in your home
network cannot be reached.

## How it works

```
┌──────────────── web/ (shared) ─────────────────┐
│ screens.js  connect, sign-in, home, libraries,  │
│             details, search, watchlist, settings│      FreeX Media Server
│ player.js   touch controls, subtitles, Skip     │  ──  /api (JSON, token in X-FreeX-Token)
│             intro, Up next, progress reports    │      /api/cast/{token}/…  stream URLs with
│ ui.js       screen stack, sheets, cards, rows   │      their own token for native players
│ host.js     bridge to the app │ <video> + hls.js│
└─────────────────────────────────────────────────┘
      │ iOS:     WKWebView (page from freex://app) + AVPlayer under it (ios/)
      │ Android: WebView (page from the app's assets) + ExoPlayer under it (android/)
```

- The interface runs from the app itself, not from the server. It calls the API across origins with the sign-in
  token in a header; the server allows that for apps (CORS without credentials). Artwork is loaded the same way and
  shown from blob URLs.
- For playback the app asks `POST /api/items/{id}/playback` with the device's capabilities and `"tokenUrls": true`.
  The answer is a URL with its own access token for the file or the HLS conversion, which the native players load
  without headers.
- The bridge: at the start the app describes itself (Android: `FreeXNative.info()`, iOS: `window.FreeXHostInfo`
  with version, device name, codecs and the saved sign-in). Commands go to the app as `{cmd, …}` objects
  (`FreeXNative.post`, iOS message handler `freex`): `open`, `play`, `pause`, `seek`, `rate`, `stop`, `pip`,
  `airplay`, `video` (landscape without system bars), `save`, `openUrl`, `haptic`, `exit`. The app answers through
  `window.FreeXHostEvent` with player events (`ready`, `time`, `state`, `buffering`, `ended`, `error`) and `pip`,
  `app` (foreground / background), `back` (Android) and `insets` (Android system bars).
- The sign-in (server, token, device id) is kept by the app (UserDefaults, SharedPreferences).

## Building

| | |
|---|---|
| Android | `cd android && ./gradlew assembleRelease` (JDK 17, Android SDK 35) → `android/app/build/outputs/apk/release/app-release.apk`. Signed with the debug key unless `FREEX_KEYSTORE`, `FREEX_KEYSTORE_PASSWORD`, `FREEX_KEY_ALIAS` and `FREEX_KEY_PASSWORD` name a release keystore. |
| iOS | Xcode 16 or newer: open `ios/FreeX.xcodeproj` and build the scheme *FreeX*, or `xcodebuild -project ios/FreeX.xcodeproj -scheme FreeX -sdk iphoneos CODE_SIGNING_ALLOWED=NO build`. The `web/` folder is copied into the app. |
| Check | `npm install --no-save acorn@8 && node tools/check-web.js`: syntax (ES2018), version and German texts. |
| CI | GitHub Actions (`.github/workflows/build.yml`) checks the interface and builds both apps on every push; a tag `v*` publishes a release with the APK and the unsigned IPA. A `Jenkinsfile` builds the APK on a Jenkins agent with the Android SDK. |

The interface can be developed in any browser: serve `web/` (e.g. `python3 -m http.server -d web 8088`), open it
with the phone view of the developer tools and connect to a server. It then plays with `<video>` and hls.js.

The version is kept in `web/version.json` (and `web/js/version.js`); both apps take it from there, the Android
version code and the iOS build number are derived from it.

## Project structure

| Path | |
|---|---|
| `web/` | The shared interface: `index.html`, `css/app.css`, `js/` (see above), the logo, the font Manrope, hls.js |
| `android/` | The Android app (Kotlin): `MainActivity` (WebView, system bars, picture in picture, back), `NativePlayer` (ExoPlayer, media session), `Bridge` (`FreeXNative`, capabilities, saved state) |
| `ios/` | The iOS app (Swift, UIKit): `WebViewController` (WKWebView, bridge, rotation, AirPlay), `NativePlayer` (AVPlayer, picture in picture, lock screen), `SchemeHandler` (serves `web/` as `freex://app`) |
| `tools/` | `check-web.js`, the check of the interface |

## License

FreeX Mobile is free software under the [GNU Lesser General Public License v3.0](LICENSE).

It bundles the font Manrope (SIL Open Font License) and [hls.js](https://github.com/video-dev/hls.js) (Apache 2.0);
their licenses are in `web/fonts/` and `web/vendor/`. The Android app uses AndroidX Media3 and WebKit (Apache 2.0).

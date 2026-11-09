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

/*
 * The app around the interface: the iOS app (WKWebView, AVPlayer), the Android app (WebView,
 * ExoPlayer) or, for development, a plain browser (<video> with hls.js).
 *
 * The native apps describe themselves once, before the page starts: Android through the method
 * FreeXNative.info(), iOS through window.FreeXHostInfo, set by a script at document start. Both
 * take commands as {cmd, …} objects (Android: FreeXNative.post(json), iOS: the message handler
 * "freex") and report back through window.FreeXHostEvent({type, …}).
 *
 * Every player backend has the same shape: open(url, {hls, startMs, title, subtitle, artwork}) →
 * Promise, play(), pause(), seek(ms), stop(), destroy(), setRate(r), position(), duration(),
 * paused(), and calls onEvent({type: "ready" | "time" | "state" | "buffering" | "ended" | "error"}).
 */
(function () {
    "use strict";

    const android = typeof window.FreeXNative === "object" && window.FreeXNative !== null;
    const ios = !android && !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.freex);

    let info = {};
    try {
        if (android) info = JSON.parse(window.FreeXNative.info()) || {};
        else if (ios) info = window.FreeXHostInfo || {};
    } catch (e) {
        info = {};
    }

    const platform = android ? "android" : ios ? "ios" : "html";
    const native = android || ios;

    function send(cmd, args) {
        const msg = Object.assign({cmd}, args || {});
        try {
            if (android) window.FreeXNative.post(JSON.stringify(msg));
            else if (ios) window.webkit.messageHandlers.freex.postMessage(msg);
        } catch (e) {
            // the app went away; nothing to do
        }
    }

    // ------------------------------------------------------------------ events from the app

    const listeners = {};

    function on(type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
        return () => {
            listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
        };
    }

    function emit(e) {
        (listeners[e.type] || []).slice().forEach((f) => {
            try {
                f(e);
            } catch (err) {
                setTimeout(() => {
                    throw err;
                }, 0);
            }
        });
        (listeners["*"] || []).slice().forEach((f) => f(e));
    }

    window.FreeXHostEvent = emit;

    // Insets of the system bars (Android draws edge to edge; iOS has env(safe-area-inset-*)).
    on("insets", (e) => {
        const s = document.documentElement.style;
        ["top", "right", "bottom", "left"].forEach((k) => {
            if (typeof e[k] === "number") s.setProperty("--inset-" + k, e[k] + "px");
        });
    });

    // ------------------------------------------------------------------ storage

    const STORE = "freex-mobile";

    /** What the app kept from the last start (server, token, user, device id). */
    function stored() {
        if (native && info.stored) {
            try {
                return typeof info.stored === "string" ? JSON.parse(info.stored) || {} : info.stored;
            } catch (e) {
                return {};
            }
        }
        try {
            return JSON.parse(localStorage.getItem(STORE) || "{}") || {};
        } catch (e) {
            return {};
        }
    }

    function save(data) {
        const json = JSON.stringify(data);
        if (native) send("save", {data: json});
        try {
            localStorage.setItem(STORE, json);
        } catch (e) {
            // private mode or full: the app keeps it
        }
    }

    // ------------------------------------------------------------------ capabilities

    /** What the browser engine reports, as the server's playback decision expects it. */
    function browserCaps() {
        const v = document.createElement("video");
        const can = (type) => v.canPlayType(type) !== "";
        const mseOk = !!(window.MediaSource && MediaSource.isTypeSupported);
        const mse = (type) => mseOk && MediaSource.isTypeSupported(type);
        const either = (type) => can(type) || mse(type);
        const video = ["h264"];
        if (either('video/mp4; codecs="hvc1.1.6.L120.90"') || either('video/mp4; codecs="hev1.1.6.L120.90"')) video.push("hevc");
        if (either('video/webm; codecs="vp9"') || either('video/mp4; codecs="vp09.00.10.08"')) video.push("vp9");
        if (either('video/mp4; codecs="av01.0.08M.08"')) video.push("av1");
        const audio = ["aac", "mp3"];
        if (either('audio/mp4; codecs="ac-3"')) audio.push("ac3");
        if (either('audio/mp4; codecs="ec-3"')) audio.push("eac3");
        if (either('audio/mp4; codecs="opus"') || either('audio/webm; codecs="opus"')) audio.push("opus");
        if (either('audio/mp4; codecs="flac"') || can("audio/flac")) audio.push("flac");
        const containers = ["mp4"];
        if (can("video/webm")) containers.push("webm");
        if (can("video/x-matroska") || /Chrome\//.test(navigator.userAgent)) containers.push("mkv");
        return {containers, video, audio, mseVideo: video.filter((c) => c !== "vp9"), mseAudio: audio};
    }

    function caps(directPlay) {
        const c = Object.assign({}, native && info.caps ? info.caps : browserCaps());
        c.directPlay = directPlay !== false;
        return c;
    }

    function deviceName() {
        if (info.deviceName) return info.deviceName;
        const ua = navigator.userAgent;
        if (/iPhone|iPad/.test(ua)) return "FreeX Mobile (Safari)";
        if (/Android/.test(ua)) return "FreeX Mobile (Android browser)";
        return "FreeX Mobile (Browser)";
    }

    // ------------------------------------------------------------------ players

    /** AVPlayer (iOS) or ExoPlayer (Android), drawing behind the transparent page. */
    function NativeBackend(onEvent) {
        let st = {position: 0, duration: 0, playing: false};
        let pending = null;
        let alive = true;
        const off = on("*", (e) => {
            if (!alive || ["ready", "time", "state", "buffering", "ended", "error"].indexOf(e.type) < 0) return;
            if (typeof e.position === "number") st.position = e.position;
            if (typeof e.duration === "number" && e.duration > 0) st.duration = e.duration;
            if (typeof e.playing === "boolean") st.playing = e.playing;
            if (e.type === "ready" && pending) {
                pending.resolve();
                pending = null;
                return;
            }
            if (e.type === "error" && pending) {
                pending.reject(new Error(e.message || "error"));
                pending = null;
                return;
            }
            onEvent(e);
        });
        return {
            name: android ? "exoplayer" : "avplayer",
            open(url, o) {
                st = {position: o.startMs || 0, duration: 0, playing: false};
                return new Promise((resolve, reject) => {
                    pending = {resolve, reject};
                    send("open", {
                        url, hls: !!o.hls, startMs: Math.round(o.startMs || 0),
                        title: o.title || "", subtitle: o.subtitle || "", artwork: o.artwork || "",
                    });
                });
            },
            play: () => send("play"),
            pause() {
                st.playing = false;
                send("pause");
            },
            seek(ms) {
                st.position = Math.max(0, ms);
                send("seek", {ms: Math.round(st.position)});
            },
            setRate: (r) => send("rate", {value: r}),
            stop: () => send("stop"),
            destroy() {
                alive = false;
                off();
                send("stop");
            },
            position: () => st.position,
            duration: () => st.duration,
            paused: () => !st.playing,
        };
    }

    let hlsLoading = null;

    /** hls.js is only needed in a browser; it is loaded on the first conversion. */
    function loadHls() {
        if (window.Hls || (document.createElement("video").canPlayType("application/vnd.apple.mpegurl") && !window.MediaSource)) {
            return Promise.resolve();
        }
        if (!hlsLoading) {
            hlsLoading = new Promise((resolve) => {
                const s = document.createElement("script");
                s.src = "vendor/hls.min.js";
                s.onload = resolve;
                s.onerror = resolve;
                document.head.appendChild(s);
            });
        }
        return hlsLoading;
    }

    /** <video> with hls.js, for development in a browser. */
    function HtmlBackend(onEvent) {
        const layer = document.getElementById("video-layer");
        const v = document.createElement("video");
        v.className = "html-video";
        v.crossOrigin = "anonymous";
        v.setAttribute("playsinline", "");
        v.setAttribute("webkit-playsinline", "");
        layer.appendChild(v);
        let hls = null;
        let ended = false;
        v.addEventListener("timeupdate", () => onEvent({type: "time"}));
        v.addEventListener("waiting", () => onEvent({type: "buffering", on: true}));
        v.addEventListener("playing", () => onEvent({type: "buffering", on: false}));
        v.addEventListener("pause", () => onEvent({type: "state"}));
        v.addEventListener("play", () => onEvent({type: "state"}));
        v.addEventListener("ended", () => {
            if (!ended) {
                ended = true;
                onEvent({type: "ended"});
            }
        });
        v.addEventListener("error", () => onEvent({type: "error", message: v.error ? "MEDIA_ERR " + v.error.code : "error"}));

        return {
            name: "html",
            open(url, o) {
                ended = false;
                return (o.hls ? loadHls() : Promise.resolve()).then(() => new Promise((resolve, reject) => {
                    const start = (o.startMs || 0) / 1000;
                    const done = () => {
                        v.removeEventListener("loadedmetadata", done);
                        if ((!o.hls || !hls) && start > 0) v.currentTime = start;
                        resolve();
                    };
                    v.addEventListener("loadedmetadata", done);
                    if (o.hls && window.Hls && window.Hls.isSupported()) {
                        hls = new window.Hls({startPosition: start, maxBufferLength: 60, fragLoadingTimeOut: 70000, manifestLoadingTimeOut: 35000});
                        let retries = 0;
                        hls.on(window.Hls.Events.ERROR, (e, d) => {
                            if (!d.fatal) return;
                            if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && retries++ < 2) return hls.recoverMediaError();
                            if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR && retries++ < 4) return setTimeout(() => hls && hls.startLoad(), 1000 * retries);
                            onEvent({type: "error", message: d.details || "hls"});
                            reject(new Error(d.details || "hls"));
                        });
                        hls.loadSource(url);
                        hls.attachMedia(v);
                    } else {
                        v.src = url;
                    }
                }));
            },
            play() {
                const p = v.play();
                if (p && p.catch) p.catch(() => null);
            },
            pause: () => v.pause(),
            seek(ms) {
                v.currentTime = Math.max(0, ms / 1000);
            },
            setRate(r) {
                v.playbackRate = r;
            },
            stop() {
                if (hls) {
                    hls.destroy();
                    hls = null;
                }
                v.removeAttribute("src");
                try {
                    v.load();
                } catch (e) {
                    // already gone
                }
            },
            destroy() {
                this.stop();
                v.remove();
            },
            position: () => v.currentTime * 1000,
            duration: () => (isFinite(v.duration) ? v.duration * 1000 : 0),
            paused: () => v.paused,
            /** Picture in picture of the browser, where it has one. */
            pip() {
                if (document.pictureInPictureElement) return document.exitPictureInPicture();
                if (v.requestPictureInPicture) return v.requestPictureInPicture().catch(() => null);
                if (v.webkitSetPresentationMode) v.webkitSetPresentationMode("picture-in-picture");
                return null;
            },
        };
    }

    function createBackend(onEvent) {
        return native ? NativeBackend(onEvent) : HtmlBackend(onEvent);
    }

    // ------------------------------------------------------------------ the app around the page

    const Host = {
        platform, native, android, ios,
        version: info.version || "",
        on, send, stored, save, caps, deviceName, createBackend,
        /** Picture in picture is there on iOS (iPhone with iOS 14+) and on Android 8+. */
        canPip: native ? info.pip !== false : !!(document.pictureInPictureEnabled || HTMLVideoElement.prototype.webkitSetPresentationMode),
        canAirPlay: ios,
        pip: () => send("pip"),
        airplay: () => send("airplay"),
        /** The player turns the phone sideways and hides the system bars. */
        videoMode(on) {
            send("video", {on: !!on});
        },
        exit() {
            if (android) send("exit");
        },
        /** Opens a web page in the system browser. */
        openUrl(url) {
            if (native) send("openUrl", {url});
            else window.open(url, "_blank", "noopener");
        },
        haptic(kind) {
            if (native) send("haptic", {kind: kind || "light"});
        },
    };

    window.FreeXHost = Host;
})();

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
 * The player: asks the server how to play a title, hands the URL to the app's player (AVPlayer,
 * ExoPlayer; see host.js) and draws the controls, subtitles, seek previews, Skip intro and Up next
 * over the picture. Reports the position to the server like FreeX Web does.
 *
 * Touch: a tap shows or hides the controls, a double tap on the left or right half jumps 10 s,
 * the seek bar can be dragged (with preview pictures).
 */
(function () {
    "use strict";

    const FX = window.FX;
    const UI = window.FreeXUI;
    const Host = window.FreeXHost;
    const h = FX.h;
    const t = FX.t;

    const PROGRESS_EVERY_MS = 10000;
    const OSD_HIDE_MS = 4000;
    const UP_NEXT_SECONDS = 10;
    const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

    let current = null;

    /**
     * Opens the player. `opts.startMs`: where to start (undefined = resume where the user stopped),
     * `opts.onClose`: called when the player is closed.
     */
    async function open(itemId, opts) {
        opts = opts || {};
        if (current) current.close(true);
        let item;
        try {
            item = await FX.api("GET", "/api/items/" + encodeURIComponent(itemId));
        } catch (e) {
            leaveVideoMode();
            FX.toast(e.message, true);
            return;
        }
        if (!item.media) {
            leaveVideoMode();
            FX.toast(t("This title cannot be played."), true);
            return;
        }
        const prefs = (FX.S.user && FX.S.user.preferences) || {};
        const tracks = FX.defaultTracks(item.media, prefs);
        const resume = item.progress && !item.progress.watched ? item.progress.offsetMs : 0;
        current = new Player(item, {
            startMs: opts.startMs === undefined ? resume : opts.startMs,
            audio: tracks.audio,
            subtitle: tracks.sub,
            onClose: opts.onClose,
        });
    }

    function Player(item, o) {
        const self = this;
        const S = FX.S;
        const prefs = (S.user && S.user.preferences) || {};
        const state = {
            audio: o.audio,
            subtitle: o.subtitle,
            quality: "auto",
            plan: null,
            directPlay: true,
            cues: [],
            scrubMs: null,
            lastReport: 0,
            closed: false,
            upNextCancelled: false,
            upNextTimer: 0,
            upNextShownFor: null,
            loading: true,
            rate: 1,
            pip: false,
        };

        // ---- DOM

        const subs = h("div", {class: "p-subs style-" + subtitleStyleClass(prefs.subtitleStyle)});
        const spinner = h("div", {class: "spinner big"});
        const title = h("div", {class: "p-title"});
        const subtitle = h("div", {class: "p-sub"});
        const fill = h("div", {class: "fill"});
        const knob = h("div", {class: "knob"});
        const marks = h("div", {class: "marks"});
        const bar = h("div", {class: "track"}, marks, fill, knob);
        const previewImg = h("div", {class: "pv-img"});
        const previewTime = h("div", {class: "pv-time"});
        const preview = h("div", {class: "preview", hidden: true}, previewImg, previewTime);
        const seek = h("div", {class: "seek"}, bar, preview);
        const cur = h("span", {class: "cur"});
        const remain = h("span", {class: "remain"});
        const btnPlay = h("button", {class: "p-big", "aria-label": t("Pause"), onclick: (e) => {
            e.stopPropagation();
            togglePause();
        }}, FX.icon("pause"));
        const btnBack = h("button", {class: "p-mid", "aria-label": t("Back 10 s"), onclick: (e) => {
            e.stopPropagation();
            jump(-10000);
        }}, FX.icon("back10"));
        const btnFwd = h("button", {class: "p-mid", "aria-label": t("Forward 10 s"), onclick: (e) => {
            e.stopPropagation();
            jump(10000);
        }}, FX.icon("fwd10"));
        const btnNext = tool("next", t("Next episode"), () => playNext(), true);
        const btnSpeed = tool("speed", t("Speed"), speedMenu, true);
        const btnTracks = tool("subtitles", t("Audio & subtitles"), tracksMenu, true);
        const btnQuality = tool("quality", t("Quality"), qualityMenu, true);
        const info = h("div", {class: "p-info"});
        const topRight = h("div", {class: "p-top-right"},
            Host.canAirPlay ? tool("airplay", "AirPlay", () => Host.airplay()) : null,
            Host.canPip ? tool("pip", t("Picture in picture"), pip) : null);
        const osd = h("div", {class: "osd"},
            h("div", {class: "osd-top"},
                tool("down", t("Close"), () => close()),
                h("div", {class: "p-titles"}, title, subtitle),
                topRight),
            h("div", {class: "osd-center"}, btnBack, btnPlay, btnFwd),
            h("div", {class: "osd-bottom"},
                h("div", {class: "seek-row"}, cur, seek, remain),
                h("div", {class: "p-tools"}, btnSpeed, btnTracks, btnQuality, h("span", {class: "spacer"}), info, btnNext)));
        const rippleL = h("div", {class: "ripple left"});
        const rippleR = h("div", {class: "ripple right"});
        const skipBtn = h("button", {class: "skip-btn", hidden: true, onclick: (e) => {
            e.stopPropagation();
            skip();
        }});
        const upNext = h("div", {class: "up-next", hidden: true});
        const notice = h("div", {class: "p-notice", hidden: true});
        const el = h("div", {class: "player"}, subs, rippleL, rippleR, osd, spinner, skipBtn, upNext, notice);
        document.getElementById("app").appendChild(el);
        document.documentElement.classList.add("video-mode");
        Host.videoMode(true);

        function tool(ic, label, fn, withLabel) {
            return h("button", {class: "p-tool", "aria-label": label, title: label, onclick: (e) => {
                e.stopPropagation();
                fn();
            }}, FX.icon(ic), withLabel ? h("span", null, label) : null);
        }

        // ---- the app's player

        const backend = Host.createBackend(onEvent);
        const tick = setInterval(update, 250);
        const removeOverlay = UI.addOverlay(() => close());
        const offPip = Host.on("pip", (e) => {
            state.pip = !!e.on;
            el.classList.toggle("pip", state.pip);
            if (state.pip) hideOsd(true);
        });
        const offApp = Host.on("app", (e) => {
            // back from the background (not from picture in picture): show where we are
            if (e.state === "foreground" && !state.pip) showOsd();
        });

        let osdTimer = 0;
        let osdVisible = false;

        function showOsd() {
            osd.classList.add("on");
            el.classList.add("osd-on");
            osdVisible = true;
            poke();
        }

        function hideOsd(force) {
            clearTimeout(osdTimer);
            if (force !== true && (backend.paused() || state.scrubMs !== null) && !state.loading) {
                osdTimer = setTimeout(hideOsd, OSD_HIDE_MS);
                return;
            }
            osd.classList.remove("on");
            el.classList.remove("osd-on");
            osdVisible = false;
            preview.hidden = true;
        }

        function poke() {
            clearTimeout(osdTimer);
            osdTimer = setTimeout(hideOsd, OSD_HIDE_MS);
        }

        // ---- touch: tap, double tap, dragging the seek bar

        let lastTap = {time: 0, side: ""};
        let tapTimer = 0;
        let jumpSum = 0;
        let jumpTimer = 0;

        el.addEventListener("click", (e) => {
            if (e.target.closest("button, .seek, .up-next, .p-notice, .sheet-layer")) return;
            const now = Date.now();
            const side = e.clientX < window.innerWidth * 0.4 ? "left" : e.clientX > window.innerWidth * 0.6 ? "right" : "mid";
            if (now - lastTap.time < 300 && side === lastTap.side && side !== "mid") {
                clearTimeout(tapTimer);
                doubleTap(side);
                lastTap = {time: now, side};
                return;
            }
            lastTap = {time: now, side};
            clearTimeout(tapTimer);
            if (jumpSum && side !== "mid") {
                // more taps during a jump add to it
                doubleTap(side);
                return;
            }
            tapTimer = setTimeout(() => {
                if (osdVisible) hideOsd(true);
                else showOsd();
            }, side === "mid" ? 0 : 260);
        });

        function doubleTap(side) {
            if (state.loading) return;
            const dir = side === "right" ? 1 : -1;
            if (jumpSum && Math.sign(jumpSum) !== dir) jumpSum = 0;
            jumpSum += dir * 10000;
            jump(dir * 10000);
            const r = side === "right" ? rippleR : rippleL;
            (side === "right" ? rippleL : rippleR).classList.remove("on");
            r.textContent = (jumpSum > 0 ? "+" : "−") + Math.abs(jumpSum / 1000) + " s";
            r.classList.remove("on");
            void r.offsetWidth;
            r.classList.add("on");
            Host.haptic("light");
            clearTimeout(jumpTimer);
            jumpTimer = setTimeout(() => {
                jumpSum = 0;
                r.classList.remove("on");
            }, 800);
        }

        function scrubAt(clientX) {
            const r = bar.getBoundingClientRect();
            const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
            const dur = durationMs();
            state.scrubMs = Math.max(0, Math.min(dur - 2000, f * dur));
            showPreview(state.scrubMs);
            update();
        }

        let dragging = false;
        seek.addEventListener("touchstart", (e) => {
            if (state.loading || !durationMs()) return;
            dragging = true;
            seek.classList.add("drag");
            scrubAt(e.touches[0].clientX);
            clearTimeout(osdTimer);
        }, {passive: true});
        seek.addEventListener("touchmove", (e) => {
            if (!dragging) return;
            e.preventDefault();
            scrubAt(e.touches[0].clientX);
        }, {passive: false});
        seek.addEventListener("touchend", () => {
            if (!dragging) return;
            dragging = false;
            seek.classList.remove("drag");
            commitScrub();
            poke();
        });
        // mouse, for development in a browser
        seek.addEventListener("mousedown", (e) => {
            if (state.loading || !durationMs()) return;
            dragging = true;
            scrubAt(e.clientX);
            const move = (ev) => scrubAt(ev.clientX);
            const up = () => {
                dragging = false;
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", up);
                commitScrub();
                poke();
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
        });

        // keys in a browser
        function onKey(e) {
            if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
            if (e.key === " ") {
                e.preventDefault();
                togglePause();
            } else if (e.key === "ArrowLeft") jump(-10000);
            else if (e.key === "ArrowRight") jump(10000);
        }

        document.addEventListener("keydown", onKey);

        // ---- loading

        async function start(atMs) {
            state.loading = true;
            spinner.hidden = false;
            notice.hidden = true;
            el.classList.add("loading");
            const old = state.plan;
            let plan;
            try {
                plan = await FX.api("POST", "/api/items/" + encodeURIComponent(item.id) + "/playback", {
                    caps: Host.caps(state.directPlay),
                    quality: state.quality,
                    audio: state.audio,
                    subtitle: state.subtitle || undefined,
                    startMs: Math.max(0, Math.round(atMs || 0)),
                    client: S.clientId,
                    device: Host.deviceName(),
                    // URLs with their own token: native players (and <video> across origins) cannot send the header
                    tokenUrls: true,
                }, {timeout: 60000});
            } catch (e) {
                return fail(e.message);
            }
            if (state.closed) {
                if (plan.session) stopSession(plan.session);
                return;
            }
            if (old && old.session && old.session !== plan.session) stopSession(old.session);
            state.plan = plan;
            if (typeof plan.audio === "number") state.audio = plan.audio;
            info.textContent = modeLabel(plan);
            try {
                backend.stop();
                await backend.open(S.server + plan.url, {
                    hls: !!plan.session,
                    startMs: plan.startMs || 0,
                    title: title.textContent,
                    subtitle: subtitle.textContent,
                    artwork: artworkUrl(plan.url),
                });
            } catch (e) {
                if (state.closed) return;
                return recover(e && e.message);
            }
            if (state.closed) return;
            state.loading = false;
            spinner.hidden = true;
            el.classList.remove("loading");
            if (state.rate !== 1 && backend.setRate) backend.setRate(state.rate);
            backend.play();
            report("playing", true);
            loadSubtitles();
            renderMarks();
            showOsd();
        }

        /** The native players load the picture for the lock screen with the stream's token. */
        function artworkUrl(url) {
            const m = /^\/api\/cast\/([^/]+)\//.exec(url || "");
            return m ? S.server + "/api/cast/" + m[1] + "/image/" + (item.type === "episode" ? "thumb" : "poster") : "";
        }

        /** A failed start: once more without direct play (the server converts then). */
        function recover(message) {
            const plan = state.plan;
            if (plan && plan.mode === "direct" && state.directPlay) {
                state.directPlay = false;
                return start(backend.position() || (plan && plan.startMs) || 0);
            }
            fail(t("The title cannot be played on this device.") + (message ? " (" + message + ")" : ""));
        }

        function fail(message) {
            state.loading = false;
            spinner.hidden = true;
            el.classList.remove("loading");
            notice.hidden = false;
            hideOsd(true);
            FX.clear(notice).appendChild(h("div", {class: "box"},
                h("p", null, message),
                h("div", {class: "dialog-buttons"},
                    h("button", {class: "btn primary", onclick: () => start(backend.position() || 0)}, t("Try again")),
                    h("button", {class: "btn", onclick: () => close()}, t("Close")))));
        }

        function modeLabel(plan) {
            const mode = {direct: t("Direct play"), remux: t("Direct stream"), audio: t("Audio converted"), transcode: t("Converted")}[plan.mode] || plan.mode;
            return mode;
        }

        function stopSession(id) {
            FX.api("DELETE", "/api/transcode/" + encodeURIComponent(id)).catch(() => null);
        }

        // ---- events of the player

        function onEvent(e) {
            if (state.closed) return;
            if (e.type === "buffering") {
                spinner.hidden = !e.on;
            } else if (e.type === "state") {
                update();
                report(backend.paused() ? "paused" : "playing", true);
            } else if (e.type === "ended") {
                ended();
            } else if (e.type === "error" && !state.loading) {
                recover(e.message);
            }
        }

        function position() {
            return state.scrubMs !== null ? state.scrubMs : backend.position();
        }

        function durationMs() {
            return backend.duration() || (state.plan && state.plan.durationMs) || item.media.durationMs || 0;
        }

        function update() {
            if (state.closed) return;
            const pos = backend.position();
            const dur = durationMs();
            const shown = position();
            const pct = dur ? Math.min(100, shown / dur * 100) : 0;
            fill.style.width = pct + "%";
            knob.style.left = pct + "%";
            cur.textContent = FX.clock(shown);
            remain.textContent = "−" + FX.clock(Math.max(0, dur - shown));
            const paused = backend.paused();
            const ic = paused ? "play" : "pause";
            if (btnPlay.dataset.icon !== ic) {
                btnPlay.dataset.icon = ic;
                btnPlay.replaceChild(FX.icon(ic), btnPlay.firstChild);
                btnPlay.setAttribute("aria-label", paused ? t("Play") : t("Pause"));
            }
            renderCue(pos);
            markers(pos, dur);
            if (!state.loading && !paused && Date.now() - state.lastReport > PROGRESS_EVERY_MS) report("playing");
        }

        // ---- seeking

        function commitScrub() {
            if (state.scrubMs === null) return;
            const to = state.scrubMs;
            state.scrubMs = null;
            preview.hidden = true;
            backend.seek(to);
            report(backend.paused() ? "paused" : "playing", true);
            update();
        }

        function jump(delta) {
            if (state.loading) return;
            backend.seek(Math.max(0, Math.min(durationMs() - 2000, backend.position() + delta)));
            update();
            if (osdVisible) poke();
        }

        function togglePause() {
            if (state.loading) return;
            if (backend.paused()) {
                backend.play();
                report("playing", true);
            } else {
                backend.pause();
                report("paused", true);
            }
            update();
            poke();
        }

        // Seek previews: one sprite sheet per title, frames in a grid.
        let sprite = null;

        function showPreview(ms) {
            const pv = item.previews;
            const dur = durationMs();
            preview.hidden = false;
            previewTime.textContent = FX.clock(ms);
            const r = bar.getBoundingClientRect();
            const x = dur ? ms / dur * r.width : 0;
            const w = pv && pv.count ? 176 : 70;
            preview.style.left = Math.max(w / 2 - 8, Math.min(r.width - w / 2 + 8, x)) + "px";
            if (!pv || !pv.count) {
                previewImg.hidden = true;
                return;
            }
            previewImg.hidden = false;
            const scale = 176 / pv.width;
            const n = Math.min(pv.count - 1, Math.floor(ms / pv.intervalMs));
            previewImg.style.width = Math.round(pv.width * scale) + "px";
            previewImg.style.height = Math.round(pv.height * scale) + "px";
            previewImg.style.backgroundSize = (pv.columns * pv.width * scale) + "px " + (pv.rows * pv.height * scale) + "px";
            previewImg.style.backgroundPosition = -(n % pv.columns) * pv.width * scale + "px " + -Math.floor(n / pv.columns) * pv.height * scale + "px";
            if (!sprite) {
                sprite = FX.imageUrl("/api/items/" + encodeURIComponent(item.id) + "/previews?v=" + encodeURIComponent(pv.version || ""));
                sprite.then((u) => {
                    if (u) previewImg.style.backgroundImage = "url(\"" + u + "\")";
                });
            }
        }

        // ---- intro, credits, next episode

        function renderMarks() {
            FX.clear(marks);
            const dur = durationMs();
            const chapters = (item.media && item.media.chapters) || [];
            if (!dur) return;
            chapters.forEach((c) => {
                if (c.startMs > 0) marks.appendChild(h("i", {style: {left: c.startMs / dur * 100 + "%"}}));
            });
        }

        function nextItem() {
            return item.next || null;
        }

        function markers(pos, dur) {
            const mk = item.markers || {};
            let kind = null;
            if (mk.intro && pos >= mk.intro.startMs && pos < mk.intro.endMs - 1500) kind = "intro";
            else if (mk.credits && pos >= mk.credits.startMs && pos < mk.credits.endMs - 1500) kind = nextItem() ? "next" : "credits";
            if (!kind && !mk.credits && nextItem() && dur > 0 && dur - pos < 30000 && dur - pos > 1000) kind = "next";
            if (kind === "next" && !state.upNextCancelled && !state.loading && upNext.hidden && state.upNextShownFor !== item.id && !state.pip) {
                showUpNext();
            }
            if (kind === "next" && !upNext.hidden) kind = null; // the card has the button
            if (!kind) {
                skipBtn.hidden = true;
                return;
            }
            const label = {intro: t("Skip intro"), credits: t("Skip credits"), next: t("Next episode")}[kind];
            if (skipBtn.dataset.kind !== kind || skipBtn.hidden) {
                skipBtn.dataset.kind = kind;
                FX.clear(skipBtn).appendChild(h("span", null, label));
                skipBtn.appendChild(FX.icon("skip"));
                skipBtn.hidden = false;
            }
        }

        function skip() {
            const mk = item.markers || {};
            const kind = skipBtn.dataset.kind;
            if (kind === "intro" && mk.intro) backend.seek(mk.intro.endMs);
            else if (kind === "credits" && mk.credits) backend.seek(Math.max(0, mk.credits.endMs - 500));
            else if (kind === "next") return playNext();
            skipBtn.hidden = true;
            Host.haptic("light");
            report("playing", true);
        }

        function showUpNext() {
            const next = nextItem();
            if (!next) return;
            state.upNextShownFor = item.id;
            let left = UP_NEXT_SECONDS;
            const art = h("div", {class: "art"});
            FX.setArt(art, FX.artPath(next, "thumb"), "");
            const count = h("div", {class: "count"});
            const ring = h("i");
            const play = h("button", {class: "btn primary", onclick: playNext}, FX.icon("play"), h("span", null, t("Play now")));
            const cancel = h("button", {class: "btn", onclick: cancelUpNext}, t("Cancel"));
            FX.clear(upNext).appendChild(h("div", {class: "card"},
                h("div", {class: "un-art", onclick: playNext}, art, h("div", {class: "un-bar"}, ring)),
                h("div", {class: "txt"},
                    count,
                    h("div", {class: "t"}, FX.episodeCode(next) + " · " + next.title),
                    h("div", {class: "dialog-buttons"}, play, cancel))));
            upNext.hidden = false;
            hideOsd(true);
            ring.style.transitionDuration = UP_NEXT_SECONDS + "s";
            setTimeout(() => ring.style.width = "100%", 30);
            const tickCount = () => {
                count.textContent = t("Up next in {0} s", left);
                if (left-- <= 0) return playNext();
                state.upNextTimer = setTimeout(tickCount, 1000);
            };
            tickCount();
        }

        function cancelUpNext() {
            state.upNextCancelled = true;
            clearTimeout(state.upNextTimer);
            upNext.hidden = true;
        }

        function ended() {
            const dur = durationMs();
            report("playing", true, dur);
            if (nextItem() && !state.upNextCancelled) return playNext();
            close(true);
        }

        function playNext() {
            const next = nextItem();
            if (!next) return;
            clearTimeout(state.upNextTimer);
            const onClose = o.onClose;
            o.onClose = null;
            close(true, () => open(next.id, {startMs: next.progress && !next.progress.watched ? next.progress.offsetMs : 0, onClose}), true);
        }

        // ---- progress

        function report(st, now, offset) {
            if (!state.plan || (item.type === "extra" && !now)) return;
            state.lastReport = Date.now();
            const pos = offset !== undefined ? offset : backend.position();
            return FX.api("PUT", "/api/items/" + encodeURIComponent(item.id) + "/progress", {
                offsetMs: Math.round(pos), durationMs: Math.round(durationMs()), state: st, client: S.clientId, device: Host.deviceName(),
            }).catch(() => null);
        }

        // ---- subtitles

        function subtitleTrack(id) {
            return (item.media.subtitles || []).filter((s) => s.id === id)[0] || null;
        }

        async function loadSubtitles() {
            state.cues = [];
            shownCue = null;
            FX.clear(subs);
            const id = state.subtitle;
            const plan = state.plan;
            if (!id || !plan || plan.burnedSubtitle === id) return;
            const track = subtitleTrack(id);
            if (!track || !track.textBased) return;
            try {
                const vtt = await FX.text("/api/items/" + encodeURIComponent(item.id) + "/subtitles/" + encodeURIComponent(id) + ".vtt");
                if (state.subtitle === id) state.cues = parseVtt(vtt);
            } catch (e) {
                FX.toast(t("The subtitles could not be loaded."), true);
            }
        }

        let shownCue = null;

        function renderCue(pos) {
            const cues = state.cues;
            let cue = null;
            for (let i = 0; i < cues.length; i++) {
                if (cues[i].start <= pos && pos < cues[i].end) {
                    cue = cues[i];
                    break;
                }
                if (cues[i].start > pos) break;
            }
            if (cue === shownCue) return;
            shownCue = cue;
            FX.clear(subs);
            if (cue) cue.lines.forEach((l) => subs.appendChild(h("span", null, l)));
        }

        // ---- menus

        function tracksMenu() {
            const audios = item.media.audio || [];
            const subtitles = item.media.subtitles || [];
            let s = null;
            const pick = (fn) => (e) => {
                e.stopPropagation();
                s.close();
                fn();
            };
            const audioList = audios.map((a) => h("button", {class: "option" + (a.index === state.audio ? " on" : ""), onclick: pick(() => {
                if (a.index === state.audio) return;
                state.audio = a.index;
                start(backend.position());
            })}, h("span", {class: "mark"}, a.index === state.audio ? FX.icon("check") : null), h("span", {class: "label"}, h("span", null, FX.audioLabel(a)))));
            const subOptions = [{id: null, label: t("Off")}].concat(subtitles.map((x) => ({
                id: x.id, label: FX.subtitleLabel(x), sub: x.textBased ? "" : t("burned in"),
            })));
            const subList = subOptions.map((x) => h("button", {class: "option" + ((x.id || null) === (state.subtitle || null) ? " on" : ""),
                onclick: pick(() => chooseSubtitle(x.id))},
            h("span", {class: "mark"}, (x.id || null) === (state.subtitle || null) ? FX.icon("check") : null),
            h("span", {class: "label"}, h("span", null, x.label), x.sub ? h("small", null, x.sub) : null)));
            const content = h("div", {class: "sheet-scroll tracks"},
                h("div", {class: "track-col"}, h("h4", null, t("Audio")), audioList.length ? audioList : h("p", {class: "muted"}, t("Unknown"))),
                h("div", {class: "track-col"}, h("h4", null, t("Subtitles")), subList));
            clearTimeout(osdTimer);
            s = UI.sheet(content, {title: t("Audio & subtitles"), cls: "wide", onClose: poke});
        }

        function chooseSubtitle(v) {
            if ((v || null) === (state.subtitle || null)) return;
            const before = subtitleTrack(state.subtitle);
            const after = subtitleTrack(v);
            state.subtitle = v;
            // Picture subtitles are burned in by the server: that needs a new stream.
            const restream = (after && !after.textBased) || (before && !before.textBased) || (state.plan && state.plan.burnedSubtitle);
            if (restream) start(backend.position());
            else loadSubtitles();
        }

        function qualityMenu() {
            const qs = (state.plan && state.plan.qualities) || [];
            const list = [{label: t("Automatic"), value: "auto", on: state.quality === "auto",
                sub: state.plan && state.plan.automatic && state.quality === "auto" ? currentQualityLabel() : ""}].concat(qs.map((q) => ({
                label: q.id === "original" ? t("Original") : q.label, value: q.id, on: state.quality === q.id,
            })));
            clearTimeout(osdTimer);
            UI.select(t("Quality"), list).then((v) => {
                poke();
                if (v === undefined || v === state.quality) return;
                state.quality = v;
                start(backend.position());
            });
        }

        function currentQualityLabel() {
            const plan = state.plan;
            const q = (plan.qualities || []).filter((x) => x.id === plan.quality)[0];
            return q ? (q.id === "original" ? t("Original") : q.label) : "";
        }

        function speedMenu() {
            clearTimeout(osdTimer);
            UI.select(t("Speed"), SPEEDS.map((r) => ({label: r === 1 ? t("Normal") : String(r).replace(".", FreeXI18n.lang() === "de" ? "," : ".") + "×",
                value: r, on: r === state.rate}))).then((v) => {
                poke();
                if (v === undefined || v === state.rate) return;
                state.rate = v;
                if (backend.setRate) backend.setRate(v);
                btnSpeed.classList.toggle("active", v !== 1);
            });
        }

        function pip() {
            if (Host.native) Host.pip();
            else if (backend.pip) backend.pip();
        }

        // ---- closing

        function onVisibility() {
            // The apps pause themselves when they go to the background (unless picture in picture).
            if (Host.native) return;
            if (document.hidden && !backend.paused()) {
                backend.pause();
                report("paused", true);
            }
        }

        document.addEventListener("visibilitychange", onVisibility);

        function close(silent, then, keepVideoMode) {
            if (state.closed) return;
            const pos = backend.position();
            if (state.plan) {
                FX.api("PUT", "/api/items/" + encodeURIComponent(item.id) + "/progress", {
                    offsetMs: Math.round(pos), durationMs: Math.round(durationMs()), state: "stopped", stopped: true, client: S.clientId,
                    device: Host.deviceName(),
                }).catch(() => null);
                if (state.plan.session) stopSession(state.plan.session);
            }
            state.closed = true;
            if (current === self) current = null;
            clearInterval(tick);
            clearTimeout(osdTimer);
            clearTimeout(tapTimer);
            clearTimeout(state.upNextTimer);
            document.removeEventListener("visibilitychange", onVisibility);
            document.removeEventListener("keydown", onKey);
            offPip();
            offApp();
            removeOverlay();
            backend.destroy();
            el.remove();
            if (!keepVideoMode) {
                document.documentElement.classList.remove("video-mode");
                Host.videoMode(false);
            }
            if (then) then();
            else if (o.onClose) o.onClose();
        }

        self.close = close;
        title.textContent = item.type === "episode" ? item.showTitle || item.title : item.title;
        subtitle.textContent = item.type === "episode" ? FX.episodeCode(item) + " · " + item.title : (item.year || "");
        btnNext.hidden = !nextItem();
        btnTracks.hidden = !((item.media.audio || []).length > 1 || (item.media.subtitles || []).length);
        start(o.startMs);
    }

    /** After *Next episode* the video mode stays on until the next title opens; not if it fails. */
    function leaveVideoMode() {
        if (current || !document.documentElement.classList.contains("video-mode")) return;
        document.documentElement.classList.remove("video-mode");
        Host.videoMode(false);
    }

    function subtitleStyleClass(st) {
        st = st || {};
        return [st.size || "m", st.background || "box", st.position || "bottom", st.color || "white"].join(" style-");
    }

    // ---- WebVTT

    function parseTime(s) {
        const p = s.trim().replace(",", ".").split(":").map(Number);
        return p.length === 3 ? (p[0] * 3600 + p[1] * 60 + p[2]) * 1000 : (p[0] * 60 + p[1]) * 1000;
    }

    function parseVtt(text) {
        const cues = [];
        text.replace(/\r/g, "").split(/\n\n+/).forEach((block) => {
            const lines = block.split("\n");
            let i = -1;
            for (let k = 0; k < lines.length; k++) {
                if (lines[k].indexOf("-->") >= 0) {
                    i = k;
                    break;
                }
            }
            if (i < 0) return;
            const parts = lines[i].split("-->");
            const start = parseTime(parts[0]);
            const end = parseTime(parts[1].trim().split(/\s+/)[0]);
            const body = lines.slice(i + 1).map((l) => l.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")).filter((l) => l.trim());
            if (body.length && isFinite(start) && isFinite(end)) cues.push({start, end, lines: body});
        });
        cues.sort((a, b) => a.start - b.start);
        return cues;
    }

    window.FreeXPlayer = {open, parseVtt, get playing() {
        return !!current;
    }};
})();

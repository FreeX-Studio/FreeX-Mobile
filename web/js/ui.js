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
 * Building blocks of the interface: the stack of screens with its slide animations and the swipe
 * back from the left edge, bottom sheets, dialogs, and the cards and rows the screens are made of.
 *
 * A screen is {el, refresh, destroy, onBack}; the stack keeps the screens below in the page, so
 * they come back with their scroll position.
 */
(function () {
    "use strict";

    const FX = window.FX;
    const Host = window.FreeXHost;
    const h = FX.h;
    const t = FX.t;

    const root = () => document.getElementById("stack");
    const stack = [];
    const overlays = [];

    const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const SLIDE_MS = reduceMotion ? 0 : 320;

    // ------------------------------------------------------------------ stack

    function top() {
        return stack[stack.length - 1] || null;
    }

    function push(screen, opts) {
        opts = opts || {};
        const below = top();
        stack.push(screen);
        screen.el.classList.add("screen");
        root().appendChild(screen.el);
        if (below && !opts.instant && SLIDE_MS) {
            screen.el.classList.add("enter");
            below.el.classList.add("covering");
            void screen.el.offsetWidth;
            screen.el.classList.remove("enter");
            setTimeout(() => {
                if (top() === screen) {
                    below.el.classList.remove("covering");
                    below.el.classList.add("covered");
                }
            }, SLIDE_MS);
        } else if (below) {
            below.el.classList.add("covered");
        }
        if (screen.onShow) screen.onShow();
    }

    function pop(opts) {
        opts = opts || {};
        if (stack.length < 2) return false;
        const s = stack.pop();
        const below = top();
        below.el.classList.remove("covered");
        const done = () => {
            if (s.destroy) s.destroy();
            s.el.remove();
        };
        if (!opts.instant && SLIDE_MS) {
            below.el.classList.add("covering");
            void below.el.offsetWidth;
            below.el.classList.remove("covering");
            s.el.classList.add("leave");
            setTimeout(done, SLIDE_MS);
        } else {
            done();
        }
        if (below.refresh && !opts.noRefresh) below.refresh();
        return true;
    }

    function reset(screen) {
        while (stack.length) {
            const s = stack.pop();
            if (s.destroy) s.destroy();
            s.el.remove();
        }
        closeOverlays();
        push(screen, {instant: true});
    }

    /** The screen on top gets newer data (after the player). */
    function refreshTop() {
        const s = top();
        if (s && s.refresh) s.refresh();
    }

    /**
     * Back (Android back button, Escape in a browser): closes the top sheet, then the screen's own
     * handling, then the top screen. On the first screen the app goes to the background.
     */
    function back() {
        if (overlays.length) {
            overlays[overlays.length - 1].close();
            return;
        }
        const s = top();
        if (s && s.onBack && s.onBack()) return;
        if (!pop()) Host.exit();
    }

    // Swipe from the left edge back to the screen below (as in iOS apps).
    (function edgeSwipe() {
        let start = null;
        let moved = false;
        document.addEventListener("touchstart", (e) => {
            if (stack.length < 2 || overlays.length || document.documentElement.classList.contains("video-mode")) return;
            const tch = e.touches[0];
            if (e.touches.length !== 1 || tch.clientX > 24) return;
            start = {x: tch.clientX, y: tch.clientY, time: Date.now(), screen: top(), below: stack[stack.length - 2]};
            moved = false;
        }, {passive: true});
        document.addEventListener("touchmove", (e) => {
            if (!start) return;
            const tch = e.touches[0];
            const dx = tch.clientX - start.x;
            const dy = tch.clientY - start.y;
            if (!moved) {
                if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
                    start = null;
                    return;
                }
                if (dx < 8) return;
                moved = true;
                start.screen.el.classList.add("dragging");
                start.below.el.classList.remove("covered");
                start.below.el.classList.add("dragging", "covering");
            }
            const w = window.innerWidth;
            const x = Math.max(0, Math.min(w, dx));
            start.screen.el.style.transform = "translate3d(" + x + "px,0,0)";
            start.below.el.style.transform = "translate3d(" + (-0.28 * (w - x)) + "px,0,0)";
            start.below.el.style.setProperty("--dim", String(0.35 * (1 - x / w)));
        }, {passive: true});
        document.addEventListener("touchend", (e) => {
            if (!start) return;
            const s = start;
            start = null;
            if (!moved) return;
            const dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : 0) - s.x;
            const speed = dx / Math.max(1, Date.now() - s.time);
            const go = dx > window.innerWidth * 0.35 || speed > 0.5;
            [s.screen.el, s.below.el].forEach((el) => {
                el.classList.remove("dragging");
                el.style.transform = "";
                el.style.removeProperty("--dim");
            });
            if (go && top() === s.screen) {
                pop();
            } else {
                s.below.el.classList.remove("covering");
                s.below.el.classList.add("covered");
            }
        });
    })();

    // ------------------------------------------------------------------ overlays

    function addOverlay(close) {
        const o = {close};
        overlays.push(o);
        return () => {
            const i = overlays.indexOf(o);
            if (i >= 0) overlays.splice(i, 1);
        };
    }

    function closeOverlays() {
        while (overlays.length) overlays[overlays.length - 1].close();
    }

    /** A sheet from the bottom with any content. Returns {el, close}. */
    function sheet(content, opts) {
        opts = opts || {};
        const box = h("div", {class: "sheet" + (opts.cls ? " " + opts.cls : "")},
            h("div", {class: "grabber"}), opts.title ? h("div", {class: "sheet-title"}, opts.title) : null, content);
        const layer = h("div", {class: "sheet-layer"}, h("div", {class: "scrim", onclick: () => close()}), box);
        document.getElementById("overlays").appendChild(layer);
        void layer.offsetWidth;
        layer.classList.add("on");
        let closed = false;
        const remove = addOverlay(() => close());

        // pull down to close
        let startY = null;
        box.addEventListener("touchstart", (e) => {
            const scroller = e.target.closest(".sheet-scroll");
            if (scroller && scroller.scrollTop > 0) return;
            startY = e.touches[0].clientY;
        }, {passive: true});
        box.addEventListener("touchmove", (e) => {
            if (startY === null) return;
            const dy = e.touches[0].clientY - startY;
            if (dy > 0) {
                box.style.transition = "none";
                box.style.transform = "translate3d(0," + dy + "px,0)";
            }
        }, {passive: true});
        box.addEventListener("touchend", (e) => {
            if (startY === null) return;
            const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : startY) - startY;
            startY = null;
            box.style.transition = "";
            box.style.transform = "";
            if (dy > 90) close();
        });

        function close(value) {
            if (closed) return;
            closed = true;
            remove();
            layer.classList.remove("on");
            setTimeout(() => layer.remove(), 260);
            if (opts.onClose) opts.onClose(value);
        }

        return {el: box, close};
    }

    /** Choose one of several entries [{label, sub, value, on}]; resolves with the value or undefined. */
    function select(title, entries) {
        return new Promise((resolve) => {
            let s = null;
            const list = h("div", {class: "sheet-scroll"}, entries.map((e) => h("button", {
                class: "option" + (e.on ? " on" : ""),
                onclick: () => s.close({value: e.value}),
            }, h("span", {class: "mark"}, e.on ? FX.icon("check") : null),
            h("span", {class: "label"}, h("span", null, e.label), e.sub ? h("small", null, e.sub) : null))));
            s = sheet(list, {title, onClose: (v) => resolve(v ? v.value : undefined)});
            const on = list.querySelector(".on");
            if (on) setTimeout(() => on.scrollIntoView({block: "center"}), 0);
        });
    }

    /** A list of actions [{label, icon, danger, fn}]. */
    function actions(title, entries) {
        let s = null;
        const list = h("div", {class: "sheet-scroll"}, entries.filter(Boolean).map((e) => h("button", {
            class: "option action" + (e.danger ? " danger" : ""),
            onclick: () => {
                s.close();
                e.fn();
            },
        }, e.icon ? FX.icon(e.icon) : null, h("span", {class: "label"}, h("span", null, e.label)))));
        s = sheet(list, {title});
    }

    /** A question with buttons; resolves with the index of the button or -1. */
    function dialog(text, buttons, opts) {
        opts = opts || {};
        return new Promise((resolve) => {
            const bs = buttons.map((b, i) => h("button", {
                class: "btn" + (i === 0 ? (opts.danger ? " danger" : " primary") : ""), onclick: () => done(i),
            }, b));
            const box = h("div", {class: "dialog"}, h("div", {class: "box"},
                opts.title ? h("h3", null, opts.title) : null,
                h("p", null, text), h("div", {class: "dialog-buttons"}, bs)));
            document.getElementById("overlays").appendChild(box);
            void box.offsetWidth;
            box.classList.add("on");
            const remove = addOverlay(() => done(-1));

            function done(i) {
                remove();
                box.classList.remove("on");
                setTimeout(() => box.remove(), 200);
                resolve(i);
            }
        });
    }

    function confirm(text, ok, opts) {
        return dialog(text, [ok, t("Cancel")], opts).then((i) => i === 0);
    }

    // ------------------------------------------------------------------ building blocks

    function logo(cls) {
        return h("img", {class: "logo " + (cls || ""), src: "img/logo.svg", alt: "FreeX"});
    }

    function button(label, onclick, opts) {
        opts = opts || {};
        return h("button", {class: "btn" + (opts.primary ? " primary" : "") + (opts.cls ? " " + opts.cls : ""), onclick, type: "button"},
            opts.icon ? FX.icon(opts.icon) : null, label ? h("span", null, label) : null);
    }

    function iconButton(name, label, onclick, cls) {
        return h("button", {class: "icon-btn" + (cls ? " " + cls : ""), "aria-label": label, title: label, type: "button", onclick}, FX.icon(name));
    }

    function field(label, attrs) {
        const input = h("input", Object.assign({spellcheck: "false", autocomplete: "off", autocapitalize: "off", autocorrect: "off"}, attrs));
        return {input, el: h("label", {class: "field"}, h("span", null, label), input)};
    }

    function loading() {
        return h("div", {class: "loading"}, h("div", {class: "spinner"}));
    }

    function empty(text, ic) {
        return h("div", {class: "empty"}, ic ? FX.icon(ic) : null, h("p", null, text));
    }

    function errorBox(e, retry) {
        return h("div", {class: "empty"}, FX.icon("info"), h("p", null, e.message || String(e)),
            retry ? button(t("Try again"), retry, {primary: true}) : null);
    }

    function episodes(n) {
        return n === 1 ? t("1 episode") : t("{0} episodes", n);
    }

    /** Subtitle line of a card: year, number of episodes, episode code. */
    function caption(it) {
        if (it.type === "episode") return FX.episodeCode(it);
        if (it.type === "show") return it.leafCount ? episodes(it.leafCount) : it.year || "";
        if (it.type === "season") return it.leafCount ? episodes(it.leafCount) : "";
        if (it.type === "collection") return it.childCount === 1 ? t("1 title") : t("{0} titles", it.childCount || 0);
        return it.year || "";
    }

    /** A card: "poster" (2:3) or "land" (16:9 with the episode picture). */
    function card(it, style, onclick) {
        const land = style === "land";
        const art = h("div", {class: "art"});
        let kind = "poster";
        if (land) kind = it.type === "episode" || it.type === "extra" ? "thumb" : "backdrop";
        FX.lazyArt(art, FX.artPath(it, kind), (land && it.type === "episode" ? it.showTitle || it.title : it.title) || "");
        const p = FX.progressOf(it);
        const unwatched = (it.type === "show" || it.type === "season") && it.leafCount ? it.leafCount - (it.viewedLeafCount || 0) : 0;
        const title = land && it.type === "episode" ? it.showTitle || it.title : it.title;
        const sub = land && it.type === "episode" ? FX.episodeCode(it) + " · " + it.title : caption(it);
        const c = h("button", {class: "card " + (land ? "land" : "poster"), type: "button", onclick: onclick || (() => openItem(it))},
            h("div", {class: "frame"}, art,
                unwatched > 0 ? h("span", {class: "badge"}, String(unwatched)) : null,
                FX.isWatched(it) && it.type !== "collection" ? h("span", {class: "badge done"}, FX.icon("check")) : null,
                p > 0 ? h("div", {class: "prog"}, h("i", {style: {width: (p * 100).toFixed(1) + "%"}})) : null),
            h("div", {class: "cap"}, h("div", {class: "t"}, title || ""), h("div", {class: "s"}, String(sub || ""))));
        c._item = it;
        return c;
    }

    function row(title, items, style, opts) {
        opts = opts || {};
        const cards = items.map((it) => card(it, style));
        const head = h("div", {class: "row-head"}, h("h2", null, title),
            opts.more ? h("button", {class: "more", onclick: opts.more}, t("All"), FX.icon("forward")) : null);
        return h("section", {class: "row"}, head, h("div", {class: "cards hscroll " + (style === "land" ? "land" : "poster")}, cards));
    }

    function openItem(it) {
        const S = window.FreeXScreens;
        if (it.type === "collection") return push(S.collection(it));
        if (it.type === "season") return push(S.details(it.showId || it.parentId, {season: it.id}));
        push(S.details(it.id));
    }

    function meta(it) {
        const parts = [];
        if (it.type === "episode" && it.metadata && it.metadata.airDate) parts.push(it.metadata.airDate.slice(0, 4));
        else if (it.year) parts.push(String(it.year));
        const cr = (it.metadata && it.metadata.contentRating) || it.contentRating;
        if (cr) parts.push(h("span", {class: "pill"}, cr));
        if (it.media && it.media.durationMs) parts.push(FX.duration(it.media.durationMs));
        if (it.type === "show" && it.childCount) parts.push(it.childCount === 1 ? t("1 season") : t("{0} seasons", it.childCount));
        if (it.rating) parts.push(h("span", {class: "rating"}, FX.icon("star"), Number(it.rating).toFixed(1)));
        if (it.media && it.media.resolution) parts.push(h("span", {class: "pill"}, it.media.resolution));
        if (it.media && it.media.hdr) parts.push(h("span", {class: "pill"}, it.media.doviProfile ? "Dolby Vision" : String(it.media.hdr).toUpperCase()));
        const out = h("div", {class: "meta"});
        parts.forEach((p, i) => {
            if (i) out.appendChild(h("span", {class: "dot"}, "·"));
            out.appendChild(typeof p === "string" ? h("span", null, p) : p);
        });
        return out;
    }

    /**
     * A page with a bar on top: back button, title (shown once the page is scrolled, or always with
     * `opts.solid`) and buttons on the right. Returns {el, body, bar, setTitle}.
     */
    function page(title, opts) {
        opts = opts || {};
        const titleEl = h("div", {class: "bar-title"}, title || "");
        const right = h("div", {class: "bar-right"}, opts.actions || []);
        const bar = h("header", {class: "bar" + (opts.solid ? " solid" : "")},
            h("button", {class: "icon-btn bar-back", "aria-label": t("Back"), onclick: () => back()}, FX.icon("back")), titleEl, right);
        const body = h("div", {class: "scroll page-body" + (opts.solid ? " with-bar" : "")});
        const el = h("div", {class: "page" + (opts.cls ? " " + opts.cls : "")}, body, bar);
        if (!opts.solid) {
            body.addEventListener("scroll", () => {
                bar.classList.toggle("scrolled", body.scrollTop > (opts.threshold || 140));
            }, {passive: true});
        }
        return {el, body, bar, right, setTitle: (s) => titleEl.textContent = s};
    }

    /** Pull down at the top of a scroller to reload. */
    function pullToRefresh(scroller, reload) {
        const ind = h("div", {class: "ptr"}, h("div", {class: "spinner small"}));
        scroller.insertBefore(ind, scroller.firstChild);
        let startY = null;
        let dist = 0;
        let busy = false;
        scroller.addEventListener("touchstart", (e) => {
            if (busy || scroller.scrollTop > 0) return;
            startY = e.touches[0].clientY;
            dist = 0;
        }, {passive: true});
        scroller.addEventListener("touchmove", (e) => {
            if (startY === null) return;
            dist = Math.max(0, e.touches[0].clientY - startY);
            if (scroller.scrollTop > 0) dist = 0;
            ind.style.height = Math.min(80, dist * 0.5) + "px";
            ind.classList.toggle("ready", dist > 120);
        }, {passive: true});
        scroller.addEventListener("touchend", () => {
            if (startY === null) return;
            startY = null;
            if (dist > 120) {
                busy = true;
                ind.style.height = "56px";
                ind.classList.add("busy");
                Host.haptic("light");
                Promise.resolve(reload()).then(() => null, () => null).then(() => {
                    busy = false;
                    ind.classList.remove("busy", "ready");
                    ind.style.height = "0";
                });
            } else {
                ind.style.height = "0";
                ind.classList.remove("ready");
            }
        });
    }

    window.FreeXUI = {
        push, pop, reset, back, refreshTop, top, sheet, select, actions, dialog, confirm, addOverlay, closeOverlays,
        logo, button, iconButton, field, loading, empty, errorBox, caption, card, row, openItem, meta, page, episodes,
        pullToRefresh, get depth() {
            return stack.length;
        },
    };
})();

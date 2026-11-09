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
 * The screens of FreeX Mobile: connecting to a server, signing in, the main view with its tab bar
 * (home, libraries, search, watchlist, settings), libraries, collections, people and the detail
 * page of a movie, show or episode.
 */
(function () {
    "use strict";

    const FX = window.FX;
    const UI = window.FreeXUI;
    const Host = window.FreeXHost;
    const h = FX.h;
    const t = FX.t;

    const App = () => window.FreeXApp;
    const Player = () => window.FreeXPlayer;

    function version() {
        return window.FREEX_VERSION || "";
    }

    // ------------------------------------------------------------------ connect

    function connect() {
        const f = UI.field(t("Server address"), {type: "url", inputmode: "url", placeholder: "192.168.1.10", enterkeyhint: "go",
            value: FX.S.server.replace(/^http:\/\//, "").replace(/:32500$/, "")});
        const msg = h("p", {class: "msg"});
        const go = UI.button(t("Connect"), submit, {primary: true, cls: "wide"});
        const form = h("form", {class: "form", onsubmit: (e) => {
            e.preventDefault();
            submit();
        }}, f.el, msg, go);
        const recent = h("div", {class: "server-list"});
        FX.S.servers.forEach((s) => recent.appendChild(h("button", {class: "server-item", type: "button", onclick: () => {
            f.input.value = s.url.replace(/^http:\/\//, "").replace(/:32500$/, "");
            submit();
        }}, FX.icon("server"), h("span", {class: "label"}, h("b", null, s.name || "FreeX"), h("small", null, s.url)), FX.icon("forward"))));
        const el = h("div", {class: "auth"}, h("div", {class: "scroll auth-scroll"}, h("div", {class: "auth-box"},
            UI.logo("big"),
            h("h1", null, t("Connect to your FreeX server")),
            h("p", {class: "muted"}, t("Enter the address of your FreeX Media Server, e.g. 192.168.1.10 or media.example.org. Without a port, 32500 is used.")),
            form,
            FX.S.servers.length ? h("div", {class: "recent"}, h("h3", null, t("Recent servers")), recent) : null)));
        let busy = false;

        async function submit() {
            if (busy) return;
            const server = FX.normalizeServer(f.input.value);
            if (!server) {
                msg.textContent = t("Please enter a valid address.");
                return f.input.focus();
            }
            f.input.blur();
            busy = true;
            go.disabled = true;
            msg.textContent = t("Connecting …");
            let status;
            try {
                status = await probe(server);
            } catch (e) {
                // an address without a scheme: try HTTPS on 443 too (reverse proxies)
                const typed = String(f.input.value).trim();
                const alt = !/^https?:\/\//i.test(typed) && !/:\d+$/.test(typed) ? FX.normalizeServer("https://" + typed) : "";
                if (alt) {
                    try {
                        status = await probe(alt);
                        return done(alt, status);
                    } catch (e2) {
                        // fall through
                    }
                }
                busy = false;
                go.disabled = false;
                msg.textContent = t("No FreeX server answers at {0}.", server);
                return;
            }
            done(server, status);
        }

        function done(server, status) {
            busy = false;
            go.disabled = false;
            if (status.setupRequired) {
                msg.textContent = t("This server is not set up yet. Open {0} in a browser and create the admin account first.", server);
                return;
            }
            if (server !== FX.S.server) {
                FX.S.token = "";
                FX.S.user = null;
            }
            FX.S.server = server;
            FX.S.serverName = status.name || "FreeX";
            FX.persist();
            UI.reset(login());
        }

        return {el};
    }

    async function probe(server) {
        const ctrl = typeof AbortController === "function" ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : 0;
        try {
            const res = await fetch(server + "/api/status", {credentials: "omit", signal: ctrl ? ctrl.signal : undefined});
            const status = await res.json();
            if (!status || typeof status !== "object") throw new Error("no FreeX");
            return status;
        } finally {
            clearTimeout(timer);
        }
    }

    // ------------------------------------------------------------------ sign-in

    function login() {
        const user = UI.field(t("Username"), {type: "text", autocomplete: "username", enterkeyhint: "next"});
        const pass = UI.field(t("Password"), {type: "password", autocomplete: "current-password", enterkeyhint: "go"});
        const msg = h("p", {class: "msg"});
        const go = UI.button(t("Sign in"), submit, {primary: true, cls: "wide"});
        user.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                pass.input.focus();
            }
        });
        const form = h("form", {class: "form", onsubmit: (e) => {
            e.preventDefault();
            submit();
        }}, user.el, pass.el, msg, go);
        const el = h("div", {class: "auth"}, h("div", {class: "scroll auth-scroll"}, h("div", {class: "auth-box"},
            UI.logo("big"),
            h("h1", null, t("Sign in to {0}", FX.S.serverName || "FreeX")),
            h("p", {class: "muted"}, FX.S.server),
            form,
            h("button", {class: "link", type: "button", onclick: () => UI.reset(connect())}, t("Change server")))));
        let busy = false;

        async function submit() {
            if (busy) return;
            if (!user.input.value.trim()) return user.input.focus();
            busy = true;
            go.disabled = true;
            msg.textContent = t("Signing in …");
            let res;
            try {
                res = await FX.api("POST", "/api/login", {username: user.input.value.trim(), password: pass.input.value});
            } catch (e) {
                busy = false;
                go.disabled = false;
                msg.textContent = e.message;
                return;
            }
            if (res.twoFactorRequired) return UI.reset(secondFactor(res.challenge));
            App().signedIn(res);
        }

        return {el};
    }

    function secondFactor(challenge) {
        const code = UI.field(t("Code from your authenticator app or a recovery code"),
            {type: "text", inputmode: "numeric", autocomplete: "one-time-code", enterkeyhint: "go"});
        const msg = h("p", {class: "msg"});
        const go = UI.button(t("Confirm"), submit, {primary: true, cls: "wide"});
        const form = h("form", {class: "form", onsubmit: (e) => {
            e.preventDefault();
            submit();
        }}, code.el, msg, go);
        const el = h("div", {class: "auth"}, h("div", {class: "scroll auth-scroll"}, h("div", {class: "auth-box"},
            UI.logo("big"), h("h1", null, t("Two-factor authentication")), form,
            h("button", {class: "link", type: "button", onclick: () => UI.reset(login())}, t("Back")))));
        setTimeout(() => code.input.focus(), 350);

        async function submit() {
            msg.textContent = "";
            try {
                App().signedIn(await FX.api("POST", "/api/login/verify", {challenge, code: code.input.value.replace(/\s+/g, "")}));
            } catch (e) {
                msg.textContent = e.message;
            }
        }

        return {el};
    }

    // ------------------------------------------------------------------ main view

    const TABS = [
        {key: "home", label: "Home", icon: "home"},
        {key: "libraries", label: "Libraries", icon: "library"},
        {key: "search", label: "Search", icon: "search"},
        {key: "watchlist", label: "Watchlist", icon: "bookmark"},
        {key: "settings", label: "Settings", icon: "gear"},
    ];

    /** The main view: the content of the chosen tab and the tab bar at the bottom. */
    function main() {
        const views = h("div", {class: "tabviews"});
        const bar = h("nav", {class: "tabbar"});
        const el = h("div", {class: "main"}, views, bar);
        const made = {};
        let current = "";

        TABS.forEach((tb) => bar.appendChild(h("button", {class: "tab", type: "button", dataset: {key: tb.key}, onclick: () => show(tb.key)},
            FX.icon(tb.icon), h("span", null, t(tb.label)))));

        function make(key) {
            if (key === "home") return home();
            if (key === "libraries") return libraries();
            if (key === "search") return search();
            if (key === "watchlist") return watchlist();
            return settings();
        }

        function show(key) {
            if (key === current) {
                // tapping the open tab again goes back to its top
                const v = made[key];
                const sc = v && v.el.querySelector(".scroll");
                if (sc) sc.scrollTo({top: 0, behavior: "smooth"});
                if (v && v.again) v.again();
                return;
            }
            const before = made[current];
            if (before) {
                before.el.hidden = true;
                if (before.hide) before.hide();
            }
            current = key;
            if (!made[key]) {
                made[key] = make(key);
                views.appendChild(made[key].el);
            } else {
                made[key].el.hidden = false;
                if (made[key].show) made[key].show();
            }
            Array.prototype.forEach.call(bar.children, (b) => b.classList.toggle("on", b.dataset.key === key));
        }

        show("home");
        return {
            el,
            show,
            refresh: () => {
                const v = made[current];
                if (v && v.refresh) v.refresh();
                // other tabs load again when they are shown next
                Object.keys(made).forEach((k) => {
                    if (k !== current && made[k].stale) made[k].stale();
                });
            },
            onBack: () => {
                if (current !== "home") {
                    show("home");
                    return true;
                }
                return false;
            },
            destroy: () => Object.keys(made).forEach((k) => made[k].destroy && made[k].destroy()),
        };
    }

    // ------------------------------------------------------------------ home

    function home() {
        const avatarBtn = h("button", {class: "avatar-btn", "aria-label": t("Settings"), onclick: () => App().tab("settings")}, avatar(FX.S.user));
        const top = h("header", {class: "topbar"}, UI.logo("small"), h("div", {class: "server-name"}, FX.S.serverName || "FreeX"), avatarBtn);
        const hero = h("div", {class: "hero", hidden: true});
        const rows = h("div", {class: "rows"}, UI.loading());
        const scroll = h("div", {class: "scroll"}, hero, rows);
        const el = h("div", {class: "tabview home"}, scroll, top);
        let stale = false;
        scroll.addEventListener("scroll", () => top.classList.toggle("scrolled", scroll.scrollTop > 40), {passive: true});
        UI.pullToRefresh(scroll, load);

        function setHero(it) {
            FX.clear(hero);
            if (!it) {
                hero.hidden = true;
                el.classList.remove("with-hero");
                return;
            }
            hero.hidden = false;
            el.classList.add("with-hero");
            const art = h("div", {class: "hero-art"});
            FX.setArt(art, FX.artPath(it.type === "episode" && it.showId ? it.showId : it, "backdrop"));
            const poster = h("div", {class: "hero-poster"});
            FX.setArt(poster, FX.artPath(it, "poster"));
            const playable = it.type === "movie";
            hero.appendChild(art);
            hero.appendChild(h("div", {class: "hero-shade"}));
            hero.appendChild(h("div", {class: "hero-text"},
                h("div", {class: "kicker"}, t("Recently added")),
                h("h1", null, it.title),
                UI.meta(it),
                h("div", {class: "hero-buttons"},
                    playable ? UI.button(t("Play"), () => Player().open(it.id, {onClose: () => UI.refreshTop()}), {primary: true, icon: "play"}) : null,
                    UI.button(t("More info"), () => UI.openItem(it), {icon: "info", cls: "glass"}))));
            hero.onclick = (e) => {
                if (!e.target.closest("button")) UI.openItem(it);
            };
        }

        async function load() {
            stale = false;
            try {
                const hubs = await FX.api("GET", "/api/hubs");
                FX.clear(rows);
                const nonEmpty = (hubs || []).filter((hub) => hub.items && hub.items.length);
                if (!nonEmpty.length) {
                    setHero(null);
                    rows.appendChild(UI.empty(t("Nothing here yet. Add libraries to your server in FreeX Web."), "library"));
                    return;
                }
                // the newest title with a backdrop at the top
                const recent = nonEmpty.filter((hub) => /^recent/.test(hub.key || ""))[0] || nonEmpty[nonEmpty.length - 1];
                const pick = recent.items.filter((x) => x.type === "movie" || x.type === "show")[0];
                setHero(pick || null);
                nonEmpty.forEach((hub) => {
                    const style = hub.style === "landscape" ? "land" : "poster";
                    const more = hub.libraryId && /^recent/.test(hub.key || "") ? () => UI.push(library({id: hub.libraryId, name: hub.title}, {sort: 1})) : null;
                    const r = UI.row(hub.title, hub.items, style, {more});
                    r.dataset.hub = hub.key;
                    rows.appendChild(r);
                });
            } catch (e) {
                FX.clear(rows).appendChild(UI.errorBox(e, load));
            }
        }

        load();
        return {
            el,
            refresh: load,
            stale: () => stale = true,
            show: () => stale && load(),
            again: () => null,
            updateUser: () => FX.clear(avatarBtn).appendChild(avatar(FX.S.user)),
        };
    }

    function avatar(user, big) {
        const box = h("span", {class: "avatar" + (big ? " big" : "")}, ((user && user.username) || "?").slice(0, 1).toUpperCase());
        if (user && user.avatar) {
            const img = h("span", {class: "avatar-img"});
            box.appendChild(img);
            FX.setArt(img, "/api/users/" + encodeURIComponent(user.id) + "/avatar?v=" + encodeURIComponent(user.avatar));
        }
        return box;
    }

    // ------------------------------------------------------------------ libraries

    function libraries() {
        const list = h("div", {class: "lib-list"}, UI.loading());
        const scroll = h("div", {class: "scroll with-title"}, h("h1", {class: "tab-title"}, t("Libraries")), list);
        const el = h("div", {class: "tabview"}, scroll);
        UI.pullToRefresh(scroll, load);

        async function load() {
            try {
                const ls = await FX.api("GET", "/api/libraries");
                // the backdrop of the newest title of each library, from the home screen's rows
                const hubs = await FX.api("GET", "/api/hubs").catch(() => []);
                const newest = {};
                (hubs || []).forEach((hub) => {
                    const it = hub.libraryId && /^recent/.test(hub.key || "") && hub.items && hub.items[0];
                    if (it && !newest[hub.libraryId]) newest[hub.libraryId] = it;
                });
                FX.clear(list);
                if (!ls || !ls.length) return list.appendChild(UI.empty(t("Nothing here yet. Add libraries to your server in FreeX Web."), "library"));
                ls.forEach((l) => {
                    const art = h("div", {class: "lib-art"});
                    list.appendChild(h("button", {class: "lib-tile", type: "button", onclick: () => UI.push(library(l))},
                        art,
                        h("div", {class: "lib-shade"}),
                        h("div", {class: "lib-text"}, FX.icon(l.type === "shows" ? "tv" : "movie"),
                            h("div", null, h("b", null, l.name), h("small", null,
                                l.itemCount === 1 ? t("1 title") : t("{0} titles", l.itemCount || 0))))));
                    if (newest[l.id]) FX.setArt(art, FX.artPath(newest[l.id], "backdrop"));
                });
            } catch (e) {
                FX.clear(list).appendChild(UI.errorBox(e, load));
            }
        }

        load();
        return {el, refresh: load};
    }

    const SORTS = [
        {key: "title", order: "asc", label: "Title"},
        {key: "added", order: "desc", label: "Recently added"},
        {key: "year", order: "desc", label: "Year"},
        {key: "rating", order: "desc", label: "Rating"},
        {key: "duration", order: "desc", label: "Duration"},
    ];

    const WATCH_FILTERS = [
        {key: "", label: "All"},
        {key: "unwatched", label: "Unwatched"},
        {key: "inProgress", label: "In progress"},
        {key: "watched", label: "Watched"},
    ];

    /** A poster grid that adds cards in pieces while the user scrolls. */
    function grid(scroller) {
        const el = h("div", {class: "grid"});
        let items = [];
        let shown = 0;
        const CHUNK = 48;

        function more() {
            const end = Math.min(items.length, shown + CHUNK);
            for (let i = shown; i < end; i++) el.appendChild(UI.card(items[i], "poster"));
            shown = end;
        }

        scroller.addEventListener("scroll", () => {
            if (shown < items.length && scroller.scrollTop + scroller.clientHeight > scroller.scrollHeight - 1200) more();
        }, {passive: true});

        return {
            el,
            /** Shows the list; `atLeast` cards at once (to keep the place after a reload). */
            set(list, atLeast) {
                items = list || [];
                shown = 0;
                FX.clear(el);
                more();
                while (shown < Math.min(atLeast || 0, items.length)) more();
            },
            get items() {
                return items;
            },
        };
    }

    /** A library: its titles as a grid with sorting and filters, or the server's rows for it. */
    function library(lib, opts) {
        opts = opts || {};
        let sort = opts.sort || 0;
        let watched = "";
        let genre = "";
        let mode = "all";
        const pg = UI.page(lib.name, {solid: true, cls: "library"});
        const count = h("span", {class: "count"});
        const sortBtn = h("button", {class: "chip", onclick: chooseSort}, FX.icon("sort"), h("span"));
        const filterBtn = h("button", {class: "chip", onclick: chooseFilter}, FX.icon("filter"), h("span"));
        const genreBtn = h("button", {class: "chip", onclick: chooseGenre, hidden: true}, h("span"));
        const tabs = h("div", {class: "segmented"},
            h("button", {class: "on", dataset: {mode: "all"}, onclick: () => setMode("all")}, t("Library")),
            h("button", {dataset: {mode: "hubs"}, onclick: () => setMode("hubs")}, t("Recommended")));
        const tools = h("div", {class: "lib-tools"}, sortBtn, filterBtn, genreBtn, h("span", {class: "spacer"}), count);
        const g = grid(pg.body);
        const gridBox = h("div", {class: "grid-box"}, tools, g.el);
        const hubsBox = h("div", {class: "rows", hidden: true});
        pg.body.appendChild(h("div", {class: "lib-head"}, tabs));
        pg.body.appendChild(gridBox);
        pg.body.appendChild(hubsBox);
        let genres = [];
        let hubsLoaded = false;

        function label(b, text, active) {
            b.querySelector("span").textContent = text;
            b.classList.toggle("active", !!active);
        }

        function setMode(m) {
            mode = m;
            Array.prototype.forEach.call(tabs.children, (b) => b.classList.toggle("on", b.dataset.mode === m));
            gridBox.hidden = m !== "all";
            hubsBox.hidden = m !== "hubs";
            if (m === "hubs" && !hubsLoaded) loadHubs();
        }

        function chooseSort() {
            UI.select(t("Sort by"), SORTS.map((s, i) => ({label: t(s.label), value: i, on: i === sort}))).then((v) => {
                if (v === undefined || v === sort) return;
                sort = v;
                load();
            });
        }

        function chooseFilter() {
            UI.select(t("Show"), WATCH_FILTERS.map((f) => ({label: t(f.label), value: f.key, on: f.key === watched}))).then((v) => {
                if (v === undefined || v === watched) return;
                watched = v;
                load();
            });
        }

        function chooseGenre() {
            UI.select(t("Genre"), [{label: t("All genres"), value: "", on: !genre}].concat(genres.map((x) => ({label: x, value: x, on: x === genre})))).then((v) => {
                if (v === undefined || v === genre) return;
                genre = v;
                load();
            });
        }

        async function load() {
            const s = SORTS[sort];
            label(sortBtn, t(s.label));
            label(filterBtn, t(WATCH_FILTERS.filter((f) => f.key === watched)[0].label), !!watched);
            label(genreBtn, genre || t("Genre"), !!genre);
            FX.clear(g.el).appendChild(UI.loading());
            try {
                const res = await FX.api("GET", "/api/libraries/" + encodeURIComponent(lib.id) + "/items?sort=" + s.key + "&order=" + s.order +
                    (watched ? "&watched=" + watched : "") + (genre ? "&genre=" + encodeURIComponent(genre) : ""));
                genres = (res.genres || []).map((x) => (typeof x === "string" ? x : x.name)).filter(Boolean);
                genreBtn.hidden = !genres.length;
                if (res.library && res.library.name) pg.setTitle(res.library.name);
                const items = res.items || [];
                count.textContent = items.length === 1 ? t("1 title") : t("{0} titles", items.length);
                g.set(items);
                if (!items.length) g.el.appendChild(UI.empty(t("No titles.")));
            } catch (e) {
                FX.clear(g.el).appendChild(UI.errorBox(e, load));
            }
        }

        async function loadHubs() {
            hubsLoaded = true;
            FX.clear(hubsBox).appendChild(UI.loading());
            try {
                const hubs = await FX.api("GET", "/api/libraries/" + encodeURIComponent(lib.id) + "/hubs");
                FX.clear(hubsBox);
                (hubs || []).filter((x) => x.items && x.items.length).forEach((hub) => {
                    hubsBox.appendChild(UI.row(hub.title, hub.items, hub.style === "landscape" ? "land" : "poster"));
                });
                if (!hubsBox.children.length) hubsBox.appendChild(UI.empty(t("No titles.")));
            } catch (e) {
                hubsLoaded = false;
                FX.clear(hubsBox).appendChild(UI.errorBox(e, loadHubs));
            }
        }

        load();
        return {
            el: pg.el,
            refresh: () => {
                const y = pg.body.scrollTop;
                if (mode === "hubs") loadHubs();
                // keep the grid as it is (and where it is), only the watch states may have changed
                else reloadQuietly(y);
            },
        };

        async function reloadQuietly(y) {
            const s = SORTS[sort];
            try {
                const res = await FX.api("GET", "/api/libraries/" + encodeURIComponent(lib.id) + "/items?sort=" + s.key + "&order=" + s.order +
                    (watched ? "&watched=" + watched : "") + (genre ? "&genre=" + encodeURIComponent(genre) : ""));
                const items = res.items || [];
                g.set(items, g.el.children.length);
                pg.body.scrollTop = y;
            } catch (e) {
                // keep what is shown
            }
        }
    }

    /** A collection (movie series or one made by an admin). */
    function collection(c) {
        const pg = UI.page(c.title || c.name || "", {solid: true});
        const g = grid(pg.body);
        const head = h("div", {class: "list-head"});
        pg.body.appendChild(head);
        pg.body.appendChild(g.el);
        g.el.appendChild(UI.loading());

        async function load() {
            try {
                const res = await FX.api("GET", "/api/collections/" + encodeURIComponent(c.id));
                pg.setTitle(res.title || "");
                FX.clear(head).appendChild(h("h1", null, res.title || ""));
                if (res.summary) head.appendChild(h("p", {class: "muted"}, res.summary));
                head.appendChild(h("p", {class: "muted small"}, UI.caption(res)));
                g.set(res.items || []);
                if (!(res.items || []).length) g.el.appendChild(UI.empty(t("No titles.")));
            } catch (e) {
                FX.clear(g.el).appendChild(UI.errorBox(e, load));
            }
        }

        load();
        return {el: pg.el, refresh: load};
    }

    /** An actor or director with their titles on this server. */
    function person(p) {
        const pg = UI.page(p.name, {solid: true});
        const face = h("div", {class: "face big"});
        if (p.hasImage !== false) FX.setArt(face, "/api/people/" + encodeURIComponent(p.id) + "/image", (p.name || "?").slice(0, 1));
        const g = grid(pg.body);
        pg.body.appendChild(h("div", {class: "person-head"}, face, h("h1", null, p.name), p.role ? h("p", {class: "muted"}, p.role) : null));
        pg.body.appendChild(g.el);
        g.el.appendChild(UI.loading());

        async function load() {
            try {
                const res = await FX.api("GET", "/api/people/" + encodeURIComponent(p.id));
                g.set(res.items || []);
                if (!(res.items || []).length) g.el.appendChild(UI.empty(t("No titles.")));
            } catch (e) {
                FX.clear(g.el).appendChild(UI.errorBox(e, load));
            }
        }

        load();
        return {el: pg.el, refresh: load};
    }

    // ------------------------------------------------------------------ watchlist

    function watchlist() {
        const scroll = h("div", {class: "scroll with-title"});
        const g = grid(scroll);
        scroll.appendChild(h("h1", {class: "tab-title"}, t("Watchlist")));
        scroll.appendChild(g.el);
        const el = h("div", {class: "tabview"}, scroll);
        g.el.appendChild(UI.loading());
        let stale = false;
        UI.pullToRefresh(scroll, load);

        async function load() {
            stale = false;
            try {
                const items = await FX.api("GET", "/api/watchlist");
                g.set(items || []);
                if (!items || !items.length) g.el.appendChild(UI.empty(t("Your watchlist is empty. Add movies and shows on their page."), "bookmark"));
            } catch (e) {
                FX.clear(g.el).appendChild(UI.errorBox(e, load));
            }
        }

        load();
        return {el, refresh: load, stale: () => stale = true, show: () => load()};
    }

    // ------------------------------------------------------------------ search

    function search() {
        const input = h("input", {type: "search", placeholder: t("Title, actor, director …"), enterkeyhint: "search",
            autocomplete: "off", autocorrect: "off", autocapitalize: "off", spellcheck: "false"});
        const clearBtn = h("button", {class: "clear", type: "button", "aria-label": t("Clear"), hidden: true, onclick: () => {
            input.value = "";
            clearBtn.hidden = true;
            run();
            input.focus();
        }}, FX.icon("close"));
        const box = h("form", {class: "search-box", onsubmit: (e) => {
            e.preventDefault();
            input.blur();
            clearTimeout(timer);
            run();
        }}, FX.icon("search"), input, clearBtn);
        const results = h("div", {class: "results"});
        const hint = UI.empty(t("Search for movies, shows and episodes."), "search");
        const scroll = h("div", {class: "scroll with-title"}, h("h1", {class: "tab-title"}, t("Search")), box, hint, results);
        const el = h("div", {class: "tabview search"}, scroll);
        let timer = 0;
        let seq = 0;

        // the keyboard goes away when the results are scrolled
        scroll.addEventListener("touchstart", (e) => {
            if (!box.contains(e.target) && document.activeElement === input) input.blur();
        }, {passive: true});

        async function run() {
            const q = input.value.trim();
            const mine = ++seq;
            clearBtn.hidden = !input.value;
            if (q.length < 2) {
                FX.clear(results);
                hint.hidden = false;
                return;
            }
            hint.hidden = true;
            if (!results.children.length) results.appendChild(UI.loading());
            try {
                const r = await FX.api("GET", "/api/search?q=" + encodeURIComponent(q));
                if (mine !== seq) return;
                FX.clear(results);
                if (r.movies && r.movies.length) results.appendChild(UI.row(t("Movies"), r.movies, "poster"));
                if (r.shows && r.shows.length) results.appendChild(UI.row(t("Shows"), r.shows, "poster"));
                if (r.episodes && r.episodes.length) results.appendChild(UI.row(t("Episodes"), r.episodes, "land"));
                if (!results.children.length) results.appendChild(UI.empty(t("Nothing found for “{0}”.", q)));
            } catch (e) {
                if (mine === seq) FX.clear(results).appendChild(UI.errorBox(e));
            }
        }

        input.addEventListener("input", () => {
            clearBtn.hidden = !input.value;
            clearTimeout(timer);
            timer = setTimeout(run, 350);
        });
        setTimeout(() => input.focus(), 50);
        return {
            el,
            show: () => setTimeout(() => !input.value && input.focus(), 50),
            again: () => input.focus(),
            refresh: () => input.value.trim().length >= 2 && run(),
            destroy: () => clearTimeout(timer),
        };
    }

    // ------------------------------------------------------------------ settings

    const LANGS = ["de", "en", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "no", "fi", "cs", "hu", "tr", "ru", "uk", "el",
        "ja", "ko", "zh", "hi", "ar", "he"];

    const SUBTITLE_MODES = [
        {key: "off", label: "Off"},
        {key: "forced", label: "Only forced subtitles"},
        {key: "foreign", label: "When the audio is in another language"},
        {key: "always", label: "Always"},
    ];

    const SIZES = [{key: "s", label: "Small"}, {key: "m", label: "Medium"}, {key: "l", label: "Large"}, {key: "xl", label: "Very large"}];

    function qualityLabel(q) {
        if (!q || q === "auto") return t("Automatic");
        if (q === "original") return t("Original");
        const n = Number(q);
        return n >= 1000 ? (n / 1000) + " Mbit/s" : q;
    }

    const QUALITY_IDS = ["auto", "original", "20000", "12000", "8000", "4000", "2000", "1000"];

    function settings() {
        const body = h("div", {class: "settings"});
        const scroll = h("div", {class: "scroll with-title"}, h("h1", {class: "tab-title"}, t("Settings")), body);
        const el = h("div", {class: "tabview"}, scroll);
        let canSwitch = false;
        let status = null;

        function prefs() {
            return (FX.S.user && FX.S.user.preferences) || {};
        }

        async function setPref(changes) {
            try {
                await FX.api("PUT", "/api/me/preferences", changes);
                const me = await FX.api("GET", "/api/me");
                FX.S.user = me;
                FX.persist();
                return true;
            } catch (e) {
                FX.toast(e.message, true);
                return false;
            }
        }

        function item(ic, label, value, onclick, opts) {
            opts = opts || {};
            return h("button", {class: "set-item" + (opts.danger ? " danger" : ""), type: "button", onclick},
                ic ? FX.icon(ic) : null,
                h("span", {class: "label"}, label),
                value !== undefined && value !== null ? h("span", {class: "value"}, value) : null,
                opts.noArrow ? null : FX.icon("forward"));
        }

        function group(title, items) {
            return h("section", {class: "set-group"}, title ? h("h3", null, title) : null, h("div", {class: "set-list"}, items.filter(Boolean)));
        }

        function langName(code) {
            return code ? FX.language(code) : t("Original language");
        }

        function render() {
            const u = FX.S.user || {};
            const p = prefs();
            const style = p.subtitleStyle || {};
            const mode = SUBTITLE_MODES.filter((m) => m.key === (p.subtitleMode || "forced"))[0] || SUBTITLE_MODES[1];
            FX.clear(body).append(
                h("div", {class: "profile"}, avatar(u, true), h("div", null, h("b", null, u.username || ""),
                    h("small", null, (FX.S.serverName || "FreeX") + " · " + FX.S.server.replace(/^https?:\/\//, "")))),
                group(t("Playback"), [
                    item("audio", t("Audio language"), langName(p.audioLanguage), () => pickLanguage("audioLanguage", t("Audio language"), true)),
                    item("subtitles", t("Subtitles"), t(mode.label), () => UI.select(t("Subtitles"),
                        SUBTITLE_MODES.map((m) => ({label: t(m.label), value: m.key, on: m.key === mode.key}))).then((v) => {
                        if (v !== undefined && v !== mode.key) setPref({subtitleMode: v}).then(render);
                    })),
                    item("globe", t("Subtitle language"), p.subtitleLanguage ? FX.language(p.subtitleLanguage) : t("Like the audio"),
                        () => pickLanguage("subtitleLanguage", t("Subtitle language"), false)),
                    item("subtitles", t("Subtitle size"), t((SIZES.filter((s) => s.key === (style.size || "m"))[0] || SIZES[1]).label), () =>
                        UI.select(t("Subtitle size"), SIZES.map((s) => ({label: t(s.label), value: s.key, on: s.key === (style.size || "m")}))).then((v) => {
                            if (v === undefined || v === (style.size || "m")) return;
                            setPref({subtitleStyle: Object.assign({}, style, {size: v})}).then(render);
                        })),
                    item("quality", t("Quality at home"), qualityLabel(p.qualityHome), () => pickQuality("qualityHome", t("Quality at home"))),
                    item("quality", t("Quality on the go"), qualityLabel(p.qualityAway), () => pickQuality("qualityAway", t("Quality on the go"))),
                ]),
                h("p", {class: "set-note"}, t("These settings belong to your account and apply in FreeX Web and the other FreeX apps too.")),
                group(t("App"), [
                    item("globe", t("Display language"), p.uiLanguage === "de" ? "Deutsch" : p.uiLanguage === "en" ? "English" : t("Like the device"), () =>
                        UI.select(t("Display language"), [
                            {label: t("Like the device"), value: "", on: !p.uiLanguage},
                            {label: "Deutsch", value: "de", on: p.uiLanguage === "de"},
                            {label: "English", value: "en", on: p.uiLanguage === "en"},
                        ]).then((v) => {
                            if (v === undefined || v === (p.uiLanguage || "")) return;
                            setPref({uiLanguage: v}).then((ok) => ok && App().relaunch("settings"));
                        })),
                ]),
                group(t("Account"), [
                    canSwitch ? item("users", t("Switch user"), null, switchUser) : null,
                    item("server", t("Change server"), null, () => UI.confirm(t("Sign out and connect to another server?"), t("Change server"))
                        .then((ok) => ok && App().signOut(true).then(() => UI.reset(connect())))),
                    item("exit", t("Sign out"), null, () => UI.confirm(t("Sign out from this device?"), t("Sign out"), {danger: true})
                        .then((ok) => ok && App().signOut()), {danger: true, noArrow: true}),
                ]),
                h("div", {class: "about"},
                    UI.logo("small"),
                    h("div", null, "FreeX Mobile " + version() + (Host.version && Host.version !== version() ? " (" + Host.version + ")" : "") +
                        " · " + {ios: "iOS", android: "Android", html: t("Browser")}[Host.platform]),
                    status && status.version ? h("div", null, "FreeX Media Server " + status.version) : null,
                    h("div", null, Host.deviceName())));
        }

        function pickLanguage(key, title, original) {
            const cur = prefs()[key] || "";
            const first = original ? {label: t("Original language"), value: "", on: !cur} : {label: t("Like the audio"), value: "", on: !cur};
            const list = LANGS.map((c) => ({label: FX.language(c), value: c, on: c === cur}));
            list.sort((a, b) => a.label.localeCompare(b.label));
            UI.select(title, [first].concat(list)).then((v) => {
                if (v === undefined || v === cur) return;
                const ch = {};
                ch[key] = v;
                setPref(ch).then(render);
            });
        }

        function pickQuality(key, title) {
            const cur = prefs()[key] || "auto";
            UI.select(title, QUALITY_IDS.map((q) => ({
                label: qualityLabel(q), value: q, on: q === cur,
                sub: q === "auto" ? t("Original at home, adapted to the connection on the go") : null,
            }))).then((v) => {
                if (v === undefined || v === cur) return;
                const ch = {};
                ch[key] = v;
                setPref(ch).then(render);
            });
        }

        function load() {
            FX.api("GET", "/api/status").then((st) => {
                status = st;
                render();
            }).catch(() => null);
            FX.api("GET", "/api/switch").then((list) => {
                canSwitch = !!(list && list.length);
                render();
            }).catch(() => null);
        }

        render();
        load();
        return {el, show: render, refresh: render};
    }

    /** The other accounts with a PIN on this server; switching asks for the PIN. */
    function switchUser() {
        const list = h("div", {class: "sheet-scroll users"}, UI.loading());
        const s = UI.sheet(list, {title: t("Switch user")});
        FX.api("GET", "/api/switch").then((users) => {
            FX.clear(list);
            (users || []).forEach((u) => list.appendChild(h("button", {class: "option", onclick: () => {
                s.close();
                askPin(u);
            }}, avatar(u), h("span", {class: "label"}, h("span", null, u.username)))));
            if (!users || !users.length) list.appendChild(UI.empty(t("No other accounts with a PIN.")));
        }).catch((e) => FX.clear(list).appendChild(UI.errorBox(e)));
    }

    function askPin(u) {
        const pin = h("input", {type: "password", inputmode: "numeric", pattern: "[0-9]*", maxlength: "8", autocomplete: "off", class: "pin-input"});
        const msg = h("p", {class: "msg"});
        let s = null;
        const form = h("form", {class: "pin-form", onsubmit: async (e) => {
            e.preventDefault();
            try {
                const res = await FX.api("POST", "/api/switch", {userId: u.id, pin: pin.value});
                s.close();
                App().signedIn(res);
            } catch (err) {
                msg.textContent = err.message;
                pin.value = "";
            }
        }}, avatar(u, true), h("h3", null, t("PIN of {0}", u.username)), pin, msg, UI.button(t("Switch"), null, {primary: true, cls: "wide"}));
        form.querySelector(".btn").type = "submit";
        s = UI.sheet(form, {});
        setTimeout(() => pin.focus(), 300);
    }

    // ------------------------------------------------------------------ details

    /**
     * The page of a movie, show or episode. For shows the seasons and their episodes, for episodes
     * the other episodes of the season.
     */
    function details(id, opts) {
        opts = opts || {};
        const moreBtn = UI.iconButton("more", t("More"), () => moreMenu());
        const pg = UI.page("", {actions: [moreBtn], cls: "details", threshold: 220});
        const backdrop = h("div", {class: "d-backdrop"});
        const content = h("div", {class: "d-content"}, UI.loading());
        pg.body.appendChild(backdrop);
        pg.body.appendChild(content);
        let item = null;
        let seasonId = opts.season || null;
        let versionId = null;

        async function load() {
            try {
                item = await FX.api("GET", "/api/items/" + encodeURIComponent(id));
            } catch (e) {
                FX.clear(content).appendChild(UI.errorBox(e, load));
                return;
            }
            if (item.type === "season") {
                seasonId = item.id;
                id = item.showId || item.parentId;
                return load();
            }
            pg.setTitle(item.type === "episode" ? item.showTitle || item.title : item.title);
            FX.setArt(backdrop, FX.artPath(item, item.type === "episode" ? "thumb" : "backdrop"));
            render();
        }

        function play(it, startMs) {
            Player().open(versionId && it.id === item.id ? versionId : it.id, {startMs, onClose: () => UI.refreshTop()});
        }

        async function toggleWatched(it) {
            it = it || item;
            const watched = FX.isWatched(it);
            try {
                await FX.api(watched ? "DELETE" : "POST", "/api/items/" + encodeURIComponent(it.id) + "/watched");
                Host.haptic("light");
                load();
            } catch (e) {
                FX.toast(e.message, true);
            }
        }

        async function toggleWatchlist() {
            try {
                await FX.api(item.onWatchlist ? "DELETE" : "PUT", "/api/watchlist/" + encodeURIComponent(item.id));
                FX.toast(item.onWatchlist ? t("Removed from the watchlist") : t("Added to the watchlist"));
                Host.haptic("light");
                load();
            } catch (e) {
                FX.toast(e.message, true);
            }
        }

        function moreMenu() {
            if (!item) return;
            const it = item;
            const versions = it.versions || [];
            UI.actions(it.title, [
                it.type !== "extra" ? {label: FX.isWatched(it) ? t("Mark as unwatched") : t("Mark as watched"), icon: "checkCircle", fn: () => toggleWatched()} : null,
                it.type === "movie" || it.type === "show" ? {label: it.onWatchlist ? t("Remove from the watchlist") : t("Add to the watchlist"),
                    icon: "bookmark", fn: toggleWatchlist} : null,
                versions.length > 1 ? {label: t("Choose version"), icon: "stack", fn: chooseVersion} : null,
                it.type === "episode" && it.showId ? {label: t("Go to show"), icon: "tv", fn: () => UI.push(details(it.showId, {season: it.seasonId}))} : null,
                it.metadata && it.metadata.trailer ? {label: t("Trailer on YouTube"), icon: "play",
                    fn: () => Host.openUrl("https://www.youtube.com/watch?v=" + encodeURIComponent(it.metadata.trailer))} : null,
            ]);
        }

        function chooseVersion() {
            const versions = item.versions || [];
            const cur = versionId || (versions.filter((v) => v.current)[0] || versions[0]).id;
            UI.select(t("Version"), versions.map((v) => ({
                label: v.label || v.resolution || v.fileName, value: v.id, on: v.id === cur,
                sub: [v.resolution, v.videoCodec ? String(v.videoCodec).toUpperCase() : "", v.size ? (v.size / 1073741824).toFixed(1) + " GB" : ""].filter(Boolean).join(" · "),
            }))).then((v) => {
                if (v === undefined) return;
                versionId = v;
                render();
            });
        }

        function playArea(playable, label) {
            const p = playable.progress || {};
            const resume = !p.watched && p.offsetMs > 0;
            const dur = playable.media && playable.media.durationMs;
            const out = h("div", {class: "d-play"});
            out.appendChild(UI.button(resume ? t("Resume from {0}", FX.clock(p.offsetMs)) : label || t("Play"), () => play(playable),
                {primary: true, icon: "play", cls: "wide"}));
            if (resume && dur) {
                out.appendChild(h("div", {class: "d-progress"}, h("div", {class: "prog"}, h("i", {style: {width: Math.min(100, p.offsetMs / dur * 100).toFixed(1) + "%"}})),
                    h("small", null, t("{0} left", FX.duration(dur - p.offsetMs)))));
            }
            return {el: out, resume};
        }

        function action(ic, label, onclick, on) {
            return h("button", {class: "d-action" + (on ? " on" : ""), type: "button", onclick}, FX.icon(ic), h("span", null, label));
        }

        function render() {
            const it = item;
            const md = it.metadata || {};
            const sections = [];
            const head = h("div", {class: "d-head"});
            if (it.type !== "episode") {
                const poster = h("div", {class: "d-poster"});
                FX.setArt(poster, FX.artPath(it, "poster"), it.title);
                head.appendChild(poster);
            }
            const text = h("div", {class: "d-text"});
            if (it.type === "episode") {
                text.appendChild(h("button", {class: "kicker link", onclick: () => it.showId && UI.push(details(it.showId, {season: it.seasonId}))}, it.showTitle || ""));
                text.appendChild(h("h1", null, it.title));
                text.appendChild(h("div", {class: "ep"}, FX.episodeCode(it)));
            } else {
                text.appendChild(h("h1", null, it.title));
                if (it.tagline) text.appendChild(h("div", {class: "tagline"}, it.tagline));
            }
            text.appendChild(UI.meta(it));
            head.appendChild(text);
            sections.push(head);

            // play and the actions below it
            let resumable = null;
            if (it.type === "movie" || it.type === "episode" || it.type === "extra") {
                const pa = playArea(it);
                sections.push(pa.el);
                if (pa.resume) resumable = it;
            } else if (it.type === "show" && it.onDeck) {
                const next = it.onDeck;
                const pa = playArea(next, t("Play {0}", FX.episodeCode(next)));
                sections.push(pa.el);
                if (pa.resume) resumable = next;
            }
            const acts = h("div", {class: "d-actions"});
            if (resumable) acts.appendChild(action("restart", t("From the start"), () => play(resumable, 0)));
            if (it.type !== "extra") acts.appendChild(action("checkCircle", FX.isWatched(it) ? t("Watched") : t("Mark as watched"), () => toggleWatched(), FX.isWatched(it)));
            if (it.type === "movie" || it.type === "show") {
                acts.appendChild(action(it.onWatchlist ? "bookmarkFilled" : "bookmark", t("Watchlist"), toggleWatchlist, it.onWatchlist));
            }
            const trailer = (it.extras || []).filter((x) => /trailer/i.test(x.extraType || ""))[0];
            if (trailer) acts.appendChild(action("movie", t("Trailer"), () => play(trailer, 0)));
            if (it.type === "episode" && it.showId) acts.appendChild(action("tv", t("Go to show"), () => UI.push(details(it.showId, {season: it.seasonId}))));
            if (acts.children.length) sections.push(acts);

            if (it.summary) {
                const sum = h("p", {class: "summary clamp"}, it.summary);
                sum.addEventListener("click", () => sum.classList.toggle("clamp"));
                sections.push(sum);
            }
            const facts = h("div", {class: "facts"});
            if (it.genres) facts.appendChild(fact(t("Genre"), String(it.genres).split(/,\s*/).join(", ")));
            if (md.directors && md.directors.length) facts.appendChild(fact(t("Director"), md.directors.join(", ")));
            if (md.studio) facts.appendChild(fact(t("Studio"), md.studio));
            if (it.media) {
                const tl = techLine(it.media);
                if (tl.video) facts.appendChild(fact(t("Video"), tl.video));
                if (tl.audio) facts.appendChild(fact(t("Audio"), tl.audio));
                if (tl.subs) facts.appendChild(fact(t("Subtitles"), tl.subs));
            }
            const versions = it.versions || [];
            if (versions.length > 1) {
                const cur = versions.filter((v) => v.id === versionId)[0] || versions.filter((v) => v.current)[0] || versions[0];
                const vb = h("button", {class: "fact link-fact", onclick: chooseVersion}, h("span", null, t("Version")),
                    h("b", null, cur.label || cur.resolution || ""), FX.icon("down"));
                facts.appendChild(vb);
            }
            if (facts.children.length) sections.push(facts);

            if (it.type === "show") {
                const seasons = (it.children || []).filter((c) => c.type === "season");
                if (!seasonId || !seasons.some((s) => s.id === seasonId)) {
                    const deckSeason = it.onDeck && it.onDeck.seasonId;
                    seasonId = deckSeason && seasons.some((s) => s.id === deckSeason) ? deckSeason : seasons.length ? seasons[0].id : null;
                }
                if (seasons.length) {
                    const chips = h("div", {class: "season-tabs hscroll"}, seasons.map((s) => h("button", {
                        class: "chip" + (s.id === seasonId ? " on" : ""), type: "button", onclick: (e) => {
                            seasonId = s.id;
                            Array.prototype.forEach.call(chips.children, (c) => c.classList.toggle("on", c === e.currentTarget));
                            loadEpisodes(seasonId, epList, it.onDeck && it.onDeck.id, true);
                        },
                    }, s.title + (FX.isWatched(s) ? " ✓" : ""))));
                    const epList = h("div", {class: "episodes"}, UI.loading());
                    sections.push(h("section", {class: "row"}, h("div", {class: "row-head"}, h("h2", null, seasons.length > 1 ? t("Seasons") : t("Episodes"))),
                        seasons.length > 1 ? chips : null, epList));
                    if (seasonId) loadEpisodes(seasonId, epList, it.onDeck && it.onDeck.id);
                    setTimeout(() => {
                        const on = chips.querySelector(".on");
                        if (on) chips.scrollLeft = Math.max(0, on.offsetLeft - 16);
                    }, 0);
                }
            } else if (it.type === "episode" && it.seasonId) {
                const section = h("section", {class: "row"}, h("div", {class: "row-head"}, h("h2", null, t("More from this season"))), UI.loading());
                sections.push(section);
                moreFromSeason(it.seasonId, section, it.id);
            }

            const extras = (it.extras || []);
            if (extras.length) sections.push(UI.row(t("Trailers and extras"), extras, "land"));
            const cast = md.cast || [];
            if (cast.length) {
                sections.push(h("section", {class: "row"}, h("div", {class: "row-head"}, h("h2", null, t("Cast"))),
                    h("div", {class: "cards hscroll people"}, cast.slice(0, 40).map((p) => {
                        const ph = h("div", {class: "face"});
                        if (p.hasImage) FX.lazyArt(ph, "/api/people/" + encodeURIComponent(p.id) + "/image", p.name.slice(0, 1));
                        else ph.appendChild(h("span", {class: "fallback"}, p.name.slice(0, 1)));
                        return h("button", {class: "person", type: "button", onclick: () => p.id && UI.push(person(p))},
                            ph, h("div", {class: "t"}, p.name), h("div", {class: "s"}, p.role || ""));
                    }))));
            }
            FX.clear(content);
            sections.forEach((s) => content.appendChild(s));
        }

        function fact(label, value) {
            return h("div", {class: "fact"}, h("span", null, label), h("b", null, value));
        }

        async function loadEpisodes(sid, list, markId, fresh) {
            if (fresh) FX.clear(list).appendChild(UI.loading());
            try {
                const season = await FX.api("GET", "/api/items/" + encodeURIComponent(sid));
                if (sid !== seasonId) return;
                const eps = (season.children || []).filter((c) => c.type === "episode");
                FX.clear(list);
                eps.forEach((e) => list.appendChild(episodeRow(e, e.id === markId)));
                if (!eps.length) list.appendChild(UI.empty(t("No titles.")));
            } catch (e) {
                FX.clear(list).appendChild(UI.errorBox(e));
            }
        }

        function episodeRow(e, mark) {
            const art = h("div", {class: "art"});
            FX.lazyArt(art, FX.artPath(e, "thumb"), "");
            const p = FX.progressOf(e);
            const thumb = h("button", {class: "ep-thumb", type: "button", "aria-label": t("Play {0}", e.title), onclick: (ev) => {
                ev.stopPropagation();
                const pr = e.progress || {};
                play(e, pr.watched ? 0 : undefined);
            }}, art, h("span", {class: "ep-play"}, FX.icon("play")),
            p > 0 ? h("div", {class: "prog"}, h("i", {style: {width: (p * 100).toFixed(1) + "%"}})) : null);
            return h("div", {class: "ep-row" + (mark ? " next" : ""), onclick: () => UI.push(details(e.id))},
                thumb,
                h("div", {class: "ep-text"},
                    h("div", {class: "t"}, e.index + ". " + e.title),
                    h("div", {class: "s"}, [e.media && e.media.durationMs ? FX.duration(e.media.durationMs) : "", mark ? t("Up next") : ""].filter(Boolean).join(" · "))),
                h("button", {class: "ep-watched" + (FX.isWatched(e) ? " on" : ""), type: "button", "aria-label": t("Mark as watched"), onclick: (ev) => {
                    ev.stopPropagation();
                    toggleWatched(e);
                }}, FX.icon("checkCircle")));
        }

        async function moreFromSeason(sid, section, currentId) {
            try {
                const season = await FX.api("GET", "/api/items/" + encodeURIComponent(sid));
                const eps = (season.children || []).filter((c) => c.type === "episode");
                const list = h("div", {class: "cards hscroll land"}, eps.map((e) => {
                    const c = UI.card(e, "land", () => e.id !== currentId && UI.push(details(e.id)));
                    c.querySelector(".cap .t").textContent = e.index + ". " + e.title;
                    c.querySelector(".cap .s").textContent = e.media && e.media.durationMs ? FX.duration(e.media.durationMs) : "";
                    if (e.id === currentId) c.classList.add("current");
                    return c;
                }));
                const old = section.querySelector(".loading");
                if (old) old.remove();
                section.appendChild(list);
                setTimeout(() => {
                    const cur = list.querySelector(".current");
                    if (cur) list.scrollLeft = Math.max(0, cur.offsetLeft - 16);
                }, 0);
            } catch (e) {
                section.appendChild(UI.errorBox(e));
            }
        }

        load();
        return {el: pg.el, refresh: load};
    }

    function techLine(m) {
        const uniq = (v, i, a) => a.indexOf(v) === i;
        const video = m.videoCodec ? String(m.videoCodec).toUpperCase() + (m.resolution ? " · " + m.resolution : "") +
            (m.hdr ? " · " + (m.doviProfile ? "Dolby Vision" : String(m.hdr).toUpperCase()) : "") : "";
        const audio = (m.audio || []).map((a) => FX.language(a.language)).filter(uniq).join(", ");
        const subs = (m.subtitles || []).map((s) => FX.language(s.language)).filter(uniq).join(", ");
        return {video, audio, subs};
    }

    window.FreeXScreens = {connect, login, main, details, library, collection, person, avatar};
})();

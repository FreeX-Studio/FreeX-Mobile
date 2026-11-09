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
 * Start of FreeX Mobile: signing in and out, the back button, and the start itself (back to the
 * last server and account, otherwise connect and sign in).
 */
(function () {
    "use strict";

    const FX = window.FX;
    const UI = window.FreeXUI;
    const Host = window.FreeXHost;
    const Screens = window.FreeXScreens;
    const h = FX.h;

    let mainScreen = null;

    function applyLanguage() {
        const pref = FX.S.user && FX.S.user.preferences && FX.S.user.preferences.uiLanguage;
        FreeXI18n.use(pref || "");
    }

    function showMain(tab) {
        mainScreen = Screens.main();
        UI.reset(mainScreen);
        if (tab) mainScreen.show(tab);
    }

    function signedIn(res) {
        FX.S.token = res.token;
        FX.S.user = res.user;
        FX.rememberServer(FX.S.server, FX.S.serverName);
        FX.persist();
        applyLanguage();
        showMain();
    }

    async function signOut(quiet) {
        try {
            if (FX.S.token) await FX.api("POST", "/api/logout", {});
        } catch (e) {
            // signed out locally anyway
        }
        FX.S.token = "";
        FX.S.user = null;
        FX.persist();
        mainScreen = null;
        if (!quiet) UI.reset(Screens.login());
    }

    FX.onSignedOut = () => {
        if (!FX.S.token) return;
        FX.S.token = "";
        FX.S.user = null;
        FX.persist();
        mainScreen = null;
        FX.toast(FX.t("Please sign in again."));
        UI.reset(Screens.login());
    };

    /** Shows a tab of the main view (from anywhere: the screens above it are closed). */
    function tab(key) {
        if (!mainScreen) return;
        while (UI.depth > 1) UI.pop({instant: true, noRefresh: true});
        mainScreen.show(key);
    }

    /** Builds the interface again, e.g. in another language. */
    function relaunch(tabKey) {
        applyLanguage();
        showMain(tabKey);
    }

    // ------------------------------------------------------------------ the app around us

    Host.on("back", () => UI.back());
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") UI.back();
    });

    let hiddenAt = 0;
    Host.on("app", (e) => {
        if (e.state === "background") hiddenAt = Date.now();
        // after a longer break the open screen gets fresh data
        if (e.state === "foreground" && hiddenAt && Date.now() - hiddenAt > 5 * 60000 && !window.FreeXPlayer.playing) UI.refreshTop();
    });
    document.addEventListener("visibilitychange", () => {
        if (Host.native) return;
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt && Date.now() - hiddenAt > 5 * 60000 && !window.FreeXPlayer.playing) UI.refreshTop();
    });

    // ------------------------------------------------------------------ start

    async function boot() {
        document.documentElement.classList.add("platform-" + Host.platform);
        applyLanguage();
        if (!FX.S.server) return UI.reset(Screens.connect());
        if (!FX.S.token) return UI.reset(Screens.login());
        const splash = h("div", {class: "splash"}, UI.logo("big"), h("div", {class: "spinner"}));
        document.getElementById("app").appendChild(splash);
        try {
            const me = await FX.api("GET", "/api/me", undefined, {timeout: 12000});
            FX.S.user = me;
            FX.persist();
            applyLanguage();
            splash.remove();
            showMain();
        } catch (e) {
            splash.remove();
            if (e.status === 401) return UI.reset(Screens.login());
            UI.reset(offline(e));
        }
    }

    /** The server cannot be reached at the start. */
    function offline(e) {
        const el = h("div", {class: "auth"}, h("div", {class: "scroll auth-scroll"}, h("div", {class: "auth-box"},
            UI.logo("big"),
            h("h1", null, FX.t("{0} cannot be reached", FX.S.serverName || FX.S.server)),
            h("p", {class: "muted"}, e.message + " · " + FX.S.server),
            h("div", {class: "form"},
                UI.button(FX.t("Try again"), () => boot(), {primary: true, cls: "wide"}),
                UI.button(FX.t("Change server"), () => UI.reset(Screens.connect()), {cls: "wide"})))));
        return {el};
    }

    window.FreeXApp = {signedIn, signOut, tab, relaunch};
    boot();
})();

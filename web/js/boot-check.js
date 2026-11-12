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
 * Runs first and on purpose in plain ES5: if the interface cannot start (an old Android System
 * WebView, a script error), a message says so instead of an empty, dark screen.
 */
(function () {
    "use strict";

    var errors = [];

    window.addEventListener("error", function (e) {
        errors.push((e.message || "error") + (e.filename ? " (" + e.filename.replace(/^.*\//, "") + ":" + e.lineno + ")" : ""));
    });
    window.addEventListener("unhandledrejection", function (e) {
        errors.push("Promise: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
    });

    function chromeVersion() {
        var m = /Chrome\/(\d+)/.exec(navigator.userAgent);
        return m ? parseInt(m[1], 10) : 0;
    }

    function show() {
        var stack = document.getElementById("stack");
        if (stack && stack.children.length) return;
        // still signing in at the start (up to 12 s): look again later
        if (document.querySelector(".splash") && !errors.length) return setTimeout(show, 3000);
        var de = /^de/i.test(navigator.language || "");
        var chrome = chromeVersion();
        var old = chrome > 0 && chrome < 70;
        var box = document.createElement("div");
        box.setAttribute("style", "position:fixed;top:0;left:0;right:0;bottom:0;z-index:999;overflow:auto;padding:48px 24px;" +
            "background:#121821;color:#e8edf2;font:15px/1.5 sans-serif;-webkit-user-select:text;user-select:text");
        var title = document.createElement("h2");
        title.textContent = old
            ? (de ? "Die Android System WebView ist zu alt" : "The Android System WebView is too old")
            : (de ? "FreeX konnte nicht starten" : "FreeX could not start");
        var text = document.createElement("p");
        text.textContent = old
            ? (de ? "FreeX braucht eine neuere WebView (Chrome " + chrome + " ist installiert). Aktualisiere „Android System WebView“ im Play Store und starte die App neu."
                : "FreeX needs a newer WebView (Chrome " + chrome + " is installed). Update “Android System WebView” in the Play Store and start the app again.")
            : (de ? "Bitte schick diese Angaben an den Entwickler:" : "Please send these details to the developer:");
        var details = document.createElement("pre");
        details.setAttribute("style", "white-space:pre-wrap;font-size:12px;color:#8a97a8");
        details.textContent = navigator.userAgent + "\n\n" + (errors.length ? errors.join("\n") : "(no script error)");
        box.appendChild(title);
        box.appendChild(text);
        box.appendChild(details);
        document.body.appendChild(box);
    }

    // The interface puts its first screen into #stack right after the start.
    window.addEventListener("load", function () {
        setTimeout(show, errors.length ? 500 : 5000);
    });
})();

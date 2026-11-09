/*
 * Copyright (c) 2026 MirraNET, Niklas Linz. Licensed under the GNU LGPLv3.
 *
 * Checks the shared interface before the apps are built: every script parses as ES2018 (Android 7
 * WebViews and iOS 15), js/version.js has the version of version.json, and every text has its
 * German translation. Needs acorn: npm install --no-save acorn@8 && node tools/check-web.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

const web = path.join(__dirname, "..", "web");
let failed = false;
const fail = (msg) => {
    console.error("::error::" + msg);
    failed = true;
};

const scripts = fs.readdirSync(path.join(web, "js")).filter((f) => f.endsWith(".js"));
const sources = {};
for (const f of scripts) {
    sources[f] = fs.readFileSync(path.join(web, "js", f), "utf8");
    try {
        acorn.parse(sources[f], {ecmaVersion: 2018});
        console.log("ok", f);
    } catch (e) {
        fail(`web/js/${f}: ${e.message}`);
    }
}

const version = JSON.parse(fs.readFileSync(path.join(web, "version.json"), "utf8")).version;
const m = /FREEX_VERSION = "([^"]+)"/.exec(sources["version.js"] || "");
if (!m || m[1] !== version) fail(`web/js/version.js has ${m && m[1]}, web/version.json ${version}`);
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version ${version} is not MAJOR.MINOR.PATCH`);

// texts: t("…"), FX.t("…") and the label: "…" entries of the lists in screens.js
const sandbox = {window: {}, document: {documentElement: {}}, navigator: {language: "en"}};
require("vm").runInNewContext(sources["i18n.js"], sandbox);
const known = new Set(sandbox.window.FreeXI18n.keys());
const used = new Set();
for (const f of scripts) {
    const s = sources[f];
    for (const re of [/\bt\("((?:[^"\\]|\\.)*)"/g, /label: "((?:[^"\\]|\\.)*)"/g]) {
        let x;
        while ((x = re.exec(s))) used.add(x[1]);
    }
}
for (const k of used) {
    if (!known.has(k) && !["Deutsch", "English", "AirPlay"].includes(k)) fail(`no German text for "${k}"`);
}
console.log(`${used.size} texts, version ${version}`);
process.exit(failed ? 1 : 0);

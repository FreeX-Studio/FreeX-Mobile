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
 * Texts of FreeX Mobile. The English text is the key; German comes from the table below. The
 * language is the user's display language on the server, otherwise the one of the device.
 */
(function () {
    "use strict";

    const DE = {
        "1 episode": "1 Folge",
        "1 season": "1 Staffel",
        "1 title": "1 Titel",
        "Account": "Konto",
        "Add to the watchlist": "Zur Merkliste hinzufügen",
        "Added to the watchlist": "Zur Merkliste hinzugefügt",
        "All": "Alle",
        "All genres": "Alle Genres",
        "Always": "Immer",
        "App": "App",
        "Audio": "Audio",
        "Audio & subtitles": "Audio & Untertitel",
        "Audio converted": "Ton umgewandelt",
        "Audio language": "Audiosprache",
        "Automatic": "Automatisch",
        "Back": "Zurück",
        "Back 10 s": "10 s zurück",
        "Browser": "Browser",
        "Cancel": "Abbrechen",
        "Cast": "Besetzung",
        "Change server": "Server wechseln",
        "Choose version": "Version wählen",
        "Clear": "Leeren",
        "Close": "Schließen",
        "Code from your authenticator app or a recovery code": "Code aus deiner Authenticator-App oder ein Wiederherstellungscode",
        "Confirm": "Bestätigen",
        "Connect": "Verbinden",
        "Connect to your FreeX server": "Mit deinem FreeX-Server verbinden",
        "Connecting …": "Verbinde …",
        "Converted": "Umgewandelt",
        "Direct play": "Direkte Wiedergabe",
        "Direct stream": "Direkter Stream",
        "Director": "Regie",
        "Display language": "Anzeigesprache",
        "Duration": "Laufzeit",
        "Enter the address of your FreeX Media Server, e.g. 192.168.1.10 or media.example.org. Without a port, 32500 is used.":
            "Gib die Adresse deines FreeX Media Servers ein, z. B. 192.168.1.10 oder media.example.org. Ohne Port wird 32500 verwendet.",
        "Episodes": "Folgen",
        "Error {0}": "Fehler {0}",
        "Forward 10 s": "10 s vor",
        "From the start": "Von vorne",
        "Genre": "Genre",
        "Go to show": "Zur Serie",
        "Home": "Start",
        "In progress": "Angefangen",
        "Large": "Groß",
        "Libraries": "Mediatheken",
        "Library": "Mediathek",
        "Like the audio": "Wie der Ton",
        "Like the device": "Wie das Gerät",
        "Mark as unwatched": "Als ungesehen markieren",
        "Mark as watched": "Als gesehen markieren",
        "Medium": "Mittel",
        "More": "Mehr",
        "More from this season": "Mehr aus dieser Staffel",
        "More info": "Mehr Infos",
        "Movies": "Filme",
        "Next episode": "Nächste Folge",
        "No FreeX server answers at {0}.": "Unter {0} antwortet kein FreeX-Server.",
        "No other accounts with a PIN.": "Keine anderen Konten mit PIN.",
        "No titles.": "Keine Titel.",
        "Normal": "Normal",
        "Nothing found for “{0}”.": "Nichts gefunden für „{0}“.",
        "Nothing here yet. Add libraries to your server in FreeX Web.": "Hier ist noch nichts. Lege in FreeX Web Mediatheken auf deinem Server an.",
        "Off": "Aus",
        "Only forced subtitles": "Nur erzwungene Untertitel",
        "Original": "Original",
        "Original at home, adapted to the connection on the go": "Zu Hause Original, unterwegs passend zur Verbindung",
        "Original language": "Originalsprache",
        "PIN of {0}": "PIN von {0}",
        "Password": "Passwort",
        "Pause": "Pause",
        "Picture in picture": "Bild-in-Bild",
        "Play": "Abspielen",
        "Play now": "Jetzt abspielen",
        "Play {0}": "{0} abspielen",
        "Playback": "Wiedergabe",
        "Please enter a valid address.": "Bitte gib eine gültige Adresse ein.",
        "Please sign in again.": "Bitte melde dich erneut an.",
        "Quality": "Qualität",
        "Quality at home": "Qualität zu Hause",
        "Quality on the go": "Qualität unterwegs",
        "Rating": "Bewertung",
        "Recent servers": "Zuletzt verwendete Server",
        "Recently added": "Zuletzt hinzugefügt",
        "Recommended": "Empfohlen",
        "Remove from the watchlist": "Von der Merkliste entfernen",
        "Removed from the watchlist": "Von der Merkliste entfernt",
        "Resume from {0}": "Fortsetzen ab {0}",
        "Search": "Suche",
        "Search for movies, shows and episodes.": "Suche nach Filmen, Serien und Folgen.",
        "Seasons": "Staffeln",
        "Server address": "Serveradresse",
        "Settings": "Einstellungen",
        "Show": "Anzeigen",
        "Shows": "Serien",
        "Sign in": "Anmelden",
        "Sign in to {0}": "Bei {0} anmelden",
        "Sign out": "Abmelden",
        "Sign out and connect to another server?": "Abmelden und mit einem anderen Server verbinden?",
        "Sign out from this device?": "Auf diesem Gerät abmelden?",
        "Signing in …": "Melde an …",
        "Skip credits": "Abspann überspringen",
        "Skip intro": "Intro überspringen",
        "Small": "Klein",
        "Sort by": "Sortieren nach",
        "Special": "Special",
        "Speed": "Geschwindigkeit",
        "Studio": "Studio",
        "Subtitle language": "Untertitelsprache",
        "Subtitle size": "Untertitelgröße",
        "Subtitles": "Untertitel",
        "Switch": "Wechseln",
        "Switch user": "Benutzer wechseln",
        "The server cannot be reached": "Der Server ist nicht erreichbar",
        "The subtitles could not be loaded.": "Die Untertitel konnten nicht geladen werden.",
        "The title cannot be played on this device.": "Der Titel kann auf diesem Gerät nicht abgespielt werden.",
        "These settings belong to your account and apply in FreeX Web and the other FreeX apps too.":
            "Diese Einstellungen gehören zu deinem Konto und gelten auch in FreeX Web und den anderen FreeX-Apps.",
        "This server is not set up yet. Open {0} in a browser and create the admin account first.":
            "Dieser Server ist noch nicht eingerichtet. Öffne {0} im Browser und lege zuerst das Admin-Konto an.",
        "This title cannot be played.": "Dieser Titel kann nicht abgespielt werden.",
        "Title": "Titel",
        "Title, actor, director …": "Titel, Schauspieler, Regie …",
        "Trailer": "Trailer",
        "Trailer on YouTube": "Trailer auf YouTube",
        "Trailers and extras": "Trailer und Extras",
        "Try again": "Erneut versuchen",
        "Two-factor authentication": "Zwei-Faktor-Anmeldung",
        "Unknown": "Unbekannt",
        "Unwatched": "Ungesehen",
        "Up next": "Als Nächstes",
        "Up next in {0} s": "Weiter in {0} s",
        "Username": "Benutzername",
        "Version": "Version",
        "Very large": "Sehr groß",
        "Video": "Video",
        "Watched": "Gesehen",
        "Watchlist": "Merkliste",
        "When the audio is in another language": "Wenn der Ton in einer anderen Sprache ist",
        "Year": "Jahr",
        "Your watchlist is empty. Add movies and shows on their page.": "Deine Merkliste ist leer. Füge Filme und Serien auf ihrer Seite hinzu.",
        "burned in": "eingebrannt",
        "forced": "erzwungen",
        "{0} cannot be reached": "{0} ist nicht erreichbar",
        "{0} episodes": "{0} Folgen",
        "{0} h {1} min": "{0} Std. {1} Min.",
        "{0} left": "noch {0}",
        "{0} min": "{0} Min.",
        "{0} seasons": "{0} Staffeln",
        "{0} titles": "{0} Titel",
    };

    const TABLES = {de: DE};

    function deviceLanguage() {
        const l = (navigator.language || "en").slice(0, 2).toLowerCase();
        return TABLES[l] ? l : "en";
    }

    let lang = deviceLanguage();

    /** "" follows the device, "de" or "en" as chosen in the settings. */
    function use(l) {
        lang = l && (TABLES[l] || l === "en") ? l : deviceLanguage();
        document.documentElement.lang = lang;
    }

    function t(key) {
        const table = TABLES[lang];
        let s = (table && table[key]) || key;
        for (let i = 1; i < arguments.length; i++) s = s.split("{" + (i - 1) + "}").join(String(arguments[i]));
        return s;
    }

    window.FreeXI18n = {t, use, lang: () => lang, keys: () => Object.keys(DE)};
})();

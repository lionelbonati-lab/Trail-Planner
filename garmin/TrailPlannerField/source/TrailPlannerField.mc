import Toybox.Activity;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

// Champ de données : avance/retard sur le plan, prochain point, heure estimée,
// marge sur la prochaine barrière horaire et rappels de nutrition.
class TrailPlannerField extends WatchUi.DataField {
    // Le retard (ou l'avance) se prolonge sur la suite, amorti de 30 % et borné (comme l'app web).
    const DAMPING = 0.7;
    const CUTOFF_WARN = 1800; // s : alerte si la marge passe sous 30 min

    var plan = null;          // Plan ou null
    var status = "";          // message affiché sans plan
    var running = false;
    var dist = 0.0;           // m le long du parcours
    var delta = 0.0;          // s, positif = retard
    var next = -1;            // indice du prochain point
    var nextEta = 0;          // s Unix
    var cutIdx = -1;          // prochain point avec barrière
    var margin = 0;           // s de marge sur cette barrière
    var finishEta = 0;        // s Unix
    var startUnix = 0;        // départ réel (s Unix) = maintenant − temps écoulé
    var alerted = {};         // barrières déjà signalées
    var nextFuel = 0.0;       // temps écoulé (s) du prochain rappel
    var fuelUntil = 0;        // s Unix : affichage du rappel jusqu'à cet instant
    var passes = {};          // indice du point -> instant de passage (s Unix)
    var lastElapsed = 0.0;    // pour détecter une nouvelle activité
    var lastSaved = 0;        // dernier enregistrement du suivi (s Unix)

    function initialize() {
        DataField.initialize();
        reload();
    }

    function reload() as Void {
        var text = Application.Storage.getValue("plan");
        plan = text instanceof String ? parsePlan(text) : null;
        var code = Application.Properties.getValue("code");
        var err = Application.Storage.getValue("fetchError");
        if (!(code instanceof String) || code.length() < 8) {
            status = "Saisis le code montre";
        } else if (plan == null) {
            if (err == 404) {
                status = "Code inconnu";
            } else if (err != null) {
                status = "Plan : erreur " + err;
            } else {
                status = "Plan en attente...";
            }
        } else {
            status = "";
        }
        alerted = {};
        nextFuel = 0.0;
        passes = {};
    }

    function fuelInterval() as Number {
        var v = Application.Properties.getValue("fuelMin");
        if (v instanceof Number && v >= 0) {
            return v;
        }
        return plan != null ? plan.fuelMin : 0;
    }

    function vibrate(strong as Boolean) as Void {
        var on = Application.Properties.getValue("vibrate");
        if (on == false) {
            return;
        }
        if (Attention has :vibrate) {
            var pattern = strong
                ? [new Attention.VibeProfile(100, 400), new Attention.VibeProfile(0, 200), new Attention.VibeProfile(100, 400), new Attention.VibeProfile(0, 200), new Attention.VibeProfile(100, 400)]
                : [new Attention.VibeProfile(60, 300), new Attention.VibeProfile(0, 200), new Attention.VibeProfile(60, 300)];
            Attention.vibrate(pattern);
        }
        if (Attention has :playTone) {
            Attention.playTone(strong ? Attention.TONE_ALERT_HI : Attention.TONE_ALERT_LO);
        }
    }

    function compute(info as Activity.Info) as Void {
        if (plan == null) {
            return;
        }
        var elapsed = info.elapsedTime != null ? info.elapsedTime / 1000.0 : 0.0;
        running = elapsed > 0;
        if (!running) {
            return;
        }
        // Position le long du parcours : navigation du parcours si elle est active et cohérente,
        // sinon distance parcourue.
        var d = info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        var toDest = info.distanceToDestination;
        if (toDest != null && toDest > 0) {
            var along = plan.total - toDest.toFloat();
            var gap = along - d;
            if (gap < 0) {
                gap = -gap;
            }
            if (along >= 0 && gap < plan.total * 0.2) {
                d = along;
            }
        }
        dist = d;
        // Nouvelle activité (temps écoulé revenu en arrière) : on repart de zéro.
        if (elapsed < lastElapsed - 5) {
            passes = {};
            alerted = {};
            nextFuel = 0.0;
        }
        lastElapsed = elapsed;

        var planned = plan.plannedAt(d);
        delta = d > 200 ? elapsed - planned : 0.0;
        var ratio = 1.0;
        if (planned > 600) {
            var raw = elapsed / planned;
            if (raw < 0.7) {
                raw = 0.7;
            }
            if (raw > 1.6) {
                raw = 1.6;
            }
            ratio = 1.0 + DAMPING * (raw - 1.0);
        }
        var now = Time.now().value();
        startUnix = now - elapsed.toNumber();
        next = plan.nextIndex(d);
        if (next >= 0) {
            nextEta = now + ((plan.cpPlan[next] - planned) * ratio).toNumber();
        }
        var lastPlan = plan.finishTime();
        finishEta = now + ((lastPlan - planned) * ratio).toNumber();

        // Prochaine barrière horaire et alerte (une fois par point).
        cutIdx = -1;
        if (next >= 0) {
            for (var i = next; i < plan.cpCut.size(); i++) {
                if (plan.cpCut[i] > 0) {
                    cutIdx = i;
                    margin = plan.cpCut[i] - (now + ((plan.cpPlan[i] - planned) * ratio).toNumber());
                    break;
                }
            }
        }
        if (cutIdx >= 0 && margin < CUTOFF_WARN && !alerted.hasKey(cutIdx)) {
            alerted.put(cutIdx, true);
            vibrate(true);
        }

        // Passages aux points (pour le suivi de l'assistance).
        var changed = false;
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (!passes.hasKey(i) && d >= plan.cpDist[i] - 30) {
                passes.put(i, now);
                changed = true;
            }
        }
        if (changed || now - lastSaved >= 60) {
            saveProgress(info, now, d);
        }

        // Rappel nutrition.
        var interval = fuelInterval();
        if (interval > 0) {
            if (nextFuel <= 0.0) {
                nextFuel = elapsed + interval * 60;
            } else if (elapsed >= nextFuel) {
                nextFuel = elapsed + interval * 60;
                fuelUntil = now + 30;
                vibrate(false);
            }
        }
    }

    // Suivi lu par la tâche de fond, qui l'envoie à l'assistance via le téléphone.
    function saveProgress(info as Activity.Info, now as Number, d as Float) as Void {
        var p = "";
        var keys = passes.keys();
        for (var k = 0; k < keys.size(); k++) {
            p += (k > 0 ? "," : "") + keys[k] + ":" + passes[keys[k]];
        }
        var progress = { "t" => now, "s" => startUnix, "d" => d.toNumber(), "p" => p };
        var loc = info.currentLocation;
        if (loc != null) {
            var deg = loc.toDegrees();
            progress.put("lat", deg[0].toFloat());
            progress.put("lon", deg[1].toFloat());
        }
        var stats = System.getSystemStats();
        if (stats != null && stats.battery != null) {
            progress.put("bat", stats.battery.toNumber());
        }
        Application.Storage.setValue("progress", progress);
        lastSaved = now;
    }

    // --- Mise en forme ------------------------------------------------------

    function clock(sec as Number) as String {
        var t = Gregorian.info(new Time.Moment(sec), Time.FORMAT_SHORT);
        return (t.hour as Number).format("%02d") + ":" + (t.min as Number).format("%02d");
    }

    // « +6' », « −3' », « +1h05 ».
    function signedMinutes(sec as Float or Number) as String {
        var s = sec.toFloat();
        var sign = s >= 0 ? "+" : "-";
        var m = (s < 0 ? -s : s) / 60.0;
        var total = (m + 0.5).toNumber();
        if (total < 60) {
            return sign + total + "'";
        }
        return sign + (total / 60) + "h" + (total % 60).format("%02d");
    }

    // Raccourcit un texte pour qu'il tienne dans maxW pixels.
    function fit(dc as Graphics.Dc, text as String, font, maxW as Number) as String {
        var t = text;
        while (t.length() > 3 && dc.getTextWidthInPixels(t, font) > maxW) {
            t = t.substring(0, t.length() - 1) as String;
        }
        return t;
    }

    // Largeur utilisable à la hauteur y du champ : sur écran rond (Enduro 3, Fenix…),
    // c'est la corde du cercle à cette hauteur, déduite de la position du champ.
    function usableWidth(y as Number, h as Number, w as Number) as Number {
        var ds = System.getDeviceSettings();
        if (ds.screenShape != System.SCREEN_SHAPE_ROUND) {
            return w - 6;
        }
        var flags = getObscurityFlags();
        var sh = ds.screenHeight;
        var fieldTop = (sh - h) / 2;
        var topEdge = (flags & WatchUi.OBSCURE_TOP) != 0;
        var bottomEdge = (flags & WatchUi.OBSCURE_BOTTOM) != 0;
        if (topEdge && !bottomEdge) {
            fieldTop = 0;
        } else if (bottomEdge && !topEdge) {
            fieldTop = sh - h;
        }
        var r = ds.screenWidth / 2.0;
        var dy = fieldTop + y - sh / 2.0;
        var c2 = r * r - dy * dy;
        if (c2 <= 0) {
            return 0;
        }
        var chord = (2 * Math.sqrt(c2)).toNumber() - 12;
        return chord < w - 6 ? chord : w - 6;
    }

    // Ordre des lignes : la plus courte (l'écart) du côté du bord arrondi, là où l'écran est le plus étroit.
    function edgeOrder(delta as Array, others as Array) as Array {
        var flags = getObscurityFlags();
        var topEdge = (flags & WatchUi.OBSCURE_TOP) != 0;
        var bottomEdge = (flags & WatchUi.OBSCURE_BOTTOM) != 0;
        if (topEdge && !bottomEdge) {
            return [delta].addAll(others);
        }
        if (bottomEdge && !topEdge) {
            return others.add(delta);
        }
        return others.size() > 0 ? [others[0], delta].addAll(others.slice(1, null)) : [delta];
    }

    // Dessine des lignes [texte, police, couleur] centrées dans le champ, en évitant les bords arrondis.
    function drawLines(dc as Graphics.Dc, lines as Array) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var flags = getObscurityFlags();
        var top = (flags & WatchUi.OBSCURE_TOP) != 0 ? (h * 0.10).toNumber() : 2;
        var bottom = (flags & WatchUi.OBSCURE_BOTTOM) != 0 ? h - (h * 0.10).toNumber() : h - 2;
        var total = 0;
        for (var i = 0; i < lines.size(); i++) {
            total += dc.getFontHeight(lines[i][1]);
        }
        var y = top + (bottom - top - total) / 2;
        for (var i = 0; i < lines.size(); i++) {
            var font = lines[i][1];
            var fh = dc.getFontHeight(font);
            dc.setColor(lines[i][2], Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, y, font, fit(dc, lines[i][0], font, usableWidth(y + fh / 2, h, w)), Graphics.TEXT_JUSTIFY_CENTER);
            y += fh;
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var bg = getBackgroundColor();
        var dark = bg == Graphics.COLOR_BLACK;
        var fg = dark ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        var red = dark ? Graphics.COLOR_RED : Graphics.COLOR_DK_RED;
        var green = dark ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN;
        dc.setColor(fg, bg);
        dc.clear();
        var h = dc.getHeight();

        if (plan == null) {
            drawLines(dc, [[status, Graphics.FONT_XTINY, fg]]);
            return;
        }
        if (!running) {
            drawLines(dc, [[plan.name, Graphics.FONT_XTINY, fg], [(plan.start > 0) ? "Départ " + clock(plan.start) : "Départ libre", Graphics.FONT_SMALL, fg]]);
            return;
        }
        var now = Time.now().value();
        if (now < fuelUntil) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_ORANGE);
            dc.clear();
            drawLines(dc, [["Manger / boire", h > 90 ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL, Graphics.COLOR_WHITE]]);
            return;
        }

        var deltaColor = delta > 60 ? red : (delta < -60 ? green : fg);
        var nextName = next >= 0 ? plan.cpName[next] : "Arrivée";
        var toNext = next >= 0 ? (plan.cpDist[next] - dist) / 1000.0 : 0.0;
        var nextLine = toNext.format("%.1f") + " km · " + nextName;
        // Polices texte (et non chiffres) : « ' », « + » et « h » y sont toujours disponibles.
        var deltaText = signedMinutes(delta);

        if (h < 90) {
            // Petit champ (quart d'écran) : écart et prochain point.
            drawLines(dc, edgeOrder([deltaText, Graphics.FONT_MEDIUM, deltaColor], [[nextLine, Graphics.FONT_XTINY, fg]]));
            return;
        }

        var cutText = null;
        var cutColor = fg;
        if (cutIdx >= 0) {
            cutText = margin >= 0 ? "Marge BH " + signedMinutes(margin) : "Hors délai " + signedMinutes(margin);
            cutColor = margin < CUTOFF_WARN ? red : fg;
        }

        if (h < 170) {
            // Demi-écran (ex. Enduro 3 : 280 × 140) : trois lignes.
            var third = next >= 0 ? "Est. " + clock(nextEta) : "Arrivée " + clock(finishEta);
            var thirdColor = fg;
            if (cutText != null && margin < CUTOFF_WARN) {
                third = cutText;
                thirdColor = cutColor;
            }
            drawLines(dc, edgeOrder([deltaText, Graphics.FONT_LARGE, deltaColor], [[nextLine, Graphics.FONT_XTINY, fg], [third, Graphics.FONT_XTINY, thirdColor]]));
            return;
        }

        // Plein écran : quatre lignes.
        var lines = [[nextLine, Graphics.FONT_XTINY, fg], [deltaText, Graphics.FONT_LARGE, deltaColor]];
        if (next >= 0) {
            lines.add(["Prévu " + clock(startUnix + plan.cpPlan[next]) + " · Est. " + clock(nextEta), Graphics.FONT_XTINY, fg]);
        }
        lines.add(cutText != null ? [cutText, Graphics.FONT_XTINY, cutColor] : ["Arrivée " + clock(finishEta), Graphics.FONT_XTINY, fg]);
        drawLines(dc, lines);
    }
}

import Toybox.Activity;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// Écrans de la sortie, passés avec Haut / Bas : profil de la course (qui suit le coureur, zoom choisi
// dans le menu), puis données (chrono, distance, D+, cardio, écart au plan, heure).
class MainView extends WatchUi.View {
    const PAGES = 2;

    var run as Run;
    var page = 0;

    function initialize(r as Run) {
        View.initialize();
        run = r;
    }

    function nextPage(dir as Number) as Void {
        page = (page + dir + PAGES) % PAGES;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        if (run.state == DONE) {
            drawDone(dc);
        } else if (page == 0) {
            drawProfilePage(dc);
        } else {
            drawDataPage(dc);
        }
    }

    function round() as Boolean {
        return System.getDeviceSettings().screenShape == System.SCREEN_SHAPE_ROUND;
    }

    // --- Écran du profil -------------------------------------------------------------------------------

    function drawProfilePage(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var plan = run.plan;
        if (plan != null && plan.hasProfile()) {
            // Cadre du profil : il tient dans un écran rond (coins sur le cercle).
            var side = round() ? (w * 0.11).toNumber() : (w * 0.04).toNumber();
            var box = [side, (h * 0.22).toNumber(), w - side, (h * 0.72).toNumber()] as Array<Number>;
            var pos = run.state == READY ? 0.0 : run.dist;
            drawProfile(dc, plan, pos, zoomSpan(plan.total), slopesOn(), box);
        } else {
            var msg = plan != null ? "Pas de profil" : run.status;
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, msg, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        drawHeader(dc, (h * 0.13).toNumber());
        drawFooter(dc, (h * 0.86).toNumber());
    }

    // En haut : nom de la course avant le départ, « Pause », « Hors parcours », « Tour N ». Rien sinon.
    function drawHeader(dc as Graphics.Dc, y as Number) as Void {
        var text = "";
        var color = Graphics.COLOR_WHITE;
        if (run.state == READY) {
            text = run.plan != null ? run.plan.name : "Trail Planner";
        } else if (run.state == PAUSED) {
            text = "Pause";
            color = Graphics.COLOR_ORANGE;
        } else if (run.offRoute) {
            text = "Hors parcours · " + run.offBy + " m";
            color = Graphics.COLOR_RED;
        } else if (Time.now().value() < run.lapUntil) {
            text = "Tour " + run.laps;
        }
        drawLine(dc, y, text, color, Graphics.FONT_XTINY);
    }

    // En bas : état du GPS et touche à presser avant le départ ou en pause.
    function drawFooter(dc as Graphics.Dc, y as Number) as Void {
        if (run.state == READY) {
            if (run.gpsOk) {
                drawLine(dc, y, "START : départ", Graphics.COLOR_GREEN, Graphics.FONT_XTINY);
            } else {
                drawLine(dc, y, "GPS...", Graphics.COLOR_LT_GRAY, Graphics.FONT_XTINY);
            }
        } else if (run.state == PAUSED) {
            drawLine(dc, y, "START : reprendre", Graphics.COLOR_LT_GRAY, Graphics.FONT_XTINY);
        }
    }

    // Une ligne centrée, raccourcie à la largeur de l'écran à cette hauteur (écran rond).
    function drawLine(dc as Graphics.Dc, y as Number, text as String, color, font) as Void {
        if (text.length() == 0) {
            return;
        }
        var w = dc.getWidth();
        var maxW = w - 16;
        if (round()) {
            var r = w / 2.0;
            var fh = dc.getFontHeight(font);
            var dy = (y < r ? r - (y - fh / 2) : (y + fh / 2) - r).toFloat();
            var half = dy < r ? Math.sqrt(r * r - dy * dy) : 0.0;
            maxW = (2 * half - 8).toNumber();
        }
        var t = text;
        while (t.length() > 1 && dc.getTextWidthInPixels(t, font) > maxW) {
            t = t.substring(0, t.length() - 1) as String;
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, font, t, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // --- Écran des données -----------------------------------------------------------------------------

    function drawDataPage(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var info = Activity.getActivityInfo();
        var plan = run.plan;
        var timer = info != null && info.timerTime != null ? info.timerTime / 1000 : 0;
        var walked = info != null && info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        // Distance le long du parcours une fois calée sur le tracé, sinon distance de la montre.
        var dist = (plan != null && plan.hasRoute() && run.matched >= 0) ? run.dist : walked;
        var ascent = info != null && info.totalAscent != null ? info.totalAscent : 0;
        var hr = info != null ? info.currentHeartRate : null;

        drawLine(dc, (h * 0.10).toNumber(), clock(), Graphics.COLOR_LT_GRAY, Graphics.FONT_XTINY);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, (h * 0.27).toNumber(), Graphics.FONT_NUMBER_MEDIUM, duration(timer), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        cell(dc, w * 0.31, h * 0.50, "Distance", (dist / 1000.0).format("%.2f"), Graphics.COLOR_WHITE);
        cell(dc, w * 0.69, h * 0.50, "D+", ascent.toString(), Graphics.COLOR_WHITE);
        cell(dc, w * 0.31, h * 0.72, "Cardio", hr != null ? hr.toString() : "--", Graphics.COLOR_WHITE);
        // Écart au plan à l'endroit où l'on est (positif : retard), comme le champ de données.
        var gap = "--";
        var gapColor = Graphics.COLOR_WHITE;
        if (plan != null && run.state != READY && dist > 200 && info != null && info.elapsedTime != null) {
            var delta = info.elapsedTime / 1000.0 - plan.plannedAt(dist);
            gap = signedMinutes(delta);
            gapColor = delta > 60 ? Graphics.COLOR_RED : (delta < -60 ? Graphics.COLOR_GREEN : Graphics.COLOR_WHITE);
        }
        cell(dc, w * 0.69, h * 0.72, "Plan", gap, gapColor);
        if (run.state == PAUSED) {
            drawLine(dc, (h * 0.89).toNumber(), "Pause", Graphics.COLOR_ORANGE, Graphics.FONT_XTINY);
        } else if (run.state == READY) {
            drawLine(dc, (h * 0.89).toNumber(), run.gpsOk ? "START : départ" : "GPS...", run.gpsOk ? Graphics.COLOR_GREEN : Graphics.COLOR_LT_GRAY, Graphics.FONT_XTINY);
        }
    }

    // Petite étiquette grise et valeur en dessous.
    function cell(dc as Graphics.Dc, x as Float, y as Float, label as String, value as String, color) as Void {
        var lf = Graphics.FONT_XTINY;
        var vf = Graphics.FONT_MEDIUM;
        var lh = dc.getFontHeight(lf);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x.toNumber(), (y - lh).toNumber(), lf, label, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x.toNumber(), (y + 2).toNumber(), vf, value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // --- Fin de la sortie ------------------------------------------------------------------------------

    function drawDone(dc as Graphics.Dc) as Void {
        var h = dc.getHeight();
        drawLine(dc, (h * 0.42).toNumber(), run.saved ? "Sortie enregistrée" : "Sortie supprimée", Graphics.COLOR_WHITE, Graphics.FONT_SMALL);
        drawLine(dc, (h * 0.60).toNumber(), "BACK : quitter", Graphics.COLOR_LT_GRAY, Graphics.FONT_XTINY);
    }

    // --- Formats ---------------------------------------------------------------------------------------

    function clock() as String {
        var t = System.getClockTime();
        return (t.hour as Number).format("%02d") + ":" + (t.min as Number).format("%02d");
    }

    // « 42:05 » ou « 1:42:05 ».
    function duration(sec as Number) as String {
        var hh = sec / 3600;
        var mm = (sec % 3600) / 60;
        var ss = sec % 60;
        if (hh > 0) {
            return hh + ":" + mm.format("%02d") + ":" + ss.format("%02d");
        }
        return mm + ":" + ss.format("%02d");
    }

    // Écart en minutes, comme le champ : « +6' », « -3' », « +1h05 ».
    function signedMinutes(sec as Float) as String {
        var sign = sec >= 0 ? "+" : "-";
        var m = (sec < 0 ? -sec : sec) / 60.0;
        var total = (m + 0.5).toNumber();
        if (total < 60) {
            return sign + total + "'";
        }
        return sign + (total / 60) + "h" + (total % 60).format("%02d");
    }
}

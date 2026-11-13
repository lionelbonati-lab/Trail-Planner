import Toybox.Activity;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Graphics;
import Toybox.Lang;
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

    function onUpdate(dc as Graphics.Dc) as Void {
        var bg = getBackgroundColor();
        var dark = bg == Graphics.COLOR_BLACK;
        var fg = dark ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        var red = dark ? Graphics.COLOR_RED : Graphics.COLOR_DK_RED;
        var green = dark ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN;
        dc.setColor(fg, bg);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var center = Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER;

        if (plan == null) {
            dc.drawText(cx, h / 2, Graphics.FONT_XTINY, status, center);
            return;
        }
        if (!running) {
            dc.drawText(cx, h * 0.35, Graphics.FONT_XTINY, plan.name, center);
            dc.drawText(cx, h * 0.62, Graphics.FONT_TINY, "Départ " + clock(plan.start), center);
            return;
        }
        var now = Time.now().value();
        if (now < fuelUntil) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_ORANGE);
            dc.clear();
            dc.drawText(cx, h / 2, h > 90 ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL, "Manger / boire", center);
            return;
        }

        var deltaColor = delta > 60 ? red : (delta < -60 ? green : fg);
        var nextName = next >= 0 ? plan.cpName[next] : "Arrivée";
        var toNext = next >= 0 ? (plan.cpDist[next] - dist) / 1000.0 : 0.0;

        if (h < 90) {
            // Petit champ : écart et prochain point.
            dc.setColor(deltaColor, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.38, Graphics.FONT_MEDIUM, signedMinutes(delta), center);
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.78, Graphics.FONT_XTINY, nextName + " " + toNext.format("%.1f") + " km", center);
            return;
        }

        // Grand champ (demi-écran ou plein écran).
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.16, Graphics.FONT_XTINY, nextName + " · " + toNext.format("%.1f") + " km", center);
        dc.setColor(deltaColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.40, Graphics.FONT_NUMBER_MEDIUM, signedMinutes(delta), center);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        if (next >= 0) {
            var line = "Prévu " + clock(startUnix + plan.cpPlan[next]) + " · Est. " + clock(nextEta);
            dc.drawText(cx, h * 0.64, Graphics.FONT_XTINY, line, center);
        }
        if (cutIdx >= 0) {
            dc.setColor(margin < CUTOFF_WARN ? red : fg, Graphics.COLOR_TRANSPARENT);
            var cutText = margin >= 0 ? "Marge barrière " + signedMinutes(margin) : "Hors délai " + signedMinutes(margin);
            dc.drawText(cx, h * 0.82, Graphics.FONT_XTINY, cutText, center);
        } else {
            dc.drawText(cx, h * 0.82, Graphics.FONT_XTINY, "Arrivée " + clock(finishEta), center);
        }
    }
}

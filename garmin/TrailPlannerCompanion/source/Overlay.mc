import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// Éléments communs aux écrans Profil et Carte : bandeau du haut (écart au plan, messages), ligne du bas
// (touche à presser), anneau d'état avant le départ et en pause.

function isRound() as Boolean {
    return System.getDeviceSettings().screenShape == System.SCREEN_SHAPE_ROUND;
}

// Avant START, en bas de chaque écran (pas d'anneau d'état) : « GPS... » en rouge tant que le GPS n'est
// pas prêt, puis « START : départ » en vert. [texte, couleur].
function startHint(run as Run) as Array {
    if (run.gpsOk) {
        return [tpText(Rez.Strings.tp_start), darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN];
    }
    return ["GPS...", Graphics.COLOR_RED];
}

// En haut : nom de la course avant le départ ; « Pause » ; « Hors parcours · N m » ; passage, départ ou
// tour pendant 5 s ; sinon écart au plan (+6' en rouge = 6 min de retard, avance en vert).
// `boxed` : texte sur un fond (par-dessus la carte).
function drawHeader(dc as Graphics.Dc, run as Run, y as Number, boxed as Boolean) as Void {
    var now = Time.now().value();
    if (run.state == READY) {
        drawFitted(dc, y, run.plan != null ? run.plan.name : "Trail Planner", themeFg(), Graphics.FONT_XTINY, boxed);
    } else if (run.state == PAUSED) {
        drawFitted(dc, y, tpText(Rez.Strings.tp_paused), Graphics.COLOR_ORANGE, Graphics.FONT_XTINY, boxed);
    } else if (run.offRoute) {
        drawFitted(dc, y, tpText(Rez.Strings.tp_off_route) + " · " + run.offBy + " m", Graphics.COLOR_RED, Graphics.FONT_XTINY, boxed);
    } else if (now < run.msgUntil) {
        // « Passage · nom » trop long à cette hauteur de l'écran rond : le nom du point seul.
        var text = run.msg;
        if (run.msgShort.length() > 0 && dc.getTextWidthInPixels(text, Graphics.FONT_XTINY) > widthAt(dc, y, Graphics.FONT_XTINY)) {
            text = run.msgShort;
        }
        drawFitted(dc, y, text, themeFg(), Graphics.FONT_XTINY, boxed);
    } else {
        var gap = run.planGap();
        if (gap != null) {
            var color = gap > 60 ? Graphics.COLOR_RED : (gap < -60 ? (darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN) : themeFg());
            drawFitted(dc, y, signedMinutes(gap), color, Graphics.FONT_MEDIUM, boxed);
        }
    }
}

// En bas : touche à presser avant le départ ou en pause.
function drawFooter(dc as Graphics.Dc, run as Run, y as Number, boxed as Boolean) as Void {
    if (run.state == READY) {
        var hint = startHint(run);
        drawFitted(dc, y, hint[0] as String, hint[1], Graphics.FONT_XTINY, boxed);
    } else if (run.state == PAUSED) {
        drawFitted(dc, y, tpText(Rez.Strings.tp_resume_hint), Graphics.COLOR_ORANGE, Graphics.FONT_XTINY, boxed);
    }
}

// Largeur disponible (px) pour une ligne centrée à cette hauteur (écran rond : corde du cercle).
function widthAt(dc as Graphics.Dc, y as Number, font) as Number {
    var w = dc.getWidth();
    if (!isRound()) {
        return w - 16;
    }
    var r = w / 2.0;
    var fh = dc.getFontHeight(font);
    var dy = (y < r ? r - (y - fh / 2) : (y + fh / 2) - r).toFloat();
    var half = dy < r ? Math.sqrt(r * r - dy * dy) : 0.0;
    return (2 * half - 8).toNumber();
}

// Une ligne centrée, raccourcie à la largeur de l'écran à cette hauteur ; `boxed` : sur un fond aux
// couleurs du thème (lisible par-dessus la carte).
function drawFitted(dc as Graphics.Dc, y as Number, text as String, color, font, boxed as Boolean) as Void {
    if (text.length() == 0) {
        return;
    }
    var w = dc.getWidth();
    var maxW = widthAt(dc, y, font);
    var t = text;
    while (t.length() > 1 && dc.getTextWidthInPixels(t, font) > maxW) {
        t = t.substring(0, t.length() - 1) as String;
    }
    if (boxed) {
        var tw = dc.getTextWidthInPixels(t, font) + 10;
        var th = dc.getFontHeight(font);
        dc.setColor(themeBg(), Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(w / 2 - tw / 2, y - th / 2, tw, th, 4);
    }
    dc.setColor(color, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, y, font, t, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
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

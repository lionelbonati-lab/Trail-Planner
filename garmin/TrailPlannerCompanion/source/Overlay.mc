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

// Tour en attente d'annulation (Run.lap) : anneau du décompte sur le bord de l'écran, plein à l'appui et
// vide au bout de LAP_UNDO_S, et petit arc rouge en face de la touche Bas ; `hint` : icône de tour et
// « Annuler » à la place de la dernière ligne (chrono d'EndurancePro, prochain point de Trail Planner), le
// point que le tour va valider à la place de la ligne du dessus.
function drawLapCountdown(dc as Graphics.Dc, run as Run, hint as Boolean) as Void {
    if (run.lapPending == 0) {
        return;
    }
    var left = 1.0 - (System.getTimer() - run.lapPendingMs) / (LAP_UNDO_S * 1000.0);
    if (left <= 0.0) {
        return;
    }
    var w = dc.getWidth();
    var h = dc.getHeight();
    // Lignes d'abord, sur un fond limité à la largeur visible à leur hauteur (les anneaux du bord restent).
    if (hint) {
        var l = run.ep.lay();
        // Dernière ligne : icône de tour et « Annuler » en rouge, à gauche, à côté de l'arc de la touche Bas.
        var y = l.TimerY;
        var bh = dc.getFontHeight(Graphics.FONT_MEDIUM);
        var bw = widthAt(dc, y, Graphics.FONT_MEDIUM) - 12;
        var x0 = w / 2 - bw / 2;
        dc.setColor(themeBg(), themeBg());
        dc.fillRectangle(x0, y - bh / 2, bw, bh);
        drawUndoLabel(dc, run, x0 + 4, y);
        // Ligne du dessus (écart au plan et heure d'arrivée, distance d'EndurancePro) : le point que le tour
        // va valider, en vert, qui défile en boucle s'il ne tient pas. Fond sur toute la ligne (l'heure
        // d'arrivée va jusqu'au bord), au plus près des anneaux du bord.
        var preview = run.lapPreview;
        if (preview != null) {
            var y2 = l.DistY;
            var bh2 = dc.getFontHeight(Graphics.FONT_LARGE);
            var bw2 = w - 16;
            if (isRound()) {
                var rr = w / 2.0 - 8;
                var dy = (y2 - h / 2).toFloat();
                bw2 = dy * dy < rr * rr ? (2 * Math.sqrt(rr * rr - dy * dy)).toNumber() : 0;
            }
            var x2 = w / 2 - bw2 / 2;
            dc.setColor(themeBg(), themeBg());
            dc.fillRectangle(x2, y2 - bh2 / 2, bw2, bh2);
            drawMarquee(dc, preview as String, Graphics.FONT_MEDIUM, x2 + 4, x2 + bw2 - 4, y2, bh2, System.getTimer() - run.lapPendingMs);
        }
    }
    var pen = w > 300 ? 8 : 6;
    if (dc has :setPenWidth) {
        dc.setPenWidth(pen);
    }
    dc.setColor(0x00AACC, Graphics.COLOR_TRANSPARENT);
    if (isRound()) {
        var r = w / 2 - pen / 2;
        if (left >= 0.995) {
            dc.drawCircle(w / 2, h / 2, r);
        } else {
            // Du haut (90°) dans le sens des aiguilles d'une montre, sur la part qui reste.
            var stopDeg = 90 - (360 * left).toNumber();
            if (stopDeg < 0) {
                stopDeg += 360;
            }
            dc.drawArc(w / 2, h / 2, r, Graphics.ARC_CLOCKWISE, 90, stopDeg);
        }
    } else {
        dc.fillRectangle(0, 0, (w * left).toNumber(), pen);
    }
    // Petit arc rouge sur le bord, en face de la touche Bas (vers 8 h), comme les applis Garmin.
    if (isRound()) {
        var ap = w > 300 ? 10 : 7;
        if (dc has :setPenWidth) {
            dc.setPenWidth(ap);
        }
        dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
        dc.drawArc(w / 2, h / 2, w / 2 - ap / 2, Graphics.ARC_COUNTER_CLOCKWISE, 200, 230);
    }
    if (dc has :setPenWidth) {
        dc.setPenWidth(1);
    }
}

// Icône de tour et « Annuler » en rouge à partir de x : Bas annule le tour.
function drawUndoLabel(dc as Graphics.Dc, run as Run, x as Number, y as Number) as Void {
    var icon = run.ep.lapIcon();
    dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
    dc.drawText(x, y + run.ep.lay().iconSmallOffsetY, icon[0], icon[1] as String, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    dc.drawText(x + (icon[2] as Number) + 4, y, Graphics.FONT_TINY, tpText(Rez.Strings.tp_undo), Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
}

// Texte en vert entre x0 et x1 : centré s'il tient, sinon il défile en boucle (50 px/s, 40 px entre deux
// passages) ; `ms` : temps écoulé depuis le début du défilement.
function drawMarquee(dc as Graphics.Dc, text as String, font, x0 as Number, x1 as Number, y as Number, bh as Number, ms as Number) as Void {
    var room = x1 - x0;
    var tw = dc.getTextWidthInPixels(text, font);
    dc.setColor(darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN, Graphics.COLOR_TRANSPARENT);
    if (tw <= room) {
        dc.drawText((x0 + x1) / 2, y, font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return;
    }
    if (!(dc has :setClip)) {
        var t = text;
        while (t.length() > 1 && dc.getTextWidthInPixels(t, font) > room) {
            t = t.substring(0, t.length() - 1) as String;
        }
        dc.drawText(x0, y, font, t, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        return;
    }
    var period = tw + 40;
    var shift = (ms * 50 / 1000) % period;
    dc.setClip(x0, y - bh / 2, room, bh);
    dc.drawText(x0 - shift, y, font, text, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    dc.drawText(x0 - shift + period, y, font, text, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    dc.clearClip();
}

// Sortie libre, pendant le décompte d'annulation : écran du tour qui vient de finir (numéro, temps,
// distance, allure ou vitesse selon l'unité d'EndurancePro), icône de tour et « Annuler » en rouge.
function drawLapScreen(dc as Graphics.Dc, run as Run) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    var fg = themeFg();
    dc.setColor(fg, themeBg());
    dc.clear();
    drawFitted(dc, (h * 0.27).toNumber(), tpText(Rez.Strings.tp_lap) + " " + run.laps, fg, Graphics.FONT_MEDIUM, false);
    var t = run.lapShownTime / 1000;
    var lapTime = t >= 3600
        ? (t / 3600) + ":" + ((t % 3600) / 60).format("%02d") + ":" + (t % 60).format("%02d")
        : (t / 60) + ":" + (t % 60).format("%02d");
    dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    dc.drawText(w / 2, (h * 0.47).toNumber(), Graphics.FONT_NUMBER_MEDIUM, lapTime, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    var d = run.lapShownDist;
    var line = (d / 1000.0).format("%.2f") + " km";
    if (d > 20.0 && t > 0) {
        if (isKmhMode()) {
            line += " · " + (d / 1000.0 / (t / 3600.0)).format("%.1f") + " km/h";
        } else {
            var p = (t / (d / 1000.0)).toNumber();
            line += " · " + (p / 60) + ":" + (p % 60).format("%02d") + " /km";
        }
    }
    drawFitted(dc, (h * 0.66).toNumber(), line, fg, Graphics.FONT_SMALL, false);
    // En bas à gauche, à côté de l'arc de la touche Bas : icône de tour et « Annuler » en rouge.
    var uy = (h * 0.80).toNumber();
    drawUndoLabel(dc, run, w / 2 - widthAt(dc, uy, Graphics.FONT_TINY) / 2 + 12, uy);
}

// Avant START, en bas de chaque écran (pas d'anneau d'état) : « GPS... » en rouge tant que le GPS n'est
// pas prêt, puis « START : départ » en vert. [texte, couleur].
function startHint(run as Run) as Array {
    if (run.gpsOk) {
        return [tpText(Rez.Strings.tp_start), darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN];
    }
    return ["GPS...", Graphics.COLOR_RED];
}

// En haut (profil, carte) : rien avant le départ (pas de titre) ; « Pause » ; « Hors parcours · N m » ;
// passage, départ ou tour pendant 5 s ; sinon écart au plan (+6' en rouge = 6 min de retard, avance en
// vert). `boxed` : texte sur un fond (par-dessus la carte).
function drawHeader(dc as Graphics.Dc, run as Run, y as Number, boxed as Boolean) as Void {
    var now = Time.now().value();
    if (run.state == READY) {
        return;
    } else if (run.state == PAUSED) {
        drawFitted(dc, y, tpText(Rez.Strings.tp_paused), Graphics.COLOR_ORANGE, Graphics.FONT_XTINY, boxed);
    } else if (run.offRoute) {
        drawFitted(dc, y, tpText(Rez.Strings.tp_off_route) + " · " + run.offBy + " m", Graphics.COLOR_RED, Graphics.FONT_XTINY, boxed);
    } else if (now < run.msgUntil) {
        // « Départ · nom » trop long à cette hauteur de l'écran rond : le nom du point seul.
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

// Plus grande police de la liste (de la plus grande à la plus petite) dans laquelle le texte tient entier
// à cette hauteur de l'écran ; la plus petite sinon.
function fitFont(dc as Graphics.Dc, y as Number, text as String, fonts as Array) {
    for (var i = 0; i < fonts.size() - 1; i++) {
        if (dc.getTextWidthInPixels(text, fonts[i]) <= widthAt(dc, y, fonts[i])) {
            return fonts[i];
        }
    }
    return fonts[fonts.size() - 1];
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

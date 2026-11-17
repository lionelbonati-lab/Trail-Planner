import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// Écrans de la sortie, passés avec Haut / Bas :
// 1. EndurancePro (écran du champ EndurancePro 2.7.3, à l'identique) ;
// 2. profil de la course qui suit le coureur (zoom et couleurs des pentes dans le menu), écart au plan
//    en haut.
// Avant le départ et en pause, un anneau au bord de l'écran donne l'état : rouge = GPS en recherche,
// vert = prêt (START), orange = pause. Le thème (clair / sombre) est celui d'EndurancePro.
class MainView extends WatchUi.View {
    const PAGES = 2;

    var run as Run;
    var page = 0;

    function initialize(r as Run) {
        View.initialize();
        run = r;
    }

    function onLayout(dc as Graphics.Dc) as Void {
        run.ep.onLayout(dc);
    }

    function nextPage(dir as Number) as Void {
        page = (page + dir + PAGES) % PAGES;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        if (run.state == DONE) {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawDone(dc);
            return;
        }
        if (page == 0) {
            run.ep.onUpdate(dc);
        } else {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawProfilePage(dc);
            // Alarme EndurancePro (popup) visible aussi sur le profil.
            run.ep.drawAlarmPopup(dc);
        }
        drawStateRing(dc);
    }

    function round() as Boolean {
        return System.getDeviceSettings().screenShape == System.SCREEN_SHAPE_ROUND;
    }

    // Anneau d'état avant le départ et en pause.
    function drawStateRing(dc as Graphics.Dc) as Void {
        var color;
        if (run.state == READY) {
            color = run.gpsOk ? Graphics.COLOR_GREEN : Graphics.COLOR_RED;
        } else if (run.state == PAUSED) {
            color = Graphics.COLOR_ORANGE;
        } else {
            return;
        }
        var w = dc.getWidth();
        var h = dc.getHeight();
        var pen = w > 300 ? 8 : 5;
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        if (dc has :setPenWidth) {
            dc.setPenWidth(pen);
        }
        if (round()) {
            dc.drawCircle(w / 2, h / 2, w / 2 - pen / 2);
        } else {
            dc.drawRectangle(pen / 2, pen / 2, w - pen, h - pen);
        }
        if (dc has :setPenWidth) {
            dc.setPenWidth(1);
        }
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
            var text = plan != null ? tpText(Rez.Strings.tp_no_profile) : run.status;
            dc.setColor(themeDim(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        drawHeader(dc, (h * 0.14).toNumber());
        drawFooter(dc, (h * 0.86).toNumber());
    }

    // En haut : nom de la course avant le départ ; « Pause » ; « Hors parcours · N m » ; passage, départ
    // ou tour pendant 5 s ; sinon écart au plan (+6' en rouge = 6 min de retard, avance en vert).
    function drawHeader(dc as Graphics.Dc, y as Number) as Void {
        var now = Time.now().value();
        if (run.state == READY) {
            drawLine(dc, y, run.plan != null ? run.plan.name : "Trail Planner", themeFg(), Graphics.FONT_XTINY);
        } else if (run.state == PAUSED) {
            drawLine(dc, y, tpText(Rez.Strings.tp_paused), Graphics.COLOR_ORANGE, Graphics.FONT_XTINY);
        } else if (run.offRoute) {
            drawLine(dc, y, tpText(Rez.Strings.tp_off_route) + " · " + run.offBy + " m", Graphics.COLOR_RED, Graphics.FONT_XTINY);
        } else if (now < run.msgUntil) {
            // « Passage · nom » trop long à cette hauteur de l'écran rond : le nom du point seul.
            var text = run.msg;
            if (run.msgShort.length() > 0 && dc.getTextWidthInPixels(text, Graphics.FONT_XTINY) > widthAt(dc, y, Graphics.FONT_XTINY)) {
                text = run.msgShort;
            }
            drawLine(dc, y, text, themeFg(), Graphics.FONT_XTINY);
        } else {
            var gap = run.planGap();
            if (gap != null) {
                var color = gap > 60 ? Graphics.COLOR_RED : (gap < -60 ? (darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN) : themeFg());
                drawLine(dc, y, signedMinutes(gap), color, Graphics.FONT_MEDIUM);
            }
        }
    }

    // En bas : touche à presser avant le départ ou en pause.
    function drawFooter(dc as Graphics.Dc, y as Number) as Void {
        if (run.state == READY) {
            if (run.gpsOk) {
                drawLine(dc, y, tpText(Rez.Strings.tp_start), darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN, Graphics.FONT_XTINY);
            } else {
                drawLine(dc, y, "GPS...", themeDim(), Graphics.FONT_XTINY);
            }
        } else if (run.state == PAUSED) {
            drawLine(dc, y, tpText(Rez.Strings.tp_resume_hint), themeDim(), Graphics.FONT_XTINY);
        }
    }

    // Largeur disponible (px) pour une ligne centrée à cette hauteur (écran rond : corde du cercle).
    function widthAt(dc as Graphics.Dc, y as Number, font) as Number {
        var w = dc.getWidth();
        if (!round()) {
            return w - 16;
        }
        var r = w / 2.0;
        var fh = dc.getFontHeight(font);
        var dy = (y < r ? r - (y - fh / 2) : (y + fh / 2) - r).toFloat();
        var half = dy < r ? Math.sqrt(r * r - dy * dy) : 0.0;
        return (2 * half - 8).toNumber();
    }

    // Une ligne centrée, raccourcie à la largeur de l'écran à cette hauteur (écran rond).
    function drawLine(dc as Graphics.Dc, y as Number, text as String, color, font) as Void {
        if (text.length() == 0) {
            return;
        }
        var w = dc.getWidth();
        var maxW = widthAt(dc, y, font);
        var t = text;
        while (t.length() > 1 && dc.getTextWidthInPixels(t, font) > maxW) {
            t = t.substring(0, t.length() - 1) as String;
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, font, t, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // --- Fin de la sortie ------------------------------------------------------------------------------

    function drawDone(dc as Graphics.Dc) as Void {
        var h = dc.getHeight();
        drawLine(dc, (h * 0.42).toNumber(), tpText(run.saved ? Rez.Strings.tp_saved : Rez.Strings.tp_discarded), themeFg(), Graphics.FONT_SMALL);
        drawLine(dc, (h * 0.60).toNumber(), tpText(Rez.Strings.tp_quit), themeDim(), Graphics.FONT_XTINY);
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

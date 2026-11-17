import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Écrans de la sortie, passés avec Haut / Bas (CompanionApp.showPage) :
// 0. EndurancePro (écran du champ EndurancePro 2.7.3, à l'identique) ;
// 1. profil de la course qui suit le coureur (zoom et couleurs des pentes dans le menu), écart au plan
//    en haut ;
// 2. carte : vue CompanionMapView (fond de carte Garmin) sur les montres à cartes ; sinon dessinée ici
//    (tracé seul, drawTrace).
// Avant le départ et en pause, un anneau au bord de l'écran donne l'état : rouge = GPS en recherche,
// vert = prêt (START), orange = pause. Le thème (clair / sombre) est celui d'EndurancePro.
class MainView extends WatchUi.View {
    var run as Run;
    var page = 0;

    function initialize(r as Run) {
        View.initialize();
        run = r;
    }

    function onLayout(dc as Graphics.Dc) as Void {
        run.ep.onLayout(dc);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        if (run.state == DONE) {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawDone(dc);
            return;
        }
        var h = dc.getHeight();
        if (page == 0) {
            run.ep.onUpdate(dc);
        } else if (page == 1) {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawProfilePage(dc);
            // Alarme EndurancePro (popup) visible aussi sur le profil.
            run.ep.drawAlarmPopup(dc);
        } else {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawTrace(dc, run);
            drawScale(dc, true);
            drawHeader(dc, run, (h * 0.12).toNumber(), true);
            drawFooter(dc, run, (h * 0.84).toNumber(), true);
            run.ep.drawAlarmPopup(dc);
        }
        drawStateRing(dc, run);
    }

    // --- Écran du profil -------------------------------------------------------------------------------

    function drawProfilePage(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var plan = run.plan;
        if (plan != null && plan.hasProfile()) {
            // Cadre du profil : il tient dans un écran rond (coins sur le cercle).
            var side = isRound() ? (w * 0.11).toNumber() : (w * 0.04).toNumber();
            var box = [side, (h * 0.22).toNumber(), w - side, (h * 0.72).toNumber()] as Array<Number>;
            var pos = run.state == READY ? 0.0 : run.dist;
            drawProfile(dc, plan, pos, zoomSpan(plan.total), slopesOn(), box);
        } else {
            var text = plan != null ? tpText(Rez.Strings.tp_no_profile) : run.status;
            dc.setColor(themeDim(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        drawHeader(dc, run, (h * 0.14).toNumber(), false);
        drawFooter(dc, run, (h * 0.86).toNumber(), false);
    }

    // --- Fin de la sortie ------------------------------------------------------------------------------

    function drawDone(dc as Graphics.Dc) as Void {
        var h = dc.getHeight();
        drawFitted(dc, (h * 0.42).toNumber(), tpText(run.saved ? Rez.Strings.tp_saved : Rez.Strings.tp_discarded), themeFg(), Graphics.FONT_SMALL, false);
        drawFitted(dc, (h * 0.60).toNumber(), tpText(Rez.Strings.tp_quit), themeDim(), Graphics.FONT_XTINY, false);
    }
}

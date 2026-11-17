import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Écrans de la sortie, passés avec Haut / Bas (CompanionApp.showPage) :
// 0. EndurancePro (écran du champ EndurancePro 2.7.3, à l'identique) ;
// 1. Trail Planner (écran du champ Trail Planner, à l'identique : écart, prochain point, barre du
//    tronçon, barrière, rappels nutrition, ravito) ;
// 2. profil de la course qui suit le coureur (zoom et couleurs des pentes dans le menu), écart au plan
//    en haut ;
// 3. carte : vue CompanionMapView (fond de carte Garmin) sur les montres à cartes ; sinon dessinée ici
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

    // Menu par-dessus ou retour : pas de bascule automatique sur l'écran Trail Planner pendant un menu.
    function onShow() as Void {
        var app = getApp();
        app.baseVisible = true;
    }

    function onHide() as Void {
        var app = getApp();
        app.baseVisible = false;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        if (run.state == DONE) {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawDone(dc);
            return;
        }
        var ep = run.ep;
        var top = ep.contentTop();
        var bottom = ep.contentBottom();
        if (page == 0) {
            run.ep.onUpdate(dc);
        } else if (page == 1) {
            // Écran Trail Planner (bandeaux d'EP compris).
            run.tp.onUpdate(dc);
        } else if (page == 2) {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawProfilePage(dc, top, bottom);
            ep.drawBands(dc);
        } else {
            dc.setColor(themeFg(), themeBg());
            dc.clear();
            drawTrace(dc, run, (top + bottom) / 2);
            // Bandeaux d'EP sur un fond uni, le tracé passant dessous.
            dc.setColor(themeBg(), themeBg());
            dc.fillRectangle(0, 0, dc.getWidth(), top);
            drawScale(dc, bottom - 10, true);
            drawHeader(dc, run, top + 12, true);
            drawFooter(dc, run, bottom - 32, true);
            ep.drawBands(dc);
        }
    }

    // --- Écran du profil -------------------------------------------------------------------------------

    // Profil entre les bandeaux d'EP (de top à bottom) : écart au plan en haut, profil, touche à presser
    // en bas avant le départ et en pause.
    function drawProfilePage(dc as Graphics.Dc, top as Number, bottom as Number) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var plan = run.plan;
        if (plan != null && plan.hasProfile()) {
            // Cadre du profil : il tient dans un écran rond (coins sur le cercle).
            var side = isRound() ? (w * 0.11).toNumber() : (w * 0.04).toNumber();
            var box = [side, top + 30, w - side, bottom - (run.state == RUNNING ? 16 : 30)] as Array<Number>;
            var pos = run.state == READY ? 0.0 : run.dist;
            drawProfile(dc, plan, pos, zoomSpan(plan.total), slopesOn(), box);
        } else {
            var text = plan != null ? tpText(Rez.Strings.tp_no_profile) : run.status;
            dc.setColor(themeDim(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        drawHeader(dc, run, top + 14, false);
        drawFooter(dc, run, bottom - 9, false);
    }

    // --- Fin de la sortie ------------------------------------------------------------------------------

    function drawDone(dc as Graphics.Dc) as Void {
        var h = dc.getHeight();
        drawFitted(dc, (h * 0.42).toNumber(), tpText(run.saved ? Rez.Strings.tp_saved : Rez.Strings.tp_discarded), themeFg(), Graphics.FONT_SMALL, false);
        drawFitted(dc, (h * 0.60).toNumber(), tpText(Rez.Strings.tp_quit), themeDim(), Graphics.FONT_XTINY, false);
    }
}

import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

// Écran de démarrage, façon Komoot :
// 1. liste : courses à venir et parcours de la bibliothèque synchronisés depuis l'app web (la course
//    envoyée à la montre en premier), « Sortie libre », « Réglages » ;
// 2. fiche du parcours choisi : le résumé d'avant départ du champ Trail Planner (nom, distance, D+, temps
//    prévu, départ, « Emporter au départ ») ; START = démarrer, appui long sur Haut = réglages, BACK = liste ;
// 3. écrans de course (EndurancePro, Trail Planner, profil, carte), en attente du GPS, puis START.
// Pendant une sortie, la liste ne reste jamais affichée (CompanionApp.onStartShown / restoreCourse).

// Ligne de la liste : « 42.1 km · D+2350 · 30/05 ».
function courseSub(dist as Number, dPlus as Number, start as Number) as String {
    var t = (dist / 1000.0).format("%.1f") + " km · D+" + dPlus;
    if (start > 0) {
        var d = Gregorian.info(new Time.Moment(start), Time.FORMAT_SHORT);
        t += " · " + (d.day as Number).format("%02d") + "/" + (d.month as Number).format("%02d");
    }
    return t;
}

class StartMenu extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({ :title => "Trail Planner" });
        var run = getRun();
        var list = run.courses();
        var focus = -1;
        for (var i = 0; i < list.size(); i++) {
            var c = list[i] as Array;
            addItem(new WatchUi.MenuItem(c[2] as String, courseSub(c[4] as Number, c[5] as Number, c[3] as Number), c[0], {}));
            if (c[6] == true) {
                focus = i;
            }
        }
        // Sans liste (synchronisation des parcours non activée sur le site) : la course envoyée à la montre.
        if (list.size() == 0) {
            var name = run.mainCourseName();
            if (name != null) {
                addItem(new WatchUi.MenuItem(name, tpText(Rez.Strings.tp_on_watch), "", {}));
            } else {
                addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_no_courses), run.status, :none, {}));
            }
        }
        addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_free_run), tpText(Rez.Strings.tp_free_sub), :free, {}));
        addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_settings), null, :settings, {}));
        if (focus >= 0) {
            setFocus(focus);
        }
    }

    function onShow() as Void {
        var app = getApp();
        app.startShown = true;
        app.onStartShown();
    }

    function onHide() as Void {
        var app = getApp();
        app.startShown = false;
    }
}

class StartDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        var app = getApp();
        // Sortie en cours : pas d'autre parcours (l'écran de course revient tout seul, onStartShown).
        if (getRun().active()) {
            return;
        }
        if (id == :settings) {
            WatchUi.pushView(new EnduranceProSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :free) {
            getRun().selectCourse(null);
            app.beginCourse();
        } else if (id == :none) {
            WatchUi.pushView(new EnduranceProSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);
        } else {
            getRun().selectCourse(id);
            app.showOverview();
        }
    }
}

// Fiche du parcours : START démarre, appui long sur Haut ouvre les réglages, BACK revient à la liste.
// En exploration (menu « Explorer la carte ») : les boutons vont à la carte Garmin, BACK revient à la vue
// d'ensemble.
class OverviewDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
        var key = evt.getKey();
        if (getApp().overviewExploring()) {
            if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
                getApp().stopExplore();
                return true;
            }
            return false;
        }
        if (key == WatchUi.KEY_ENTER) {
            getApp().beginCourse();
            return true;
        }
        return BehaviorDelegate.onKey(evt);
    }

    function onSelect() as Boolean {
        if (getApp().overviewExploring()) {
            return false;
        }
        getApp().beginCourse();
        return true;
    }

    function onBack() as Boolean {
        if (getApp().overviewExploring()) {
            getApp().stopExplore();
            return true;
        }
        getApp().endOverview();
        return false;
    }

    function onMenu() as Boolean {
        if (getApp().overviewExploring()) {
            return false;
        }
        WatchUi.pushView(new EnduranceProSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_UP);
        return true;
    }
}

// Bas de la fiche : distance, D+ et « START : démarrer » ; nom du parcours en haut (sur un fond, par-
// dessus la carte).
function drawOverviewText(dc as Graphics.Dc, run as Run) as Void {
    var h = dc.getHeight();
    var plan = run.plan;
    if (plan == null) {
        drawFitted(dc, h / 2, tpText(Rez.Strings.tp_loading), themeFg(), Graphics.FONT_SMALL, true);
        return;
    }
    drawFitted(dc, (h * 0.13).toNumber(), plan.name, themeFg(), Graphics.FONT_SMALL, true);
    var up = plan.dPlus;
    if (up < 0 && plan.hasClimb()) {
        up = plan.climbUp[plan.climbUp.size() - 1];
    }
    drawFitted(dc, (h * 0.78).toNumber(), (plan.total / 1000.0).format("%.1f") + " km · D+" + (up > 0 ? up : 0), themeFg(), Graphics.FONT_SMALL, true);
    drawFitted(dc, (h * 0.89).toNumber(), tpText(Rez.Strings.tp_choose), darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN, Graphics.FONT_XTINY, true);
}

// Fiche du parcours : le résumé d'avant départ du champ Trail Planner. Nom, « 23.4 km · D+1245 », temps
// prévu, heure de départ (course seulement : « Départ libre » sans heure), « Emporter au départ » et le
// sac du premier tronçon (4 lignes au plus), puis « START : démarrer ». Lignes centrées verticalement.
class CourseOverview extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var run = getRun();
        var tp = run.tp;
        var h = dc.getHeight();
        var fg = themeFg();
        dc.setColor(fg, themeBg());
        dc.clear();
        var plan = run.plan;
        if (plan == null) {
            drawFitted(dc, h / 2, tpText(Rez.Strings.tp_loading), fg, Graphics.FONT_SMALL, false);
            return;
        }
        var up = plan.dPlus;
        if (up < 0 && plan.hasClimb()) {
            up = plan.climbUp[plan.climbUp.size() - 1];
        }
        var stats = (plan.total / 1000.0).format("%.1f") + " km" + (up >= 0 ? " · D+" + up : "");
        var lines = [
            [plan.name, Graphics.FONT_XTINY, fg],
            [stats, Graphics.FONT_SMALL, fg],
            ["Temps prévu " + tp.shortDuration(plan.finishTime()), Graphics.FONT_XTINY, fg]
        ] as Array;
        if (plan.isRace()) {
            lines.add(plan.start > 0 ? ["Départ " + tp.clock(plan.start), Graphics.FONT_SMALL, fg] : ["Départ libre", Graphics.FONT_XTINY, fg]);
        }
        var l0 = plan.legFromCp(-1);
        if (l0 >= 0) {
            var rows = tp.packItems(dc, plan.bag(l0), Graphics.FONT_XTINY, 4);
            if (rows.size() > 0) {
                lines.add(["Emporter au départ", Graphics.FONT_XTINY, Graphics.COLOR_ORANGE]);
            }
            for (var i = 0; i < rows.size(); i++) {
                lines.add([rows[i], Graphics.FONT_XTINY, fg]);
            }
        }
        // Hauteur totale, puis lignes de haut en bas autour du milieu (au-dessus de « START »).
        var total = 0;
        for (var i = 0; i < lines.size(); i++) {
            total += dc.getFontHeight((lines[i] as Array)[1]);
        }
        var y = (h * 0.47).toNumber() - total / 2;
        for (var i = 0; i < lines.size(); i++) {
            var line = lines[i] as Array;
            var fh = dc.getFontHeight(line[1]);
            drawFitted(dc, y + fh / 2, line[0] as String, line[2], line[1], false);
            y += fh;
        }
        drawFitted(dc, (h * 0.89).toNumber(), tpText(Rez.Strings.tp_choose), darkTheme() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN, Graphics.FONT_XTINY, false);
    }
}

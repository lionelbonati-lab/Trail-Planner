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
// 2. fiche du parcours choisi : la carte Garmin du parcours (tracé seul sur les montres sans cartes),
//    nom, distance, D+, date ; START = démarrer, appui long sur Haut = réglages, BACK = liste ;
// 3. écrans de course (EndurancePro, Trail Planner, profil, carte), en attente du GPS, puis START.

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
class OverviewDelegate extends WatchUi.BehaviorDelegate {
    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
        if (evt.getKey() == WatchUi.KEY_ENTER) {
            getApp().beginCourse();
            return true;
        }
        return BehaviorDelegate.onKey(evt);
    }

    function onSelect() as Boolean {
        getApp().beginCourse();
        return true;
    }

    function onBack() as Boolean {
        getApp().endOverview();
        return false;
    }

    function onMenu() as Boolean {
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

// Tracé du parcours entier, ajusté à l'écran (montres sans cartes) : magenta, ravitos, bases de vie.
function drawRouteFit(dc as Graphics.Dc, run as Run, top as Number, bottom as Number) as Void {
    var route = run.route;
    if (route == null || route.size() < 2) {
        return;
    }
    var w = dc.getWidth();
    var laMin = route.lat[0];
    var laMax = laMin;
    var loMin = route.lon[0];
    var loMax = loMin;
    for (var i = 1; i < route.size(); i++) {
        var la = route.lat[i];
        var lo = route.lon[i];
        if (la < laMin) { laMin = la; }
        if (la > laMax) { laMax = la; }
        if (lo < loMin) { loMin = lo; }
        if (lo > loMax) { loMax = lo; }
    }
    var cosLat = Math.cos((laMin + laMax) / 2.0 / 100000.0 * Math.PI / 180.0);
    var spanX = (loMax - loMin) * cosLat;
    var spanY = (laMax - laMin).toFloat();
    var side = isRound() ? (w * 0.2).toNumber() : 10;
    var bw = w - 2 * side;
    var bh = bottom - top;
    // Échelle (px par 1e-5 degré) : le parcours entier tient dans le cadre.
    var k = 1.0;
    if (spanX * bh > spanY * bw) {
        k = spanX > 0 ? bw / spanX : 1.0;
    } else {
        k = spanY > 0 ? bh / spanY : 1.0;
    }
    var cx = w / 2.0;
    var cy = (top + bottom) / 2.0;
    var mLo = (loMin + loMax) / 2.0;
    var mLa = (laMin + laMax) / 2.0;
    if (dc has :setPenWidth) {
        dc.setPenWidth(w > 300 ? 4 : 3);
    }
    dc.setColor(ROUTE_COLOR, Graphics.COLOR_TRANSPARENT);
    var px = 0;
    var py = 0;
    for (var i = 0; i < route.size(); i++) {
        var x = (cx + (route.lon[i] - mLo) * cosLat * k).toNumber();
        var y = (cy - (route.lat[i] - mLa) * k).toNumber();
        if (i > 0) {
            dc.drawLine(px, py, x, y);
        }
        px = x;
        py = y;
    }
    if (dc has :setPenWidth) {
        dc.setPenWidth(1);
    }
    var plan = run.plan;
    if (plan != null) {
        var n = plan.cpDist.size();
        for (var c = 0; c < n; c++) {
            var isBase = plan.cpBase[c];
            if (!isBase && !plan.cpKind[c].equals("r")) {
                continue;
            }
            var p = route.at(plan.cpDist[c].toFloat());
            var x = (cx + (p[1] - mLo) * cosLat * k).toNumber();
            var y = (cy - (p[0] - mLa) * k).toNumber();
            dc.setColor(themeBg(), Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(x, y, 6);
            dc.setColor(isBase ? BASE_COLOR : RAVITO_COLOR, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(x, y, 4);
        }
    }
}

// Fiche du parcours sans fond de carte Garmin.
class CourseOverview extends WatchUi.View {
    function initialize() {
        View.initialize();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var run = getRun();
        var h = dc.getHeight();
        dc.setColor(themeFg(), themeBg());
        dc.clear();
        drawRouteFit(dc, run, (h * 0.22).toNumber(), (h * 0.70).toNumber());
        drawOverviewText(dc, run);
    }
}

import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.Position;
import Toybox.System;
import Toybox.WatchUi;

// Écran Carte (4e écran) : le parcours de la course (tracé fin envoyé par l'app web), les ravitos, bases
// de vie et l'arrivée, et ta position, carte orientée nord, centrée sur toi à l'échelle choisie dans le
// menu (largeur de l'écran : 200 m à 5 km).
// - Montres à cartes : fond de carte Garmin de la montre (WatchUi.MapView, classe CompanionMapView,
//   annotation (:map)) ; « Explorer la carte » (menu) passe la carte en mode exploration Garmin
//   (déplacer, zoomer avec les boutons), BACK revient au suivi.
// - Autres montres (Forerunner 255 et 265, annotation (:nomap) dans monkey.jungle) : tracé seul, sur
//   le fond du thème (drawTrace, dessiné par MainView).

// Largeur de l'écran à chaque échelle (m), choisie dans le menu (Trail Planner › Échelle de la carte).
const MAP_SCALES = [200, 500, 1000, 2000, 5000] as Array<Number>;
// Couleur du parcours sur la carte (magenta, comme un parcours Garmin) ; partie faite en gris.
const ROUTE_COLOR = 0xFF00FF;

function mapScaleLevel() as Number {
    var z = Application.Properties.getValue("mapScale");
    return (z instanceof Number && z >= 0 && z < MAP_SCALES.size()) ? z as Number : 2;
}

function mapScaleLabel(z as Number) as String {
    var m = MAP_SCALES[z];
    return m < 1000 ? m + " m" : (m / 1000) + " km";
}

// Position du coureur ([lat, lon] en degrés) : dernier relevé GPS, sinon départ du parcours.
function runnerDegrees(run as Run) as Array<Double> or Null {
    if (run.lastLoc != null) {
        return (run.lastLoc as Position.Location).toDegrees();
    }
    var r = run.route;
    if (r != null) {
        return [r.lat[0] / 100000.0d, r.lon[0] / 100000.0d] as Array<Double>;
    }
    return null;
}

// Flèche du coureur (cap GPS, nord en haut) au point (x, y).
function drawRunnerArrow(dc as Graphics.Dc, x as Number, y as Number, heading as Float, size as Number) as Void {
    var s = Math.sin(heading);
    var c = Math.cos(heading);
    var pts = [] as Array;
    // Pointe, puis les deux coins arrière (à ±140°), puis le creux de la flèche.
    var shape = [[0.0, -1.0], [0.75, 0.85], [0.0, 0.45], [-0.75, 0.85]];
    for (var i = 0; i < shape.size(); i++) {
        var px = shape[i][0] * size;
        var py = shape[i][1] * size;
        pts.add([(x + px * c - py * s).toNumber(), (y + px * s + py * c).toNumber()]);
    }
    dc.setColor(themeBg(), Graphics.COLOR_TRANSPARENT);
    dc.fillCircle(x, y, size + 2);
    dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
    dc.fillPolygon(pts);
}

// Échelle au bas de la carte, au-dessus du bandeau d'EP (« 1 km » = largeur de l'écran).
function drawScale(dc as Graphics.Dc, y as Number, boxed as Boolean) as Void {
    drawFitted(dc, y, mapScaleLabel(mapScaleLevel()), themeDim(), Graphics.FONT_XTINY, boxed);
}

// --- Tracé seul (montres sans cartes) ------------------------------------------------------------------

// Parcours autour du coureur, nord en haut : partie faite en gris, à venir en magenta, points de
// passage (ravito rond orange, base de vie carré rouge, arrivée), flèche du coureur au centre.
function drawTrace(dc as Graphics.Dc, run as Run, cy as Number) as Void {
    var w = dc.getWidth();
    var h = dc.getHeight();
    var route = run.route;
    var center = runnerDegrees(run);
    if (route == null || center == null) {
        dc.setColor(themeDim(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, run.plan == null ? run.status : tpText(Rez.Strings.tp_no_route),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        return;
    }
    var cLat = center[0];
    var cLon = center[1];
    // Pixels par 1e-5 degré, en latitude et en longitude.
    var k = w.toFloat() / MAP_SCALES[mapScaleLevel()];
    var ky = 1.1132 * k;
    var kx = 1.1132 * Math.cos(cLat * Math.PI / 180.0) * k;
    var la0 = cLat * 100000.0;
    var lo0 = cLon * 100000.0;
    var cx = w / 2;
    var done = run.state == READY ? -1.0 : run.dist;
    if (dc has :setPenWidth) {
        dc.setPenWidth(w > 300 ? 5 : 3);
    }
    var px = 0;
    var py = 0;
    for (var i = 0; i < route.size(); i++) {
        var x = (cx + (route.lon[i] - lo0) * kx).toNumber();
        var y = (cy - (route.lat[i] - la0) * ky).toNumber();
        // Segment tracé s'il touche l'écran (marge de la largeur de l'écran).
        if (i > 0 && !((x < -w && px < -w) || (x > 2 * w && px > 2 * w) || (y < -h && py < -h) || (y > 2 * h && py > 2 * h))) {
            dc.setColor(route.d[i] <= done ? themeDim() : ROUTE_COLOR, Graphics.COLOR_TRANSPARENT);
            dc.drawLine(px, py, x, y);
        }
        px = x;
        py = y;
    }
    if (dc has :setPenWidth) {
        dc.setPenWidth(1);
    }
    // Points de passage.
    var plan = run.plan;
    if (plan != null) {
        var r = w > 300 ? 6 : 4;
        var n = plan.cpDist.size();
        for (var c = 0; c < n; c++) {
            var isBase = plan.cpBase[c];
            var isRavito = plan.cpKind[c].equals("r");
            if (!isBase && !isRavito && c != n - 1) {
                continue;
            }
            var p = route.at(plan.cpDist[c].toFloat());
            var x = (cx + (p[1] - lo0) * kx).toNumber();
            var y = (cy - (p[0] - la0) * ky).toNumber();
            if (x < -r || x > w + r || y < -r || y > h + r) {
                continue;
            }
            var passed = plan.cpDist[c] <= done;
            dc.setColor(themeBg(), Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(x, y, r + 2);
            dc.setColor(passed ? themeDim() : (isBase ? BASE_COLOR : (isRavito ? RAVITO_COLOR : themeFg())), Graphics.COLOR_TRANSPARENT);
            if (isBase) {
                dc.fillRectangle(x - r, y - r, 2 * r + 1, 2 * r + 1);
            } else {
                dc.fillCircle(x, y, r);
            }
        }
    }
    drawRunnerArrow(dc, cx, cy, run.heading, w > 300 ? 13 : 9);
}

// --- Fond de carte Garmin (montres à cartes) -------------------------------------------------------------

// Fond de carte Garmin possible sur cette montre.
(:map)
function mapSupported() as Boolean {
    return WatchUi has :MapView;
}

(:nomap)
function mapSupported() as Boolean {
    return false;
}

(:map)
function createMapView(run as Run) {
    if (WatchUi has :MapView) {
        return new CompanionMapView(run);
    }
    return null;
}

(:nomap)
function createMapView(run as Run) {
    return null;
}

(:map)
class CompanionMapView extends WatchUi.MapView {
    var run as Run;
    var shownRoute = null;     // tracé déjà posé sur la carte (MapRoute)
    var shownPlan = null;      // plan des repères déjà posés
    var cLat = 0.0d;           // centre et échelle de la zone affichée
    var cLon = 0.0d;
    var shownScale = -1;
    var exploring = false;     // mode exploration Garmin (déplacer, zoomer)
    var overview = false;      // fiche du parcours à l'écran de démarrage : parcours entier
    var fitted = false;        // parcours entier déjà cadré

    function initialize(r as Run) {
        MapView.initialize();
        run = r;
        setMapMode(WatchUi.MAP_MODE_PREVIEW);
        var s = System.getDeviceSettings();
        setScreenVisibleArea(0, 0, s.screenWidth, s.screenHeight);
    }

    function onLayout(dc as Graphics.Dc) as Void {
        MapView.onLayout(dc);
        run.ep.onLayout(dc);
    }

    function onShow() as Void {
        MapView.onShow();
        var app = getApp();
        app.baseVisible = true;
    }

    function onHide() as Void {
        MapView.onHide();
        var app = getApp();
        app.baseVisible = false;
    }

    // Exploration (menu « Explorer la carte ») ou retour au suivi du coureur (BACK).
    function setExploring(on as Boolean) as Void {
        exploring = on;
        setMapMode(on ? WatchUi.MAP_MODE_BROWSE : WatchUi.MAP_MODE_PREVIEW);
        shownScale = -1;
        WatchUi.requestUpdate();
    }

    // Fiche du parcours (écran de démarrage) : parcours entier, sans suivi ni bandeaux.
    function setOverview(on as Boolean) as Void {
        overview = on;
        fitted = false;
        shownScale = -1;
        exploring = false;
        setMapMode(WatchUi.MAP_MODE_PREVIEW);
    }

    // Cadre le parcours entier (avec une marge de 15 %).
    function fitRoute() as Boolean {
        var r = run.route;
        if (r == null || r.size() < 2) {
            return false;
        }
        var laMin = r.lat[0];
        var laMax = laMin;
        var loMin = r.lon[0];
        var loMax = loMin;
        for (var i = 1; i < r.size(); i++) {
            if (r.lat[i] < laMin) { laMin = r.lat[i]; }
            if (r.lat[i] > laMax) { laMax = r.lat[i]; }
            if (r.lon[i] < loMin) { loMin = r.lon[i]; }
            if (r.lon[i] > loMax) { loMax = r.lon[i]; }
        }
        var mla = (laMax - laMin) * 0.15 + 50;
        var mlo = (loMax - loMin) * 0.15 + 50;
        setMapVisibleArea(
            new Position.Location({ :latitude => (laMax + mla) / 100000.0d, :longitude => (loMin - mlo) / 100000.0d, :format => :degrees }),
            new Position.Location({ :latitude => (laMin - mla) / 100000.0d, :longitude => (loMax + mlo) / 100000.0d, :format => :degrees })
        );
        return true;
    }

    // Parcours et repères posés une fois (et de nouveau quand le plan ou le tracé change).
    function refreshRoute() as Void {
        var route = run.route;
        if (route == shownRoute && run.plan == shownPlan) {
            return;
        }
        shownRoute = route;
        shownPlan = run.plan;
        var line = new WatchUi.MapPolyline();
        line.setColor(ROUTE_COLOR);
        line.setWidth(System.getDeviceSettings().screenWidth > 300 ? 5 : 3);
        var markers = [] as Array<WatchUi.MapMarker>;
        if (route != null) {
            for (var i = 0; i < route.size(); i++) {
                line.addLocation(new Position.Location({
                    :latitude => route.lat[i] / 100000.0d,
                    :longitude => route.lon[i] / 100000.0d,
                    :format => :degrees
                }));
            }
            var plan = run.plan;
            if (plan != null) {
                var n = plan.cpDist.size();
                for (var c = 0; c < n; c++) {
                    if (!plan.cpBase[c] && !plan.cpKind[c].equals("r") && c != n - 1) {
                        continue;
                    }
                    var p = route.at(plan.cpDist[c].toFloat());
                    var marker = new WatchUi.MapMarker(new Position.Location({
                        :latitude => p[0] / 100000.0d,
                        :longitude => p[1] / 100000.0d,
                        :format => :degrees
                    }));
                    marker.setIcon(WatchUi.MAP_MARKER_ICON_PIN, 0, 0);
                    markers.add(marker);
                }
            }
        }
        setPolyline(line);
        setMapMarker(markers);
    }

    // Zone affichée centrée sur le coureur, à l'échelle du menu ; recentrée dès qu'il a bougé de 5 m.
    function follow() as Void {
        var center = runnerDegrees(run);
        if (center == null) {
            return;
        }
        var z = mapScaleLevel();
        var lat = center[0];
        var lon = center[1];
        var ky = 111320.0d;
        var kx = 111320.0d * Math.cos(lat * Math.PI / 180.0d);
        var moved = Math.sqrt(Math.pow((lat - cLat) * ky, 2) + Math.pow((lon - cLon) * kx, 2));
        if (z == shownScale && moved < 5) {
            return;
        }
        cLat = lat;
        cLon = lon;
        shownScale = z;
        var half = MAP_SCALES[z] / 2.0d;
        var dLat = half / ky;
        var dLon = kx > 0 ? half / kx : dLat;
        setMapVisibleArea(
            new Position.Location({ :latitude => lat + dLat, :longitude => lon - dLon, :format => :degrees }),
            new Position.Location({ :latitude => lat - dLat, :longitude => lon + dLon, :format => :degrees })
        );
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        refreshRoute();
        if (overview) {
            if (!fitted) {
                fitted = fitRoute();
            }
            MapView.onUpdate(dc);
            drawOverviewText(dc, run);
            return;
        }
        // Sortie du mode exploration par la carte elle-même : retour au suivi (lecture du mode seulement si
        // la montre la propose).
        if (exploring && self has :getMapMode) {
            if (method(:getMapMode).invoke() == WatchUi.MAP_MODE_PREVIEW) {
                exploring = false;
                shownScale = -1;
            }
        }
        if (!exploring) {
            follow();
        }
        MapView.onUpdate(dc);
        var w = dc.getWidth();
        var h = dc.getHeight();
        var ep = run.ep;
        var top = ep.contentTop();
        var bottom = ep.contentBottom();
        // Bandeaux d'EP sur un fond uni, la carte entre les deux.
        dc.setColor(themeBg(), themeBg());
        dc.fillRectangle(0, 0, w, top);
        if (!exploring) {
            drawRunnerArrow(dc, w / 2, h / 2, run.heading, w > 300 ? 13 : 9);
            drawScale(dc, bottom - 10, true);
        }
        drawHeader(dc, run, top + 12, true);
        drawFooter(dc, run, bottom - 32, true);
        ep.drawBands(dc);
        drawStateRing(dc, run);
    }
}

import Toybox.Lang;
import Toybox.Math;

// Mètres par degré de latitude (projection locale du tracé).
const ROUTE_KY = 110540.0d;

// Plan compact envoyé par l'app web (format « TP1 », voir src/lib/watch.ts) :
//   TP1
//   N|<nom>
//   S|<départ prévu, s Unix>|<distance totale, m>|<rappel nutrition, min>
//   K|<d>:<t>,<d>:<t>,... courbe distance (m) -> temps de déplacement prévu (s, arrêts exclus)
//   C|<dist m>|<prévu s>|<barrière s Unix ou 0>|<type r/s/c/i>|<nom>|<arrêt s>
//   G|<tolérance m>|<d0>:<lat0>:<lon0>|<dd>,<dlat>,<dlon>,...   tracé simplifié (lat / lon en
//     1e-5 degré, puis écarts d'un sommet au suivant) pour caler la position GPS sur le parcours
// Temps prévu à une distance d = K interpolé + arrêts des points situés avant d.
class Plan {
    var name as String = "";
    var start as Number = 0;
    var total as Number = 0;
    var fuelMin as Number = 0;
    var curveD as Array<Number> = [] as Array<Number>;
    var curveT as Array<Number> = [] as Array<Number>;
    var cpDist as Array<Number> = [] as Array<Number>;
    var cpPlan as Array<Number> = [] as Array<Number>;
    var cpCut as Array<Number> = [] as Array<Number>;
    var cpKind as Array<String> = [] as Array<String>;
    var cpName as Array<String> = [] as Array<String>;
    var cpStop as Array<Number> = [] as Array<Number>;
    // Tracé simplifié (ligne G) : distance le long du parcours (m) et position de chaque sommet (m)
    // par rapport au premier (x vers l'est, y vers le nord).
    var routeD as Array<Number> = [] as Array<Number>;
    var routeX as Array<Number> = [] as Array<Number>;
    var routeY as Array<Number> = [] as Array<Number>;
    var routeTol as Number = 0;
    var lat0 as Double = 0.0d;
    var lon0 as Double = 0.0d;
    var kx as Double = 0.0d;      // mètres par degré de longitude à lat0

    function initialize() {
    }

    function hasRoute() as Boolean {
        return routeD.size() >= 2;
    }

    // Écart toléré (m) entre la position et le tracé simplifié avant d'être « hors parcours ».
    function onRouteMax() as Float {
        return (routeTol + 50).toFloat();
    }

    // Calage d'une position GPS (degrés) sur les segments du tracé situés entre from et to (m).
    // Parmi les segments à moins de maxOff m, garde celui dont la distance plausible est la plus
    // proche de `expected` (coût = écart + w × différence). Distance plausible : `expected` bornée à
    // la projection ± le « mou » du segment (longueur réelle − corde, grand là où des lacets ont été
    // simplifiés), elle-même bornée au segment.
    // Renvoie [distance calée (m) ou null, écart minimal au tracé (m) ou -1].
    function locate(lat as Numeric, lon as Numeric, from as Float, to as Float, expected as Float, w as Float, maxOff as Float) as Array {
        var px = ((lon - lon0) * kx).toFloat();
        var py = ((lat - lat0) * ROUTE_KY).toFloat();
        var n = routeD.size();
        // Dernier sommet situé avant from (recherche dichotomique).
        var lo = 0;
        var hi = n - 1;
        while (hi - lo > 1) {
            var mid = (lo + hi) / 2;
            if (routeD[mid] <= from) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        var best = null;
        var bestCost = 0.0;
        var minOff = -1.0;
        for (var i = lo; i < n - 1; i++) {
            if (routeD[i] > to) {
                break;
            }
            var ax = routeX[i].toFloat();
            var ay = routeY[i].toFloat();
            var bx = routeX[i + 1] - ax;
            var by = routeY[i + 1] - ay;
            var len2 = bx * bx + by * by;
            var t = len2 > 0 ? ((px - ax) * bx + (py - ay) * by) / len2 : 0.0;
            if (t < 0.0) {
                t = 0.0;
            } else if (t > 1.0) {
                t = 1.0;
            }
            var dx = px - (ax + t * bx);
            var dy = py - (ay + t * by);
            var off = Math.sqrt(dx * dx + dy * dy).toFloat();
            if (minOff < 0 || off < minOff) {
                minOff = off;
            }
            if (off > maxOff) {
                continue;
            }
            var d0 = routeD[i].toFloat();
            var d1 = routeD[i + 1].toFloat();
            var along = d0 + t * (d1 - d0);
            var slack = (d1 - d0) - Math.sqrt(len2).toFloat();
            if (slack < 0.0) {
                slack = 0.0;
            }
            slack += 20.0;
            var low = along - slack;
            if (low < d0) {
                low = d0;
            }
            var high = along + slack;
            if (high > d1) {
                high = d1;
            }
            var est = expected < low ? low : (expected > high ? high : expected);
            var gap = est - expected;
            if (gap < 0) {
                gap = -gap;
            }
            var cost = off + w * gap;
            if (best == null || cost < bestCost) {
                best = est;
                bestCost = cost;
            }
        }
        return [best, minOff];
    }

    // Temps prévu (s depuis le départ) à la distance d (m) : courbe interpolée + arrêts déjà faits.
    function plannedAt(d as Float) as Float {
        var n = curveD.size();
        if (n < 2) {
            return 0.0;
        }
        // Recherche dichotomique du segment [lo, lo + 1] contenant d.
        var lo = 0;
        var hi = n - 1;
        if (d <= curveD[0]) {
            hi = 1;
        } else if (d >= curveD[n - 1]) {
            lo = n - 2;
        } else {
            while (hi - lo > 1) {
                var mid = (lo + hi) / 2;
                if (curveD[mid] <= d) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
        }
        hi = lo + 1;
        var d0 = curveD[lo].toFloat();
        var d1 = curveD[hi].toFloat();
        var f = d1 > d0 ? (d - d0) / (d1 - d0) : 0.0;
        if (f < 0.0) {
            f = 0.0;
        }
        if (f > 1.0) {
            f = 1.0;
        }
        var t = curveT[lo] + f * (curveT[hi] - curveT[lo]);
        for (var c = 0; c < cpDist.size(); c++) {
            if (cpDist[c] < d) {
                t += cpStop[c];
            }
        }
        return t;
    }

    // Temps prévu à l'arrivée (s).
    function finishTime() as Number {
        var t = curveT.size() > 0 ? curveT[curveT.size() - 1] : 0;
        for (var c = 0; c < cpStop.size(); c++) {
            if (cpDist[c] < total) {
                t += cpStop[c];
            }
        }
        return t;
    }
}

// Découpe une chaîne selon un séparateur.
function splitText(text as String, sep as String) as Array<String> {
    var out = [] as Array<String>;
    var rest = text;
    var i = rest.find(sep);
    while (i != null) {
        out.add(rest.substring(0, i) as String);
        rest = rest.substring(i + sep.length(), rest.length()) as String;
        i = rest.find(sep);
    }
    out.add(rest);
    return out;
}

function toNum(s as String) as Number {
    var n = s.toNumber();
    return n == null ? 0 : n;
}

// Ligne G : premier sommet « d:lat:lon » (lat / lon en 1e-5 degré) puis écarts « dd,dlat,dlon,... ».
// Lecture au fil de la chaîne, sans tableau intermédiaire (mémoire).
function parseRoute(p as Plan, tol as Number, origin as String, data as String) as Void {
    var o = splitText(origin, ":");
    if (o.size() != 3) {
        return;
    }
    var d = toNum(o[0]);
    var lat = toNum(o[1]);
    var lon = toNum(o[2]);
    var la0 = lat;
    var lo0 = lon;
    p.lat0 = la0 / 100000.0d;
    p.lon0 = lo0 / 100000.0d;
    p.kx = 111320.0d * Math.cos(p.lat0 * Math.PI / 180.0d);
    p.routeTol = tol;
    p.routeD.add(d);
    p.routeX.add(0);
    p.routeY.add(0);
    var vals = [0, 0, 0] as Array<Number>;
    var k = 0;
    var rest = data;
    var i = rest.find(",");
    while (true) {
        vals[k] = toNum(i != null ? rest.substring(0, i) as String : rest);
        k++;
        if (k == 3) {
            d += vals[0];
            lat += vals[1];
            lon += vals[2];
            p.routeD.add(d);
            p.routeX.add(((lon - lo0) * p.kx / 100000.0d).toNumber());
            p.routeY.add(((lat - la0) * ROUTE_KY / 100000.0d).toNumber());
            k = 0;
        }
        if (i == null) {
            break;
        }
        rest = rest.substring(i + 1, rest.length()) as String;
        i = rest.find(",");
    }
}

// Lit le texte du plan ; renvoie null s'il n'est pas reconnu.
function parsePlan(text as String) as Plan or Null {
    var lines = splitText(text, "\n");
    if (lines.size() < 4 || !lines[0].equals("TP1")) {
        return null;
    }
    var p = new Plan();
    for (var li = 1; li < lines.size(); li++) {
        var parts = splitText(lines[li], "|");
        var tag = parts[0];
        if (tag.equals("N") && parts.size() >= 2) {
            p.name = parts[1];
        } else if (tag.equals("S") && parts.size() >= 4) {
            p.start = toNum(parts[1]);
            p.total = toNum(parts[2]);
            p.fuelMin = toNum(parts[3]);
        } else if (tag.equals("K") && parts.size() >= 2) {
            var values = splitText(parts[1], ",");
            for (var k = 0; k < values.size(); k++) {
                var pair = splitText(values[k], ":");
                if (pair.size() == 2) {
                    p.curveD.add(toNum(pair[0]));
                    p.curveT.add(toNum(pair[1]));
                }
            }
        } else if (tag.equals("C") && parts.size() >= 6) {
            p.cpDist.add(toNum(parts[1]));
            p.cpPlan.add(toNum(parts[2]));
            p.cpCut.add(toNum(parts[3]));
            p.cpKind.add(parts[4]);
            p.cpName.add(parts[5]);
            p.cpStop.add(parts.size() >= 7 ? toNum(parts[6]) : 0);
        } else if (tag.equals("G") && parts.size() >= 4) {
            parseRoute(p, toNum(parts[1]), parts[2], parts[3]);
        }
    }
    if (p.curveD.size() < 2 || p.total <= 0) {
        return null;
    }
    return p;
}

import Toybox.Lang;
import Toybox.Math;

// Mètres par degré de latitude (projection locale du tracé).
const ROUTE_KY = 110540.0d;

// Plan de la course, lu dans le document du code montre (le même que pour le champ de données) :
// - champ `w`, plan compact « TP1 » (voir src/lib/watch.ts) ; l'appli n'en lit que les lignes N, S, K, C,
//   E et G, comme le champ (garmin/TrailPlannerField/source/Plan.mc, dont ce fichier reprend la lecture
//   et le calage GPS) ;
// - champ `wp`, profil fin « TPP1|<tolérance>|<d0>:<alt0>|<dd>,<dz>,... » (watchProfile côté web) :
//   altitude (m) le long du parcours. Sans lui (plan publié par une ancienne version du site), le profil
//   est tiré de la ligne E (D+ et D- cumulés) : forme juste, altitude relative au départ.
class Plan {
    var name as String = "";
    var start as Number = 0;
    var total as Number = 0;
    var kind as String = "";      // "c" course, "p" parcours d'entraînement
    var dPlus as Number = -1;
    var dMinus as Number = -1;
    var curveD as Array<Number> = [] as Array<Number>;
    var curveT as Array<Number> = [] as Array<Number>;
    var cpDist as Array<Number> = [] as Array<Number>;
    var cpKind as Array<String> = [] as Array<String>;
    var cpName as Array<String> = [] as Array<String>;   // nom (écran « Passage · nom »), pas sur le profil
    var cpStop as Array<Number> = [] as Array<Number>;
    var cpBase as Array<Boolean> = [] as Array<Boolean>;
    // Tracé simplifié (ligne G) : distance le long du parcours (m) et position de chaque sommet (m)
    // par rapport au premier (x vers l'est, y vers le nord).
    var routeD as Array<Number> = [] as Array<Number>;
    var routeX as Array<Number> = [] as Array<Number>;
    var routeY as Array<Number> = [] as Array<Number>;
    var routeTol as Number = 0;
    var lat0 as Double = 0.0d;
    var lon0 as Double = 0.0d;
    var kx as Double = 0.0d;
    // Dénivelé (ligne E) : D+ et D- cumulés (m) à chaque distance (m).
    var climbD as Array<Number> = [] as Array<Number>;
    var climbUp as Array<Number> = [] as Array<Number>;
    var climbDn as Array<Number> = [] as Array<Number>;
    // Profil fin (champ wp) : distance (m) et altitude (m) de chaque sommet.
    var profD as Array<Number> = [] as Array<Number>;
    var profA as Array<Number> = [] as Array<Number>;

    function initialize() {
    }

    function hasRoute() as Boolean {
        return routeD.size() >= 2;
    }

    // Profil disponible (champ wp, sinon ligne E).
    function hasProfile() as Boolean {
        return profD.size() >= 2 || climbD.size() >= 2;
    }

    // Altitudes réelles (champ wp) ; sinon altitudes relatives au départ (ligne E).
    function realAltitude() as Boolean {
        return profD.size() >= 2;
    }

    // Altitude (m) à la distance d (m).
    function altAt(d as Float) as Float {
        if (profD.size() >= 2) {
            return interp(profD, profA, d);
        }
        if (climbD.size() >= 2) {
            return interp(climbD, climbUp, d) - interp(climbD, climbDn, d);
        }
        return 0.0;
    }

    // Écart toléré (m) entre la position et le tracé simplifié avant d'être « hors parcours ».
    function onRouteMax() as Float {
        return (routeTol + 50).toFloat();
    }

    // Calage d'une position GPS (degrés) sur les segments du tracé situés entre from et to (m), comme le
    // champ : parmi les segments à moins de maxOff m, celui dont la distance plausible est la plus proche
    // de `expected` (coût = écart + w × différence).
    // Renvoie [distance calée (m) ou null, écart minimal au tracé (m) ou -1].
    function locate(lat as Numeric, lon as Numeric, from as Float, to as Float, expected as Float, w as Float, maxOff as Float) as Array {
        var px = ((lon - lon0) * kx).toFloat();
        var py = ((lat - lat0) * ROUTE_KY).toFloat();
        var n = routeD.size();
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
        if (curveD.size() < 2) {
            return 0.0;
        }
        var t = interp(curveD, curveT, d);
        for (var c = 0; c < cpDist.size(); c++) {
            if (cpDist[c] < d) {
                t += cpStop[c];
            }
        }
        return t;
    }
}

// Valeur de ys à l'abscisse x, interpolée entre deux sommets (xs croissants), bornée aux extrémités.
function interp(xs as Array<Number>, ys as Array<Number>, x as Float) as Float {
    var n = xs.size();
    if (x <= xs[0]) {
        return ys[0].toFloat();
    }
    if (x >= xs[n - 1]) {
        return ys[n - 1].toFloat();
    }
    var lo = 0;
    var hi = n - 1;
    while (hi - lo > 1) {
        var mid = (lo + hi) / 2;
        if (xs[mid] <= x) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    var x0 = xs[lo].toFloat();
    var x1 = xs[hi].toFloat();
    var f = x1 > x0 ? (x - x0) / (x1 - x0) : 0.0;
    return ys[lo] + f * (ys[hi] - ys[lo]);
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

// Suite de nombres « a,b,c,... » lue par groupes de `size` (écarts d'un sommet au suivant), ajoutés aux
// cumuls `acc` puis passés à `sink` (ligne G, ligne E, champ wp). Lecture au fil de la chaîne, sans
// tableau intermédiaire (mémoire).
function readGroups(data as String, size as Number, acc as Array<Number>, sink as Method) as Void {
    if (data.length() == 0) {
        return;
    }
    var k = 0;
    var rest = data;
    var i = rest.find(",");
    while (true) {
        acc[k] = acc[k] + toNum(i != null ? rest.substring(0, i) as String : rest);
        k++;
        if (k == size) {
            sink.invoke(acc);
            k = 0;
        }
        if (i == null) {
            break;
        }
        rest = rest.substring(i + 1, rest.length()) as String;
        i = rest.find(",");
    }
}

// Lecture du plan et du profil : un objet par lecture (les méthodes passées à readGroups y écrivent).
class PlanReader {
    var plan as Plan;
    var la0 as Number = 0;
    var lo0 as Number = 0;

    function initialize(p as Plan) {
        plan = p;
    }

    // Ligne G : premier sommet « d:lat:lon » (lat / lon en 1e-5 degré) puis écarts « dd,dlat,dlon,... ».
    function route(tol as Number, origin as String, data as String) as Void {
        var o = splitText(origin, ":");
        if (o.size() != 3) {
            return;
        }
        var d = toNum(o[0]);
        la0 = toNum(o[1]);
        lo0 = toNum(o[2]);
        plan.lat0 = la0 / 100000.0d;
        plan.lon0 = lo0 / 100000.0d;
        plan.kx = 111320.0d * Math.cos(plan.lat0 * Math.PI / 180.0d);
        plan.routeTol = tol;
        plan.routeD.add(d);
        plan.routeX.add(0);
        plan.routeY.add(0);
        readGroups(data, 3, [d, la0, lo0] as Array<Number>, method(:routePoint));
    }

    function routePoint(v as Array<Number>) as Void {
        plan.routeD.add(v[0]);
        plan.routeX.add(((v[2] - lo0) * plan.kx / 100000.0d).toNumber());
        plan.routeY.add(((v[1] - la0) * ROUTE_KY / 100000.0d).toNumber());
    }

    // Ligne E : triplets « dd,du,dn » (écarts de distance, de D+ et de D-) à partir de 0,0,0.
    function climb(data as String) as Void {
        readGroups(data, 3, [0, 0, 0] as Array<Number>, method(:climbPoint));
    }

    function climbPoint(v as Array<Number>) as Void {
        plan.climbD.add(v[0]);
        plan.climbUp.add(v[1]);
        plan.climbDn.add(v[2]);
    }

    // Champ wp : « TPP1|<tolérance>|<d0>:<alt0>|<dd>,<dz>,... ».
    function profile(text as String) as Void {
        var parts = splitText(text, "|");
        if (parts.size() < 4 || !parts[0].equals("TPP1")) {
            return;
        }
        var o = splitText(parts[2], ":");
        if (o.size() != 2) {
            return;
        }
        var d = toNum(o[0]);
        var a = toNum(o[1]);
        plan.profD.add(d);
        plan.profA.add(a);
        readGroups(parts[3], 2, [d, a] as Array<Number>, method(:profilePoint));
    }

    function profilePoint(v as Array<Number>) as Void {
        plan.profD.add(v[0]);
        plan.profA.add(v[1]);
    }
}

// Lit le plan (champ w) et le profil (champ wp, ou null) ; renvoie null si le plan n'est pas reconnu.
function parsePlan(text as String, profile as String or Null) as Plan or Null {
    var lines = splitText(text, "\n");
    if (lines.size() < 4 || !lines[0].equals("TP1")) {
        return null;
    }
    var p = new Plan();
    var reader = new PlanReader(p);
    for (var li = 1; li < lines.size(); li++) {
        var parts = splitText(lines[li], "|");
        var tag = parts[0];
        if (tag.equals("N") && parts.size() >= 2) {
            p.name = parts[1];
        } else if (tag.equals("S") && parts.size() >= 4) {
            p.start = toNum(parts[1]);
            p.total = toNum(parts[2]);
            if (parts.size() >= 7) {
                p.kind = parts[4];
                p.dPlus = toNum(parts[5]);
                p.dMinus = toNum(parts[6]);
            }
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
            p.cpKind.add(parts[4]);
            p.cpName.add(parts[5]);
            p.cpStop.add(parts.size() >= 7 ? toNum(parts[6]) : 0);
            p.cpBase.add(parts.size() >= 9 && parts[8].equals("b"));
        } else if (tag.equals("E") && parts.size() >= 2) {
            reader.climb(parts[1]);
        } else if (tag.equals("G") && parts.size() >= 4) {
            reader.route(toNum(parts[1]), parts[2], parts[3]);
        }
    }
    if (p.curveD.size() < 2 || p.total <= 0) {
        return null;
    }
    if (profile != null) {
        reader.profile(profile);
    }
    return p;
}

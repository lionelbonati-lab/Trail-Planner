import Toybox.Lang;
import Toybox.Math;

// Mètres par degré de latitude (projection locale du tracé).
const ROUTE_KY = 110540.0d;

// Plan compact envoyé par l'app web (format « TP1 », voir src/lib/watch.ts) :
//   TP1
//   N|<nom>
//   S|<départ prévu, s Unix>|<distance totale, m>|<rappel nutrition, min>|<c course / p parcours>|<D+ m>|<D- m>
//   K|<d>:<t>,<d>:<t>,... courbe distance (m) -> temps de déplacement prévu (s, arrêts exclus)
//   C|<dist m>|<prévu s>|<barrière s Unix ou 0>|<type r/s/c/i>|<nom>|<arrêt s>|<note>
//   E|<dd>,<du>,<dn>,...  D+ et D- cumulés depuis le départ (m), écarts d'un sommet au suivant à partir
//     de 0,0,0 ; un sommet à chaque point de passage (D+ / D- d'un point au suivant exacts)
//   P|<produit>|<produit>|...  noms des produits du plan nutrition
//   F|<point de départ>|<point d'arrivée>|<eau dL>|<sel mg>|<p>,<p>,...|<eau du sac>  un par tronçon entre ravitos
//     (eau du sac : texte du plan, flasques et mélange d'eau minérale, « ; » = ligne suivante)
//     (indices des lignes C, -1 = départ) : sac « À emporter » et produits dans l'ordre de prise
//   W|<volume d'une flasque dL>|<isotonique : indice dans P, -1 sans>  flasques de chaque tronçon
//     tirées de son eau : autant que de volumes commencés ; avec isotonique, 1 iso seule si une suffit,
//     sinon en alternant eau puis iso
//   G|<tolérance m>|<d0>:<lat0>:<lon0>|<dd>,<dlat>,<dlon>,...   tracé simplifié (lat / lon en
//     1e-5 degré, puis écarts d'un sommet au suivant) pour caler la position GPS sur le parcours
// Temps prévu à une distance d = K interpolé + arrêts des points situés avant d.
class Plan {
    var name as String = "";
    var start as Number = 0;
    var total as Number = 0;
    var fuelMin as Number = 0;
    var kind as String = "";      // "c" course, "p" parcours d'entraînement, "" plan d'une ancienne version
    var dPlus as Number = -1;     // D+ / D- du parcours (m), -1 si inconnus
    var dMinus as Number = -1;
    var refStart as Number = 0;   // départ prévu (s Unix), même en départ libre : référence des barrières
    var curveD as Array<Number> = [] as Array<Number>;
    var curveT as Array<Number> = [] as Array<Number>;
    var cpDist as Array<Number> = [] as Array<Number>;
    var cpPlan as Array<Number> = [] as Array<Number>;
    var cpCut as Array<Number> = [] as Array<Number>;
    var cpKind as Array<String> = [] as Array<String>;
    var cpName as Array<String> = [] as Array<String>;
    var cpStop as Array<Number> = [] as Array<Number>;
    var cpNote as Array<String> = [] as Array<String>;
    // Tracé simplifié (ligne G) : distance le long du parcours (m) et position de chaque sommet (m)
    // par rapport au premier (x vers l'est, y vers le nord).
    var routeD as Array<Number> = [] as Array<Number>;
    var routeX as Array<Number> = [] as Array<Number>;
    var routeY as Array<Number> = [] as Array<Number>;
    var routeTol as Number = 0;
    var lat0 as Double = 0.0d;
    var lon0 as Double = 0.0d;
    var kx as Double = 0.0d;      // mètres par degré de longitude à lat0
    // Dénivelé (ligne E) : D+ et D- cumulés (m) à chaque distance (m) du profil simplifié.
    var climbD as Array<Number> = [] as Array<Number>;
    var climbUp as Array<Number> = [] as Array<Number>;
    var climbDn as Array<Number> = [] as Array<Number>;
    // Plan nutrition (lignes P et F) : noms des produits ; pour chaque tronçon, points de départ et
    // d'arrivée (indices des points, -1 = départ), eau (dL), sel (mg) et premier de ses produits dans
    // foodP (produits à prendre, tronçon après tronçon).
    var foodName as Array<String> = [] as Array<String>;
    var legFrom as Array<Number> = [] as Array<Number>;
    var legTo as Array<Number> = [] as Array<Number>;
    var legWater as Array<Number> = [] as Array<Number>;
    var legSalt as Array<Number> = [] as Array<Number>;
    var legFirst as Array<Number> = [] as Array<Number>;
    var legWaterText as Array<String> = [] as Array<String>;
    var foodP as Array<Number> = [] as Array<Number>;
    // Ligne W : volume d'une flasque (dL, 0 = pas de flasques) et isotonique (indice dans foodName, -1 sans).
    var flaskDl as Number = 0;
    var isoP as Number = -1;

    function initialize() {
    }

    // Barrière horaire du point i (s Unix, 0 sans). Activité partie à plus de 6 h du départ prévu
    // (entraînement sur le parcours, départ libre, simulateur) : barrière décalée d'autant, sinon elle
    // tomberait un autre jour (« Hors délai -884h41 »). Le jour de la course, elle reste à l'heure fixe.
    function cutAt(i as Number, actualStart as Number) as Number {
        var cut = cpCut[i];
        if (cut <= 0 || refStart <= 0) {
            return cut;
        }
        var off = actualStart - refStart;
        return (off > 21600 || off < -21600) ? cut + off : cut;
    }

    function hasFood() as Boolean {
        return foodP.size() > 0;
    }

    // Nombre de produits du tronçon l.
    function legCount(l as Number) as Number {
        var end = l + 1 < legFirst.size() ? legFirst[l + 1] : foodP.size();
        return end - legFirst[l];
    }

    // Tronçon du k-ième produit à prendre.
    function legOf(k as Number) as Number {
        var l = 0;
        while (l + 1 < legFirst.size() && legFirst[l + 1] <= k) {
            l++;
        }
        return l;
    }

    // Tronçon qui part du point i (ravito), ou -1.
    function legFromCp(i as Number) as Number {
        for (var l = 0; l < legFrom.size(); l++) {
            if (legFrom[l] == i) {
                return l;
            }
        }
        return -1;
    }

    // Distance (m) du rappel du k-ième produit : le j-ième des n produits d'un tronçon est prévu au milieu
    // de sa part du tronçon en temps prévu (départ du point + (j + 0.5) / n x durée prévue), position
    // retrouvée sur la courbe du plan. Les rappels suivant la position, les produits durent jusqu'au
    // ravito suivant même si le tronçon prend plus de temps que prévu.
    function foodDist(k as Number) as Float {
        var l = legOf(k);
        var n = legCount(l);
        var j = k - legFirst[l];
        var a = legFrom[l];
        var b = legTo[l];
        var lo = (a >= 0 && a < cpDist.size()) ? cpDist[a].toFloat() : 0.0;
        var hi = (b >= 0 && b < cpDist.size()) ? cpDist[b].toFloat() : total.toFloat();
        var dep = (a >= 0 && a < cpDist.size()) ? cpPlan[a] + cpStop[a] : 0;
        var arr = (b >= 0 && b < cpDist.size()) ? cpPlan[b] : finishTime();
        var t = dep + (j + 0.5) * (arr - dep) / (n > 0 ? n : 1);
        for (var it = 0; it < 16; it++) {
            var mid = (lo + hi) / 2.0;
            if (plannedAt(mid) < t) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return hi;
    }

    // Eau à boire à chaque rappel du tronçon du k-ième produit (L) : eau du tronçon / nombre de produits.
    function foodWater(k as Number) as Float {
        var l = legOf(k);
        var n = legCount(l);
        return n > 0 ? legWater[l] / 10.0 / n : 0.0;
    }

    function foodLabel(k as Number) as String {
        var p = foodP[k];
        return (p >= 0 && p < foodName.size()) ? foodName[p] : "Manger";
    }

    // Sac « À emporter » du tronçon l : eau (quantité réelle et flasques), produits (nombre et nom, dans
    // l'ordre de prise, l'isotonique compté dans les flasques) et sel.
    function bag(l as Number) as Array<String> {
        var out = [] as Array<String>;
        // Flasques (comme flaskSplit côté web) : autant que de volumes commencés ; avec isotonique, une
        // seule d'isotonique si une flasque suffit, sinon en alternant eau puis isotonique
        // (0,4 L : 1 iso ; 1,1 L : 2 eau + 1 iso ; 1,6 L : 2 eau + 2 iso).
        var fw = 0;
        var fi = 0;
        if (flaskDl > 0 && legWater[l] > 0) {
            var n = (legWater[l] + flaskDl - 1) / flaskDl;
            if (n < 1) {
                n = 1;
            }
            if (isoP < 0) {
                fw = n;
            } else if (n == 1) {
                fi = 1;
            } else {
                fw = (n + 1) / 2;
                fi = n / 2;
            }
        }
        var wt = l < legWaterText.size() ? legWaterText[l] : "";
        if (wt.length() > 0) {
            // Texte du plan (flasques, mélange d'eau minérale) : une ligne par partie séparée par « ; ».
            var w = splitText(wt, ";");
            for (var k = 0; k < w.size(); k++) {
                out.add(w[k]);
            }
        } else if (legWater[l] > 0) {
            var water = (legWater[l] / 10.0).format("%.1f") + " L";
            if (fw + fi > 0) {
                water += " :";
                if (fw > 0) {
                    water += " " + fw + " eau";
                }
                if (fi > 0) {
                    water += (fw > 0 ? " +" : "") + " " + fi + " iso";
                }
            } else {
                water += " d'eau";
            }
            out.add(water);
        }
        var seen = [] as Array<Number>;
        var count = [] as Array<Number>;
        var end = legFirst[l] + legCount(l);
        for (var k = legFirst[l]; k < end; k++) {
            if (fi > 0 && foodP[k] == isoP) {
                continue;
            }
            var i = seen.indexOf(foodP[k]);
            if (i < 0) {
                seen.add(foodP[k]);
                count.add(1);
            } else {
                count[i] = count[i] + 1;
            }
        }
        for (var i = 0; i < seen.size(); i++) {
            var p = seen[i];
            out.add(count[i] + " " + ((p >= 0 && p < foodName.size()) ? foodName[p] : "?"));
        }
        if (legSalt[l] > 0) {
            out.add("Sel +" + legSalt[l] + " mg");
        }
        return out;
    }

    function hasRoute() as Boolean {
        return routeD.size() >= 2;
    }

    function hasClimb() as Boolean {
        return climbD.size() >= 2;
    }

    // Course (heure de départ affichée avant le départ) : plan d'une ancienne version sans type compris.
    function isRace() as Boolean {
        return !kind.equals("p");
    }

    // D+ et D- cumulés depuis le départ (m) à la distance d (m), interpolés entre deux sommets.
    function climbAt(d as Float) as Array<Float> {
        var n = climbD.size();
        if (d <= climbD[0]) {
            return [climbUp[0].toFloat(), climbDn[0].toFloat()];
        }
        if (d >= climbD[n - 1]) {
            return [climbUp[n - 1].toFloat(), climbDn[n - 1].toFloat()];
        }
        var lo = 0;
        var hi = n - 1;
        while (hi - lo > 1) {
            var mid = (lo + hi) / 2;
            if (climbD[mid] <= d) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        var d0 = climbD[lo].toFloat();
        var d1 = climbD[hi].toFloat();
        var f = d1 > d0 ? (d - d0) / (d1 - d0) : 0.0;
        return [climbUp[lo] + f * (climbUp[hi] - climbUp[lo]), climbDn[lo] + f * (climbDn[hi] - climbDn[lo])];
    }

    // D+ et D- (m, arrondis) de la distance a à la distance b (m) : [D+, D-].
    function climbBetween(a as Float, b as Float) as Array<Number> {
        var x = climbAt(a);
        var y = climbAt(b);
        var up = (y[0] - x[0] + 0.5).toNumber();
        var dn = (y[1] - x[1] + 0.5).toNumber();
        return [up > 0 ? up : 0, dn > 0 ? dn : 0];
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

// Ligne E : triplets « dd,du,dn » (écarts de distance, de D+ et de D-) à partir de 0,0,0.
// Lecture au fil de la chaîne, comme la ligne G.
function parseClimb(p as Plan, data as String) as Void {
    var vals = [0, 0, 0] as Array<Number>;
    var d = 0;
    var up = 0;
    var dn = 0;
    var k = 0;
    var rest = data;
    var i = rest.find(",");
    while (true) {
        vals[k] = toNum(i != null ? rest.substring(0, i) as String : rest);
        k++;
        if (k == 3) {
            d += vals[0];
            up += vals[1];
            dn += vals[2];
            p.climbD.add(d);
            p.climbUp.add(up);
            p.climbDn.add(dn);
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
            if (parts.size() >= 7) {
                p.kind = parts[4];
                p.dPlus = toNum(parts[5]);
                p.dMinus = toNum(parts[6]);
            }
            if (parts.size() >= 8) {
                p.refStart = toNum(parts[7]);
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
            p.cpPlan.add(toNum(parts[2]));
            p.cpCut.add(toNum(parts[3]));
            p.cpKind.add(parts[4]);
            p.cpName.add(parts[5]);
            p.cpStop.add(parts.size() >= 7 ? toNum(parts[6]) : 0);
            p.cpNote.add(parts.size() >= 8 ? parts[7] : "");
        } else if (tag.equals("E") && parts.size() >= 2) {
            parseClimb(p, parts[1]);
        } else if (tag.equals("P")) {
            for (var k = 1; k < parts.size(); k++) {
                p.foodName.add(parts[k]);
            }
        } else if (tag.equals("F") && parts.size() >= 6) {
            p.legFrom.add(toNum(parts[1]));
            p.legTo.add(toNum(parts[2]));
            p.legWater.add(toNum(parts[3]));
            p.legSalt.add(toNum(parts[4]));
            p.legFirst.add(p.foodP.size());
            p.legWaterText.add(parts.size() >= 7 ? parts[6] : "");
            if (parts[5].length() > 0) {
                var items = splitText(parts[5], ",");
                for (var k = 0; k < items.size(); k++) {
                    p.foodP.add(toNum(items[k]));
                }
            }
        } else if (tag.equals("W") && parts.size() >= 3) {
            p.flaskDl = toNum(parts[1]);
            p.isoP = toNum(parts[2]);
        } else if (tag.equals("G") && parts.size() >= 4) {
            parseRoute(p, toNum(parts[1]), parts[2], parts[3]);
        }
    }
    if (p.curveD.size() < 2 || p.total <= 0) {
        return null;
    }
    return p;
}

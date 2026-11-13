import Toybox.Lang;

// Plan compact envoyé par l'app web (format « TP1 », voir src/lib/watch.ts) :
//   TP1
//   N|<nom>
//   S|<départ prévu, s Unix>|<distance totale, m>|<rappel nutrition, min>
//   K|<d>:<t>,<d>:<t>,... courbe distance (m) -> temps de déplacement prévu (s, arrêts exclus)
//   C|<dist m>|<prévu s>|<barrière s Unix ou 0>|<type r/s/c/i>|<nom>|<arrêt s>
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

    function initialize() {
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

    // Indice du premier point situé au-delà de d (m), ou -1.
    function nextIndex(d as Float) as Number {
        for (var i = 0; i < cpDist.size(); i++) {
            if (cpDist[i] > d + 50) {
                return i;
            }
        }
        return -1;
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
        }
    }
    if (p.curveD.size() < 2 || p.total <= 0) {
        return null;
    }
    return p;
}

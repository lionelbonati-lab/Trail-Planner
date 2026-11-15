import Toybox.Activity;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

// Champ de données : avance/retard sur le plan, prochain point, heure estimée,
// marge sur la prochaine barrière horaire et rappels de nutrition (produit prévu, sac « À emporter »
// à l'arrivée à un ravito).
// Heures prévues : fixes pendant toute l'activité. Heures estimées des points : recalculées à chaque
// passage (bouton Lap ou détection GPS) d'après ce qui a déjà été fait, fixes entre deux passages.
class TrailPlannerField extends WatchUi.DataField {
    // Le retard (ou l'avance) se prolonge sur la suite, amorti de 30 % et borné (comme l'app web).
    const DAMPING = 0.7;
    const CUTOFF_WARN = 1800; // s : alerte si la marge passe sous 30 min

    var plan = null;          // Plan ou null
    var status = "";          // message affiché sans plan
    var running = false;
    var dist = 0.0;           // m le long du parcours
    var delta = 0.0;          // s, positif = retard
    var next = -1;            // indice du prochain point
    var nextEta = 0;          // s Unix
    var cutIdx = -1;          // prochain point avec barrière
    var margin = 0;           // s de marge sur cette barrière
    var finishEta = 0;        // s Unix
    var startUnix = 0;        // départ réel (s Unix) = maintenant − temps écoulé
    var alerted = {};         // barrières déjà signalées
    var nextFuel = 0.0;       // temps écoulé (s) du prochain rappel (rappels toutes les N minutes)
    var fuelUntil = 0;        // s Unix : affichage du rappel jusqu'à cet instant
    var food = 0;             // prochain produit à rappeler (indice dans plan.foodP)
    var foodAt = -1.0;        // distance de son rappel (m), -1 : à calculer
    var foodSync = true;      // rappels déjà dépassés sautés sans prévenir (nouvelle activité, plan changé)
    var foodMsg = -1;         // produit du rappel affiché, -1 : « Manger / boire » sans produit
    var bagLeg = -1;          // tronçon dont le sac « À emporter » est affiché (arrivée au ravito)
    var bagUntil = 0;         // s Unix : affichage du sac jusqu'à cet instant...
    var bagFrom = 0.0;        // ... et jusqu'à 300 m après ce ravito (m)
    var passes = {};          // indice du point -> instant de passage (s Unix)
    var lastElapsed = 0.0;    // pour détecter une nouvelle activité
    var lastSaved = 0;        // dernier enregistrement du suivi (s Unix)
    var planText = null;      // texte du plan chargé (seul un plan modifié est relu)
    var matched = -1.0;       // m le long du parcours au dernier calage GPS (-1 : pas encore calé)
    var matchedAt = 0.0;      // distance montre (m) à ce calage
    var offCount = 0;         // relevés GPS consécutifs hors du tracé
    var offRoute = false;     // hors du tracé depuis 5 relevés
    var offBy = 0;            // écart au tracé (m)
    var etas = [] as Array<Number>; // heure estimée (s Unix) de chaque point, recalculée aux passages
    var lapped = {};          // points validés par un tour (bouton Lap)
    var lapOffset = 0.0;      // sans tracé GPS : correction de distance apportée par les tours (m)
    var lastWalked = 0.0;     // distance montre au dernier calcul (m)
    var lapMsg = "";          // nom du point validé par le dernier tour
    var lapMsgUntil = 0;      // s Unix : affichage du passage jusqu'à cet instant

    function initialize() {
        DataField.initialize();
        reload();
    }

    // Appelé à chaque téléchargement du plan (toutes les 5 min) : seul un plan nouveau ou modifié est
    // relu. Il faut alors recaler la position sur tout le parcours ; en course, les passages et alertes
    // déjà notés sont gardés (rapportés aux points du nouveau plan).
    function reload() as Void {
        var text = Application.Storage.getValue("plan");
        if (!(text instanceof String)) {
            plan = null;
            planText = null;
        } else if (planText == null || !text.equals(planText)) {
            var old = plan;
            plan = parsePlan(text);
            planText = plan != null ? text : null;
            matched = -1.0;
            offCount = 0;
            offRoute = false;
            etas = [] as Array<Number>;
            food = 0;
            foodAt = -1.0;
            foodSync = true;
            bagLeg = -1;
            bagUntil = 0;
            if (running && old != null && plan != null) {
                passes = remap(passes, old, plan);
                alerted = remap(alerted, old, plan);
                lapped = remap(lapped, old, plan);
            } else {
                passes = {};
                alerted = {};
                lapped = {};
                nextFuel = 0.0;
            }
        }
        var code = Application.Properties.getValue("code");
        var err = Application.Storage.getValue("fetchError");
        if (!(code instanceof String) || code.length() < 8) {
            status = "Saisis le code montre";
        } else if (plan == null) {
            if (err == 404) {
                status = "Code inconnu";
            } else if (err != null) {
                status = "Plan : erreur " + err;
            } else {
                status = "Plan en attente...";
            }
        } else {
            status = "";
        }
    }

    // Points notés (passages, alertes) d'un plan à l'autre : même point à moins de 100 m près.
    function remap(marks as Dictionary, old, cur) as Dictionary {
        var out = {};
        var keys = marks.keys();
        for (var k = 0; k < keys.size(); k++) {
            var i = keys[k] as Number;
            if (i >= old.cpDist.size()) {
                continue;
            }
            for (var j = 0; j < cur.cpDist.size(); j++) {
                var gap = cur.cpDist[j] - old.cpDist[i];
                if (gap > -100 && gap < 100) {
                    out.put(j, marks[i]);
                    break;
                }
            }
        }
        return out;
    }

    // Distance le long du parcours (m).
    // Avec le tracé du plan (ligne G) : position GPS calée sur le tracé, près de la position attendue
    // (dernier calage + distance montre parcourue depuis) ; la distance montre ne sert qu'entre deux
    // relevés, sans erreur cumulée ni souci de parcours modifié (raccourci, détour). Hors du tracé, la
    // distance reste figée (« Hors parcours ») ; sans position GPS, elle avance avec la distance montre.
    // Sans tracé (plan d'une ancienne version) : navigation du parcours si elle est active et
    // cohérente, sinon distance parcourue.
    function courseDistance(info as Activity.Info) as Float {
        var walked = info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        if (plan.hasRoute()) {
            var since = walked - matchedAt;
            var expected = matched >= 0 ? matched + since : walked;
            var loc = info.currentLocation;
            var q = info.currentLocationAccuracy;
            // 3 = Position.QUALITY_USABLE (module Position non importé : pas de permission nécessaire).
            if (loc == null || (q != null && q < 3)) {
                return expected;
            }
            // Pas encore calé et hors du tracé (échauffement…) : recherche sur tout le parcours toutes les 5 s.
            if (matched < 0 && offCount % 5 != 0) {
                offCount++;
                offRoute = offCount >= 5;
                return 0.0;
            }
            var deg = loc.toDegrees();
            var maxOff = plan.onRouteMax();
            var r = matched < 0
                ? plan.locate(deg[0], deg[1], 0.0, plan.total + 1000.0, expected, 0.1, maxOff)
                : plan.locate(deg[0], deg[1], matched - 300.0, matched + since * 1.2 + 1000.0, expected, 1.0, maxOff);
            if (r[0] != null) {
                matched = r[0];
                matchedAt = walked;
                offCount = 0;
                offRoute = false;
                return matched;
            }
            offCount++;
            offRoute = offCount >= 5;
            offBy = r[1] != null && r[1] > 0 ? r[1].toNumber() : 0;
            return matched >= 0 ? matched : 0.0;
        }
        var d = walked;
        var toDest = info.distanceToDestination;
        if (toDest != null && toDest > 0) {
            var along = plan.total - toDest.toFloat();
            var gap = along - d;
            if (gap < 0) {
                gap = -gap;
            }
            if (along >= 0 && gap < plan.total * 0.2) {
                d = along;
            }
        }
        return d + lapOffset;
    }

    // Heures estimées des points d'après ce qui a déjà été fait : rythme réel au dernier point passé
    // (temps réel / temps prévu, amorti et borné comme dans l'app web), appliqué à la suite ; les arrêts
    // prévus ne sont pas étirés. Avant le premier passage : heures prévues. Appelé à chaque passage.
    function updateEstimates() as Void {
        var n = plan.cpDist.size();
        var ref = -1;
        for (var i = 0; i < n; i++) {
            if (passes.hasKey(i)) {
                ref = i;
            }
        }
        var ratio = 1.0;
        var t0 = startUnix;        // départ du dernier point passé (s Unix)
        var base = 0;              // même instant, en temps prévu (s depuis le départ)
        if (ref >= 0) {
            var planned = plan.cpPlan[ref];
            if (planned > 600) {
                var raw = (passes[ref] - startUnix).toFloat() / planned;
                if (raw < 0.7) {
                    raw = 0.7;
                }
                if (raw > 1.6) {
                    raw = 1.6;
                }
                ratio = 1.0 + DAMPING * (raw - 1.0);
            }
            t0 = passes[ref] + plan.cpStop[ref];
            base = planned + plan.cpStop[ref];
        }
        etas = [] as Array<Number>;
        for (var j = 0; j < n; j++) {
            if (passes.hasKey(j)) {
                etas.add(passes[j] as Number);
            } else if (j > ref) {
                var rest = plan.cpPlan[j] - base;
                etas.add(t0 + ((rest > 0 ? rest : 0) * ratio).toNumber());
            } else {
                etas.add(startUnix + plan.cpPlan[j]); // point sauté
            }
        }
        var restF = plan.finishTime() - base;
        finishEta = t0 + ((restF > 0 ? restF : 0) * ratio).toNumber();
    }

    // Bouton Lap : passage au point le plus proche pas encore validé par un tour, à moins de 300 m de
    // la position calée sur le tracé (8 % de la distance sans tracé GPS). Heure de passage = maintenant,
    // position recalée sur le point, heures estimées des points suivants recalculées. Un tour loin de
    // tout point (tour auto au km…) est ignoré.
    function onTimerLap() as Void {
        if (plan == null || !running || Application.Properties.getValue("lapPass") == false) {
            return;
        }
        var gps = plan.hasRoute() && matched >= 0;
        var win = gps ? 300.0 : dist * 0.08;
        if (win < 300.0) {
            win = 300.0;
        }
        var best = -1;
        var bestGap = 0.0;
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (lapped.hasKey(i)) {
                continue;
            }
            var gap = plan.cpDist[i] - dist;
            if (gap < 0) {
                gap = -gap;
            }
            if (gap <= win && (best < 0 || gap < bestGap)) {
                best = i;
                bestGap = gap;
            }
        }
        if (best < 0) {
            return;
        }
        var now = Time.now().value();
        var at = plan.cpDist[best].toFloat();
        lapped.put(best, true);
        passes.put(best, now);
        if (gps) {
            matched = at;
            matchedAt = lastWalked;
            offCount = 0;
            offRoute = false;
        } else {
            lapOffset += at - dist;
        }
        dist = at;
        updateEstimates();
        showBag(best, now);
        lapMsg = plan.cpName[best];
        lapMsgUntil = now + 5;
        lastSaved = 0; // suivi envoyé au prochain calcul
    }

    // Arrivée à un ravito : sac « À emporter » du tronçon qui en part (eau, produits, sel), affiché pendant
    // l'arrêt prévu (1 à 10 min) et tant qu'on n'est pas 300 m plus loin.
    function showBag(i as Number, now as Number) as Void {
        var l = plan.legFromCp(i);
        if (l < 0 || l == bagLeg) {
            return;
        }
        var stop = plan.cpStop[i];
        bagLeg = l;
        bagUntil = now + (stop < 60 ? 60 : (stop > 600 ? 600 : stop));
        bagFrom = plan.cpDist[i].toFloat();
    }

    // Rappels des produits du plan (réglage « selon le plan », -1) si le plan en a ; sinon toutes les
    // N minutes (réglage en minutes, ou intervalle du plan), « Manger / boire » sans produit.
    function planReminders() as Boolean {
        var v = Application.Properties.getValue("fuelMin");
        return !(v instanceof Number && v >= 0) && plan.hasFood();
    }

    function fuelInterval() as Number {
        var v = Application.Properties.getValue("fuelMin");
        if (v instanceof Number && v >= 0) {
            return v;
        }
        return plan != null ? plan.fuelMin : 0;
    }

    function vibrate(strong as Boolean) as Void {
        var on = Application.Properties.getValue("vibrate");
        if (on == false) {
            return;
        }
        if (Attention has :vibrate) {
            var pattern = strong
                ? [new Attention.VibeProfile(100, 400), new Attention.VibeProfile(0, 200), new Attention.VibeProfile(100, 400), new Attention.VibeProfile(0, 200), new Attention.VibeProfile(100, 400)]
                : [new Attention.VibeProfile(60, 300), new Attention.VibeProfile(0, 200), new Attention.VibeProfile(60, 300)];
            Attention.vibrate(pattern);
        }
        if (Attention has :playTone) {
            Attention.playTone(strong ? Attention.TONE_ALERT_HI : Attention.TONE_ALERT_LO);
        }
    }

    function compute(info as Activity.Info) as Void {
        if (plan == null) {
            return;
        }
        var elapsed = info.elapsedTime != null ? info.elapsedTime / 1000.0 : 0.0;
        running = elapsed > 0;
        if (!running) {
            return;
        }
        // Nouvelle activité (temps écoulé revenu en arrière) : on repart de zéro.
        if (elapsed < lastElapsed - 5) {
            passes = {};
            alerted = {};
            nextFuel = 0.0;
            matched = -1.0;
            matchedAt = 0.0;
            offCount = 0;
            offRoute = false;
            lapped = {};
            lapOffset = 0.0;
            etas = [] as Array<Number>;
            food = 0;
            foodAt = -1.0;
            foodSync = true;
            bagLeg = -1;
            bagUntil = 0;
        }
        lastElapsed = elapsed;
        lastWalked = info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        var d = courseDistance(info);
        dist = d;

        // Écart au plan à l'endroit où l'on est (mis à jour en continu).
        var planned = plan.plannedAt(d);
        delta = d > 200 ? elapsed - planned : 0.0;
        var now = Time.now().value();
        startUnix = now - elapsed.toNumber();

        // Passages aux points détectés par la position (un tour Lap les valide aussi, voir onTimerLap).
        var changed = false;
        var last = -1;
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (!passes.hasKey(i) && d >= plan.cpDist[i] - 30) {
                passes.put(i, now);
                changed = true;
                last = i;
            }
        }
        // Ravito atteint (pas un point dépassé de loin, au démarrage en cours de parcours) : sac à emporter.
        if (last >= 0 && d < plan.cpDist[last] + 300) {
            showBag(last, now);
        }
        // Heures estimées : recalculées seulement à un passage (et au début de l'activité).
        if (changed || etas.size() != plan.cpDist.size()) {
            updateEstimates();
        }
        // Prochain point : le premier pas encore passé au-delà de la position.
        next = -1;
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (!passes.hasKey(i) && plan.cpDist[i] > d + 50) {
                next = i;
                break;
            }
        }
        if (next >= 0) {
            nextEta = etas[next];
        }

        // Prochaine barrière horaire et alerte (une fois par point).
        cutIdx = -1;
        if (next >= 0) {
            for (var i = next; i < plan.cpCut.size(); i++) {
                if (plan.cpCut[i] > 0) {
                    cutIdx = i;
                    margin = plan.cpCut[i] - etas[i];
                    break;
                }
            }
        }
        if (cutIdx >= 0 && margin < CUTOFF_WARN && !alerted.hasKey(cutIdx)) {
            alerted.put(cutIdx, true);
            vibrate(true);
        }

        if (changed || now - lastSaved >= 60) {
            saveProgress(info, now, d);
        }

        // Rappels nutrition : produits du plan, répartis sur chaque tronçon entre deux ravitos et
        // rappelés d'après la position (voir Plan.foodDist) ; sinon toutes les N minutes. Trois positions
        // de rappel calculées au plus par seconde (temps de calcul limité par la montre) : après un plan
        // rechargé en course, les rappels dépassés sont sautés en quelques secondes, sans prévenir.
        if (planReminders()) {
            var n = plan.foodP.size();
            var hit = -1;
            var budget = 3;
            while (food < n) {
                if (foodAt < 0) {
                    if (budget == 0) {
                        break;
                    }
                    foodAt = plan.foodDist(food);
                    budget--;
                }
                if (d < foodAt) {
                    break;
                }
                hit = food;
                food++;
                foodAt = -1.0;
            }
            if (hit >= 0 && !foodSync) {
                foodMsg = hit;
                fuelUntil = now + 30;
                vibrate(false);
            }
            if (food >= n || foodAt >= 0) {
                foodSync = false;
            }
        } else {
            var interval = fuelInterval();
            if (interval > 0) {
                if (nextFuel <= 0.0) {
                    nextFuel = elapsed + interval * 60;
                } else if (elapsed >= nextFuel) {
                    nextFuel = elapsed + interval * 60;
                    foodMsg = -1;
                    fuelUntil = now + 30;
                    vibrate(false);
                }
            }
        }
    }

    // Suivi lu par la tâche de fond, qui l'envoie à l'assistance via le téléphone.
    function saveProgress(info as Activity.Info, now as Number, d as Float) as Void {
        var p = "";
        var keys = passes.keys();
        for (var k = 0; k < keys.size(); k++) {
            p += (k > 0 ? "," : "") + keys[k] + ":" + passes[keys[k]];
        }
        var progress = { "t" => now, "s" => startUnix, "d" => d.toNumber(), "p" => p };
        var loc = info.currentLocation;
        if (loc != null) {
            var deg = loc.toDegrees();
            progress.put("lat", deg[0].toFloat());
            progress.put("lon", deg[1].toFloat());
        }
        var stats = System.getSystemStats();
        if (stats != null && stats.battery != null) {
            progress.put("bat", stats.battery.toNumber());
        }
        Application.Storage.setValue("progress", progress);
        lastSaved = now;
    }

    // --- Mise en forme ------------------------------------------------------

    function clock(sec as Number) as String {
        var t = Gregorian.info(new Time.Moment(sec), Time.FORMAT_SHORT);
        return (t.hour as Number).format("%02d") + ":" + (t.min as Number).format("%02d");
    }

    // Durée : « 3h12 », « 45 min ».
    function duration(sec as Number) as String {
        var m = (sec + 30) / 60;
        if (m < 60) {
            return m + " min";
        }
        return (m / 60) + "h" + (m % 60).format("%02d");
    }

    // « +6' », « −3' », « +1h05 ».
    function signedMinutes(sec as Float or Number) as String {
        var s = sec.toFloat();
        var sign = s >= 0 ? "+" : "-";
        var m = (s < 0 ? -s : s) / 60.0;
        var total = (m + 0.5).toNumber();
        if (total < 60) {
            return sign + total + "'";
        }
        return sign + (total / 60) + "h" + (total % 60).format("%02d");
    }

    // Distance, D+ et D- de la distance `from` à la distance `to` (m), du texte le plus complet au plus
    // court : « 4.2 km · D+245 · D-30 ». Plan sans profil de dénivelé (ancienne version) : distance seule.
    function remaining(from as Float, to as Float) as Array<String> {
        var m = to - from;
        var km = ((m > 0 ? m : 0.0) / 1000.0).format("%.1f");
        if (!plan.hasClimb()) {
            return [km + " km"] as Array<String>;
        }
        var c = plan.climbBetween(from, to);
        var up = "D+" + c[0];
        var dn = "D-" + c[1];
        return [km + " km · " + up + " · " + dn, km + " km " + up + " " + dn, km + " " + up + " " + dn] as Array<String>;
    }

    // Avant le départ : distance et D+ du parcours, « 23.4 km · D+1245 ».
    function courseStats() as Array<String> {
        var km = (plan.total / 1000.0).format("%.1f");
        var up = plan.dPlus;
        if (up < 0 && plan.hasClimb()) {
            up = plan.climbUp[plan.climbUp.size() - 1];
        }
        if (up < 0) {
            return [km + " km"] as Array<String>;
        }
        return [km + " km · D+" + up, km + " km D+" + up] as Array<String>;
    }

    // Raccourcit un texte pour qu'il tienne dans maxW pixels.
    function fit(dc as Graphics.Dc, text as String, font, maxW as Number) as String {
        var t = text;
        while (t.length() > 3 && dc.getTextWidthInPixels(t, font) > maxW) {
            t = t.substring(0, t.length() - 1) as String;
        }
        return t;
    }

    // Texte, ou variantes de la plus complète à la plus courte : la première qui tient dans maxW pixels
    // (la dernière est raccourcie au besoin).
    function pick(dc as Graphics.Dc, text, font, maxW as Number) as String {
        var opts = text instanceof Array ? text as Array : [text];
        var last = opts.size() - 1;
        for (var k = 0; k < last; k++) {
            if (dc.getTextWidthInPixels(opts[k] as String, font) <= maxW) {
                return opts[k] as String;
            }
        }
        return fit(dc, opts[last] as String, font, maxW);
    }

    // Largeur utilisable à la hauteur y du champ : sur écran rond (Enduro 3, Fenix…),
    // c'est la corde du cercle à cette hauteur, déduite de la position du champ.
    function usableWidth(y as Number, h as Number, w as Number) as Number {
        var ds = System.getDeviceSettings();
        if (ds.screenShape != System.SCREEN_SHAPE_ROUND) {
            return w - 6;
        }
        var flags = getObscurityFlags();
        var sh = ds.screenHeight;
        var fieldTop = (sh - h) / 2;
        var topEdge = (flags & OBSCURE_TOP) != 0;
        var bottomEdge = (flags & OBSCURE_BOTTOM) != 0;
        if (topEdge && !bottomEdge) {
            fieldTop = 0;
        } else if (bottomEdge && !topEdge) {
            fieldTop = sh - h;
        }
        var r = ds.screenWidth / 2.0;
        var dy = fieldTop + y - sh / 2.0;
        var c2 = r * r - dy * dy;
        if (c2 <= 0) {
            return 0;
        }
        var chord = (2 * Math.sqrt(c2)).toNumber() - 12;
        return chord < w - 6 ? chord : w - 6;
    }

    // Ordre des lignes : la plus courte (l'écart) du côté du bord arrondi, là où l'écran est le plus étroit.
    function edgeOrder(delta as Array, others as Array) as Array {
        var flags = getObscurityFlags();
        var topEdge = (flags & OBSCURE_TOP) != 0;
        var bottomEdge = (flags & OBSCURE_BOTTOM) != 0;
        if (topEdge && !bottomEdge) {
            return [delta].addAll(others);
        }
        if (bottomEdge && !topEdge) {
            return others.add(delta);
        }
        return others.size() > 0 ? [others[0], delta].addAll(others.slice(1, null)) : [delta];
    }

    // Taille d'une police système, de 0 (XTINY) à 4 (LARGE).
    function fontRank(font) as Number {
        if (font == Graphics.FONT_LARGE) {
            return 4;
        }
        if (font == Graphics.FONT_MEDIUM) {
            return 3;
        }
        if (font == Graphics.FONT_SMALL) {
            return 2;
        }
        if (font == Graphics.FONT_TINY) {
            return 1;
        }
        return 0;
    }

    function linesHeight(dc as Graphics.Dc, lines as Array) as Number {
        var total = 0;
        for (var i = 0; i < lines.size(); i++) {
            total += dc.getFontHeight(lines[i][1]);
        }
        return total;
    }

    // Hauteur utilisable du champ [haut, bas] : marge du côté des bords arrondis.
    function area(h as Number) as Array<Number> {
        var flags = getObscurityFlags();
        var top = (flags & OBSCURE_TOP) != 0 ? (h * 0.10).toNumber() : 2;
        var bottom = (flags & OBSCURE_BOTTOM) != 0 ? h - (h * 0.10).toNumber() : h - 2;
        return [top, bottom] as Array<Number>;
    }

    // Dessine des lignes [texte, police, couleur, rang] centrées dans le champ, en évitant les bords
    // arrondis. Texte : chaîne ou variantes (voir pick). Si tout ne tient pas en hauteur : grand chiffre
    // ramené à la police moyenne, puis lignes facultatives retirées, la moins utile (rang le plus élevé)
    // d'abord (rang 0 ou absent : toujours affichée), puis polices réduites, les plus grandes d'abord.
    function drawLines(dc as Graphics.Dc, all as Array) as Void {
        var lines = all;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var a = area(h);
        var top = a[0];
        var bottom = a[1];
        var fonts = [Graphics.FONT_XTINY, Graphics.FONT_TINY, Graphics.FONT_SMALL, Graphics.FONT_MEDIUM];
        var total = linesHeight(dc, lines);
        while (total > bottom - top) {
            var big = -1;
            var bigRank = 0;
            var drop = -1;
            var dropRank = 0;
            for (var i = 0; i < lines.size(); i++) {
                var fr = fontRank(lines[i][1]);
                if (fr > bigRank) {
                    big = i;
                    bigRank = fr;
                }
                var r = lines[i].size() > 3 ? lines[i][3] as Number : 0;
                if (r > dropRank) {
                    drop = i;
                    dropRank = r;
                }
            }
            if (bigRank == 4 || (drop < 0 && big >= 0)) {
                for (var i = 0; i < lines.size(); i++) {
                    if (fontRank(lines[i][1]) == bigRank) {
                        lines[i][1] = fonts[bigRank - 1];
                    }
                }
            } else if (drop >= 0) {
                var kept = [];
                for (var i = 0; i < lines.size(); i++) {
                    if (i != drop) {
                        kept.add(lines[i]);
                    }
                }
                lines = kept;
            } else {
                break;
            }
            total = linesHeight(dc, lines);
        }
        var y = top + (bottom - top - total) / 2;
        for (var i = 0; i < lines.size(); i++) {
            var font = lines[i][1];
            var fh = dc.getFontHeight(font);
            dc.setColor(lines[i][2], Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, y, font, pick(dc, lines[i][0], font, usableWidth(y + fh / 2, h, w)), Graphics.TEXT_JUSTIFY_CENTER);
            y += fh;
        }
    }

    // Arrivée au ravito : distance, D+ et D- jusqu'au ravito suivant (ou l'arrivée), puis « À emporter »
    // et le contenu du sac, un élément par ligne si la hauteur le permet, sinon deux voisins réunis.
    function drawBag(dc as Graphics.Dc, fg) as Void {
        var entries = plan.bag(bagLeg);
        var from = plan.legFrom[bagLeg];
        var to = plan.legTo[bagLeg];
        var d0 = (from >= 0 && from < plan.cpDist.size()) ? plan.cpDist[from].toFloat() : 0.0;
        var d1 = (to >= 0 && to < plan.cpDist.size()) ? plan.cpDist[to].toFloat() : plan.total.toFloat();
        var toName = (to >= 0 && to < plan.cpName.size()) ? plan.cpName[to] : "Arrivée";
        var a = area(dc.getHeight());
        var avail = a[1] - a[0] - dc.getFontHeight(Graphics.FONT_XTINY);
        var font = Graphics.FONT_SMALL;
        if (entries.size() * dc.getFontHeight(font) > avail) {
            font = Graphics.FONT_XTINY;
        }
        var rows = avail / dc.getFontHeight(font);
        if (rows < 1) {
            rows = 1;
        }
        // Trop d'éléments pour la hauteur : on réunit chaque fois les deux voisins dont la ligne commune est
        // la plus courte (« 1.2 L d'eau · 3 Gel »), pour qu'aucune ligne ne soit tronquée si possible.
        var items = entries;
        while (items.size() > rows) {
            var best = 0;
            var bestW = -1;
            for (var i = 0; i + 1 < items.size(); i++) {
                var w = dc.getTextWidthInPixels(items[i] + " · " + items[i + 1], font);
                if (bestW < 0 || w < bestW) {
                    best = i;
                    bestW = w;
                }
            }
            var merged = [] as Array<String>;
            for (var i = 0; i < items.size(); i++) {
                if (i == best) {
                    merged.add(items[i] + " · " + items[i + 1]);
                } else if (i != best + 1) {
                    merged.add(items[i]);
                }
            }
            items = merged;
        }
        var title = "À emporter";
        // Ravito suivant : son nom (ligne courte) au-dessus des chiffres.
        var leg = [
            [toName.equals("Arrivée") ? "Vers l'arrivée" : "Vers " + toName, Graphics.FONT_XTINY, fg, 1],
            [remaining(d0, d1), Graphics.FONT_XTINY, fg, 0]
        ];
        // Champ collé à un seul bord arrondi (demi-écran) : lignes du sac de la plus courte, côté bord où
        // l'écran est étroit, à la plus longue, côté centre (tri par insertion selon la largeur).
        var flags = getObscurityFlags();
        var topEdge = (flags & OBSCURE_TOP) != 0 && (flags & OBSCURE_BOTTOM) == 0;
        var bottomEdge = (flags & OBSCURE_BOTTOM) != 0 && (flags & OBSCURE_TOP) == 0;
        if (topEdge || bottomEdge) {
            for (var i = 1; i < items.size(); i++) {
                var t = items[i];
                var tw = dc.getTextWidthInPixels(t, font);
                var j = i - 1;
                while (j >= 0) {
                    var jw = dc.getTextWidthInPixels(items[j], font);
                    if (topEdge ? jw <= tw : jw >= tw) {
                        break;
                    }
                    items[j + 1] = items[j];
                    j--;
                }
                items[j + 1] = t;
            }
        }
        var lines = [[from >= 0 && from < plan.cpName.size() ? [title + " · " + plan.cpName[from], title] : title, Graphics.FONT_XTINY, fg, 2]];
        for (var i = 0; i < items.size(); i++) {
            lines.add([items[i], font, fg, 0]);
        }
        // Ligne la plus longue (les chiffres) loin du bord arrondi : champ collé au bord du haut, ravito
        // suivant en bas du champ ; sinon en haut.
        if (topEdge) {
            drawLines(dc, lines.addAll(leg));
        } else {
            drawLines(dc, leg.addAll(lines));
        }
    }

    // Taille du champ rapportée à la hauteur de l'écran (de 240 px sur fēnix 5S Plus à 454 px sur fēnix 8
    // AMOLED) : 0 petit champ (quart ou tiers d'écran), 1 demi-écran, 2 plein écran.
    function fieldSize(h as Number) as Number {
        var r = h.toFloat() / System.getDeviceSettings().screenHeight;
        return r < 0.32 ? 0 : (r < 0.61 ? 1 : 2);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var bg = getBackgroundColor();
        var dark = bg == Graphics.COLOR_BLACK;
        var fg = dark ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        var red = dark ? Graphics.COLOR_RED : Graphics.COLOR_DK_RED;
        var green = dark ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN;
        dc.setColor(fg, bg);
        dc.clear();
        var size = fieldSize(dc.getHeight());

        if (plan == null) {
            drawLines(dc, [[status, Graphics.FONT_XTINY, fg]]);
            return;
        }
        if (!running) {
            // Avant le départ : nom, distance, D+ et temps prévu ; heure de départ pour une course seulement.
            var dur = duration(plan.finishTime());
            var intro = [
                [plan.name, Graphics.FONT_XTINY, fg, 1],
                [courseStats(), Graphics.FONT_SMALL, fg, 0],
                [["Temps prévu " + dur, "Prévu " + dur, dur], Graphics.FONT_XTINY, fg, 2]
            ];
            if (plan.isRace()) {
                intro.add(plan.start > 0 ? ["Départ " + clock(plan.start), Graphics.FONT_SMALL, fg, 0] : ["Départ libre", Graphics.FONT_XTINY, fg, 3]);
            }
            drawLines(dc, intro);
            return;
        }
        var now = Time.now().value();
        if (now < fuelUntil) {
            // Rappel nutrition : produit prévu et eau à boire d'ici le rappel suivant.
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_ORANGE);
            dc.clear();
            var big = size > 0 ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL;
            if (foodMsg < 0 || foodMsg >= plan.foodP.size()) {
                drawLines(dc, [["Manger / boire", big, Graphics.COLOR_WHITE]]);
                return;
            }
            var meal = [["Manger / boire", Graphics.FONT_XTINY, Graphics.COLOR_WHITE, 2], [plan.foodLabel(foodMsg), big, Graphics.COLOR_WHITE, 0]];
            var water = plan.foodWater(foodMsg);
            if (water >= 0.05) {
                meal.add(["Boire " + water.format("%.1f") + " L", Graphics.FONT_XTINY, Graphics.COLOR_WHITE, 1]);
            }
            drawLines(dc, meal);
            return;
        }
        if (now < lapMsgUntil) {
            // Tour validé : point de passage noté, estimations recalculées.
            drawLines(dc, [["Passage", Graphics.FONT_XTINY, fg], [lapMsg, size > 0 ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL, green]]);
            return;
        }
        if (bagLeg >= 0 && now < bagUntil && dist < bagFrom + 300) {
            drawBag(dc, fg);
            return;
        }

        var deltaColor = delta > 60 ? red : (delta < -60 ? green : fg);
        // Polices texte (et non chiffres) : « ' », « + » et « h » y sont toujours disponibles.
        var deltaText = signedMinutes(delta);
        var nextName = next >= 0 ? plan.cpName[next] : "Arrivée";
        var target = next >= 0 ? plan.cpDist[next].toFloat() : plan.total.toFloat();
        // Distance, D+ et D- restants jusqu'au prochain point (« Hors parcours » quand on s'en écarte).
        var toNext = remaining(dist, target);
        var toNextColor = fg;
        if (offRoute) {
            toNext = ["Hors parcours · " + offBy + " m"] as Array<String>;
            toNextColor = red;
        }
        // Jusqu'à l'arrivée (réglage sur la montre), sauf si le prochain point est l'arrivée.
        var toFinish = null;
        if (Application.Properties.getValue("finishStats") == true && next >= 0 && target < plan.total - 50) {
            var r = remaining(dist, plan.total.toFloat());
            var f = ["Arrivée · " + r[0]];
            for (var k = 0; k < r.size(); k++) {
                f.add("Arr. " + r[k]);
            }
            toFinish = [f, Graphics.FONT_XTINY, fg, 1];
        }

        var cutText = null;
        var cutColor = fg;
        var cutWarn = cutIdx >= 0 && margin < CUTOFF_WARN;
        if (cutIdx >= 0) {
            cutText = margin >= 0 ? "Marge BH " + signedMinutes(margin) : "Hors délai " + signedMinutes(margin);
            cutColor = cutWarn ? red : fg;
        }

        if (size == 0) {
            // Petit champ (quart d'écran) : écart et ce qui reste jusqu'au prochain point (son nom à la
            // place du dénivelé avec le plan d'une ancienne version).
            var small = [[offRoute || plan.hasClimb() ? toNext : toNext[0] + " · " + nextName, Graphics.FONT_XTINY, toNextColor, 0]];
            if (toFinish != null) {
                small.add(toFinish);
            }
            drawLines(dc, edgeOrder([deltaText, Graphics.FONT_MEDIUM, deltaColor, 0], small));
            return;
        }

        if (size == 1) {
            // Demi-écran (ex. Enduro 3 : 280 × 140) : écart, prochain point et heure estimée, ce qui reste
            // jusqu'à ce point, [jusqu'à l'arrivée], [barrière horaire proche].
            var est = next >= 0 ? clock(nextEta) : clock(finishEta);
            var half = [
                [[nextName + " · Est. " + est, nextName + " · " + est, est + " · " + nextName], Graphics.FONT_XTINY, fg, 2],
                [toNext, Graphics.FONT_XTINY, toNextColor, 0]
            ];
            if (toFinish != null) {
                half.add(toFinish);
            }
            if (cutWarn) {
                half.add([cutText, Graphics.FONT_XTINY, cutColor, 0]);
            }
            drawLines(dc, edgeOrder([deltaText, Graphics.FONT_LARGE, deltaColor, 0], half));
            return;
        }

        // Plein écran : prochain point, ce qui reste jusqu'à lui, écart, heures prévue et estimée,
        // [jusqu'à l'arrivée], barrière horaire ou heure d'arrivée estimée.
        var lines = [
            [nextName, Graphics.FONT_XTINY, fg, 2],
            [toNext, Graphics.FONT_XTINY, toNextColor, 0],
            [deltaText, Graphics.FONT_LARGE, deltaColor, 0]
        ];
        if (next >= 0) {
            lines.add([["Prévu " + clock(startUnix + plan.cpPlan[next]) + " · Est. " + clock(nextEta), "Est. " + clock(nextEta)], Graphics.FONT_XTINY, fg, 3]);
        }
        if (toFinish != null) {
            lines.add(toFinish);
        }
        lines.add(cutText != null ? [cutText, Graphics.FONT_XTINY, cutColor, cutWarn ? 0 : 3] : ["Arrivée " + clock(finishEta), Graphics.FONT_XTINY, fg, 3]);
        drawLines(dc, lines);
    }
}

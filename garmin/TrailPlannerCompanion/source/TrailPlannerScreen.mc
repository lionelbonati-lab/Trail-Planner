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

// TrailPlannerScreen.mc — écran Trail Planner de l'appli Trail Planner Companion : le champ de données
// Trail Planner (garmin/TrailPlannerField/source/TrailPlannerField.mc), repris à l'identique. C'est aussi
// le moteur de suivi de toute l'appli (position calée sur le tracé, passages, estimations, rappels) : le
// profil, la carte et l'envoi à l'assistance lisent ses données. Adaptations, signalées « Appli : » :
// - classe simple (plus de WatchUi.DataField) : Run appelle compute() chaque seconde et onTimerLap() au
//   bouton Lap, MainView appelle onUpdate() ; le plan est donné par Run (setPlan) ;
// - écran redessiné au style d'EndurancePro (onUpdate, entre ses bandeaux) : colonnes prochain point /
//   arrivée, colonne centrale d'EP, barre de progression entre ravitos, écart réel / prévu ; au ravito,
//   « À consommer » / « À prendre », temps passé et tronçon suivant ; thème d'EP ;
// - rappels nutrition et alerte de barrière : popup d'EP (sur tous les écrans) ; arrivée au ravito :
//   l'appli bascule sur cet écran (focusKey) ;
// - suivi gardé dans `progress` et envoyé par Run (au lieu de la tâche de fond du champ).
// Une évolution du champ se reporte ici à la main.
//
// Champ de données : avance/retard sur le plan, prochain point, heure estimée,
// marge sur la prochaine barrière horaire et rappels de nutrition (produit prévu, sac « À emporter »
// à l'arrivée à un ravito).
// Heures prévues : fixes pendant toute l'activité. Heures estimées des points : recalculées à chaque
// passage (bouton Lap ou détection GPS) d'après ce qui a déjà été fait, fixes entre deux passages.
class TrailPlannerScreen {
    // Le retard (ou l'avance) se prolonge sur la suite, amorti de 30 % et borné (comme l'app web).
    const DAMPING = 0.7;
    const CUTOFF_WARN = 1800; // s : alerte si la marge passe sous 30 min
    const START_ZONE = 2000.0; // m : calage immédiat sur le début du parcours
    const CONFIRM_S = 120;     // s sur le tracé avant de se caler ailleurs (départ en cours de parcours)
    const BRIDGE_MAX = 500.0;  // m de distance montre au plus sans position GPS, si l'on était sur le tracé

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
    var bagCp = -1;           // point dont l'écran de passage est affiché (sac du ravito, note du point)
    var bagLeg = -1;          // tronçon dont le sac « À emporter » est affiché (-1 : note seule)
    var bagUntil = 0;         // s Unix : affichage du sac jusqu'à cet instant...
    var bagFrom = 0.0;        // ... et jusqu'à 300 m après ce ravito (m)
    var passes = {};          // indice du point -> instant de passage (s Unix)
    var departs = {};         // ravito -> instant de départ (2e tour Lap au ravito, s Unix)
    var lapTitle = "Passage"; // titre de l'écran du dernier tour (« Passage », « Départ »)
    var barFrom = -2;         // barre de progression : ravito de départ du tronçon dessiné (cache)...
    var barDots = [] as Array<Float>; // ... distances des rappels de produits de ce tronçon (m)
    var barFirst = 0;         // ... indice (dans plan.foodP) du premier de ces produits
    var lastElapsed = 0.0;    // pour détecter une nouvelle activité
    var lastSaved = 0;        // dernier enregistrement du suivi (s Unix)
    var planText = null;      // texte du plan chargé (seul un plan modifié est relu)
    var matched = -1.0;       // m le long du parcours au dernier calage GPS (-1 : pas encore calé)
    var matchedAt = 0.0;      // distance montre (m) à ce calage
    var offCount = 0;         // relevés GPS consécutifs hors du tracé
    var offRoute = false;     // hors du tracé depuis 5 relevés
    var candidate = -1.0;     // premier calage en attente de confirmation : m le long du parcours (-1 : aucun)...
    var candidateAt = 0.0;    // ... distance montre (m) à ce relevé...
    var candidateSince = 0;   // ... et début de la présence sur le tracé (s Unix)
    var offBy = 0;            // écart au tracé (m)
    var etas = [] as Array<Number>; // heure estimée (s Unix) de chaque point, recalculée aux passages
    var lapped = {};          // points validés par un tour (bouton Lap)
    var lapOffset = 0.0;      // sans tracé GPS : correction de distance apportée par les tours (m)
    var lastWalked = 0.0;     // distance montre au dernier calcul (m)
    var lapMsg = "";          // nom du point validé par le dernier tour
    var lapMsgUntil = 0;      // s Unix : affichage du passage jusqu'à cet instant
    // Appli : alerte de barrière (écran affiché jusqu'à cet instant), suivi à envoyer par Run.
    var cutUntil = 0;
    var progress = null;      // dernier relevé (Dictionary : t, s, d, p, lat, lon, bat)
    var progressDirty = false; // passages changés depuis le dernier envoi
    var paceRatio = 1.0;      // rythme réel / prévu au dernier passage (durée du tronçon suivant au ravito)

    function initialize() {
    }

    // Appli : nouveau plan, donné par Run à chaque téléchargement (toutes les 5 min) quand il a changé.
    // Il faut alors recaler la position sur tout le parcours ; en course, les passages et alertes déjà
    // notés sont gardés (rapportés aux points du nouveau plan). Comme reload() dans le champ.
    function setPlan(p) as Void {
        if (p == plan) {
            return;
        }
        var old = plan;
        plan = p;
        if (plan == null) {
            return;
        }
        matched = -1.0;
        candidate = -1.0;
        offCount = 0;
        offRoute = false;
        etas = [] as Array<Number>;
        food = 0;
        foodAt = -1.0;
        foodSync = true;
        bagCp = -1;
        bagLeg = -1;
        bagUntil = 0;
        barFrom = -2;
        if (running && old != null && plan != null) {
            passes = remap(passes, old, plan);
            departs = remap(departs, old, plan);
            alerted = remap(alerted, old, plan);
            lapped = remap(lapped, old, plan);
        } else {
            passes = {};
            departs = {};
            alerted = {};
            lapped = {};
            nextFuel = 0.0;
        }
    }

    // Appli : fond du thème d'EndurancePro (réglage Mode sombre).
    function getBackgroundColor() as Number {
        return themeBg();
    }

    // Appli : événement qui fait basculer l'appli sur cet écran (null : aucun) — arrivée à un ravito,
    // jusqu'au départ (les rappels et la barrière passent par le popup d'EP, sur tous les écrans). Une
    // même clé ne fait basculer qu'une fois.
    function focusKey(now as Number) as String or Null {
        if (plan == null || !running || bagLeg < 0 || !ravitoShown(now)) {
            return null;
        }
        return "r" + bagCp;
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
    // Avec le tracé du plan (ligne G) : la position vient du GPS, calée sur le tracé près de la position
    // attendue (dernier calage + distance montre parcourue depuis), sans erreur cumulée ni souci de
    // parcours modifié (raccourci, détour). Premier calage : voir firstMatch (croiser le parcours ne suffit
    // pas). Hors du tracé, la distance reste figée (« Hors parcours »). Sans position GPS utilisable (forêt
    // dense, tunnel) : la distance montre prend le relais, 500 m au plus, seulement si le dernier relevé
    // était sur le tracé ; sinon la distance reste figée, et elle n'avance jamais avant le premier calage.
    // Sans tracé (plan d'une ancienne version) : navigation du parcours si elle est active et
    // cohérente, sinon distance parcourue.
    function courseDistance(info as Activity.Info) as Float {
        var walked = info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        if (plan.hasRoute()) {
            var since = walked - matchedAt;
            var loc = info.currentLocation;
            var q = info.currentLocationAccuracy;
            // Appli : 2 = Position.QUALITY_POOR (module Position non importé : pas de permission nécessaire) ;
            // qualité « faible » acceptée (le champ demande « utilisable », 3) : simulateur, premières secondes.
            if (loc == null || (q != null && q < 2)) {
                if (matched >= 0 && offCount == 0) {
                    return matched + (since < BRIDGE_MAX ? since : BRIDGE_MAX);
                }
                return matched >= 0 ? matched : 0.0;
            }
            var deg = loc.toDegrees();
            var maxOff = plan.onRouteMax();
            if (matched < 0) {
                return firstMatch(deg, walked, maxOff);
            }
            var r = plan.locate(deg[0], deg[1], matched - 300.0, matched + since * 1.2 + 1000.0, matched + since, 1.0, maxOff);
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
            return matched;
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

    // Premier calage sur le tracé : recherche sur tout le parcours toutes les 5 s, au plus près du départ.
    // Sur les 2 premiers km du parcours : calé tout de suite. Ailleurs (départ en cours de parcours) : la
    // position doit rester sur le tracé 2 min de suite, suivie près de la position attendue, sinon on
    // repart de zéro ; croiser le parcours ne suffit donc pas. Renvoie 0 tant que ce n'est pas fait.
    function firstMatch(deg as Array, walked as Float, maxOff as Float) as Float {
        if (candidate < 0 && offCount % 5 != 0) {
            offCount++;
            offRoute = offCount >= 5;
            return 0.0;
        }
        var now = Time.now().value();
        var r = candidate < 0
            ? plan.locate(deg[0], deg[1], 0.0, plan.total + 1000.0, 0.0, 0.1, maxOff)
            : plan.locate(deg[0], deg[1], candidate - 300.0, candidate + (walked - candidateAt) * 1.2 + 300.0, candidate + walked - candidateAt, 1.0, maxOff);
        if (r[0] == null) {
            candidate = -1.0;
            offCount++;
            offRoute = offCount >= 5;
            offBy = r[1] != null && r[1] > 0 ? r[1].toNumber() : 0;
            return 0.0;
        }
        if (candidate < 0) {
            candidateSince = now;
        }
        candidate = r[0];
        candidateAt = walked;
        offCount = 0;
        offRoute = false;
        if (candidate > START_ZONE && now - candidateSince < CONFIRM_S) {
            return 0.0;
        }
        matched = candidate;
        matchedAt = walked;
        candidate = -1.0;
        return matched;
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
            paceRatio = ratio;
            // Départ réel du ravito (2e tour Lap) s'il est connu, sinon arrivée + arrêt prévu.
            t0 = departs.hasKey(ref) ? departs[ref] as Number : passes[ref] + plan.cpStop[ref];
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
    // la position calée sur le tracé (500 m sans tracé GPS calé). Heure de passage = maintenant,
    // position recalée sur le point, heures estimées des points suivants recalculées. Un tour loin de
    // tout point (tour auto au km…) est ignoré.
    // Appli : tour validé à la fin du décompte d'annulation (8 s, Run.commitLap) ; heure et position de
    // l'appui (pressAt, pressDist), message affiché à partir de maintenant.
    function onTimerLap(pressAt as Number, pressDist as Float) as Void {
        if (plan == null || !running || Application.Properties.getValue("lapPass") == false) {
            return;
        }
        var now0 = pressAt;
        var shownAt = Time.now().value();
        // 2e tour au ravito (arrivée déjà validée par un tour, écran du ravito affiché) : départ du ravito.
        // L'écran se ferme et les heures estimées repartent du départ réel.
        if (bagCp >= 0 && bagLeg >= 0 && lapped.hasKey(bagCp) && ravitoShown(now0)) {
            departs.put(bagCp, now0);
            lapTitle = "Départ";
            lapMsg = plan.cpName[bagCp];
            lapMsgUntil = shownAt + 5;
            bagCp = -1;
            updateEstimates();
            lastSaved = 0;
            progressDirty = true;
            return;
        }
        var gps = plan.hasRoute() && matched >= 0;
        // Sans tracé calé, la distance peut dériver, mais une fenêtre trop large (8 % de la distance,
        // 2,4 km au km 30) faisait valider par un tour, manuel ou automatique, un point loin devant.
        // Avec le GPS calé : un point devant à 150 m au plus (un tour 300 m avant la buvette la validait),
        // un point derrière à 300 m au plus.
        var win = gps ? 300.0 : 500.0;
        var ahead = gps ? 150.0 : 500.0;
        var best = -1;
        var bestGap = 0.0;
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (lapped.hasKey(i)) {
                continue;
            }
            var gap = plan.cpDist[i] - pressDist;
            if (gap > ahead) {
                continue;
            }
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
        var now = pressAt;
        var at = plan.cpDist[best].toFloat();
        lapped.put(best, true);
        passes.put(best, now);
        if (gps) {
            matched = at;
            matchedAt = lastWalked;
            offCount = 0;
            offRoute = false;
        } else {
            lapOffset += at - pressDist;
        }
        dist = at;
        updateEstimates();
        showBag(best, now);
        lapTitle = "Passage";
        lapMsg = plan.cpName[best];
        lapMsgUntil = shownAt + 5;
        lastSaved = 0; // suivi envoyé au prochain calcul
        progressDirty = true;
    }

    // Arrivée à un ravito : pause en cours, à manger sur place, sac « À emporter » du tronçon qui en part et
    // note du point, jusqu'au départ (2e tour Lap) ou 300 m plus loin (2 h au plus). Point sans sac mais avec
    // une note : la note, pendant l'arrêt prévu (1 min au moins) et tant qu'on n'est pas 300 m plus loin.
    function showBag(i as Number, now as Number) as Void {
        var l = plan.legFromCp(i);
        var note = i < plan.cpNote.size() ? plan.cpNote[i] : "";
        if ((l < 0 && note.length() == 0) || i == bagCp) {
            return;
        }
        var stop = plan.cpStop[i];
        bagCp = i;
        bagLeg = l;
        bagUntil = now + (l >= 0 ? 7200 : (stop < 60 ? 60 : stop));
        bagFrom = plan.cpDist[i].toFloat();
    }

    // Écran du ravito (ou de la note) encore affiché.
    function ravitoShown(now as Number) as Boolean {
        return bagCp >= 0 && now < bagUntil && dist < bagFrom + 300;
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

    // Appli : rappel « Manger / boire » en popup d'EndurancePro, sur tous les écrans, 30 s : produit
    // prévu et eau à boire d'ici le rappel suivant (« Gel · 0.2 L »).
    function notifyFood(k as Number) as Void {
        var text = "Manger / boire";
        if (plan != null && k >= 0 && k < plan.foodP.size()) {
            text = plan.foodLabel(k);
            var water = plan.foodWater(k);
            if (water >= 0.05) {
                text += " · " + water.format("%.1f") + " L";
            }
        }
        getRun().ep.showPopup(false, ICON_FOOD, text, 30);
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
            candidate = -1.0;
            matchedAt = 0.0;
            offCount = 0;
            offRoute = false;
            lapped = {};
            lapOffset = 0.0;
            etas = [] as Array<Number>;
            food = 0;
            foodAt = -1.0;
            foodSync = true;
            bagCp = -1;
            bagLeg = -1;
            bagUntil = 0;
            departs = {};
            barFrom = -2;
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
        // Passage (tour Lap ou position) contredit par le GPS calé sur le tracé (coureur à plus de 200 m
        // avant le point) : annulé, le point sera de nouveau détecté en y arrivant.
        if (plan.hasRoute() && matched >= 0) {
            var lk = passes.keys();
            for (var k = 0; k < lk.size(); k++) {
                var li = lk[k] as Number;
                if (li < plan.cpDist.size() && d < plan.cpDist[li] - 200) {
                    passes.remove(li);
                    lapped.remove(li);
                    departs.remove(li);
                    if (bagCp == li) {
                        bagCp = -1;
                    }
                    changed = true;
                }
            }
        }
        var last = -1;
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (!passes.hasKey(i) && d >= plan.cpDist[i] - 30) {
                passes.put(i, now);
                changed = true;
                last = i;
            }
        }
        // Départ d'un ravito noté tout seul à 150 m après le point, 300 m après une base de vie (sans
        // attendre un 2e tour Lap) : temps passé au ravito envoyé à l'assistance.
        for (var i = 0; i < plan.cpDist.size(); i++) {
            var away = i < plan.cpBase.size() && plan.cpBase[i] ? 300 : 150;
            if (plan.cpKind[i].equals("r") && passes.hasKey(i) && !departs.hasKey(i) && d > plan.cpDist[i] + away) {
                departs.put(i, now);
                changed = true;
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
                    margin = plan.cutAt(i, startUnix) - etas[i];
                    break;
                }
            }
        }
        if (cutIdx >= 0 && margin < CUTOFF_WARN && !alerted.hasKey(cutIdx)) {
            alerted.put(cutIdx, true);
            vibrate(true);
            cutUntil = now + 10;
            // Appli : popup d'EndurancePro, 10 s.
            getRun().ep.showPopup(true, ICON_ALARM, (margin >= 0 ? "BH " : "Hors délai ") + signedMinutes(margin), 10);
        }

        if (changed || now - lastSaved >= 60) {
            saveProgress(info, now, d, changed);
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
                notifyFood(hit);
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
                    notifyFood(-1);
                }
            }
        }
    }

    // Suivi envoyé à l'assistance via le téléphone (appli : par Run, au lieu de la tâche de fond).
    function saveProgress(info as Activity.Info, now as Number, d as Float, changed as Boolean) as Void {
        // Passages « indice:arrivée », et « indice:arrivée:départ » pour un ravito quitté (temps passé au
        // ravito) : même champ, accepté tel quel par les règles Firestore et lu par les anciennes pages.
        var p = "";
        var keys = passes.keys();
        for (var k = 0; k < keys.size(); k++) {
            p += (k > 0 ? "," : "") + keys[k] + ":" + passes[keys[k]];
            if (departs.hasKey(keys[k])) {
                p += ":" + departs[keys[k]];
            }
        }
        var rec = { "t" => now, "s" => startUnix, "d" => d.toNumber(), "p" => p };
        var loc = info.currentLocation;
        if (loc != null) {
            var deg = loc.toDegrees();
            rec.put("lat", deg[0].toFloat());
            rec.put("lon", deg[1].toFloat());
        }
        var stats = System.getSystemStats();
        if (stats != null && stats.battery != null) {
            rec.put("bat", stats.battery.toNumber());
        }
        progress = rec;
        if (changed) {
            progressDirty = true;
        }
        lastSaved = now;
    }

    // --- Mise en forme ------------------------------------------------------

    function clock(sec as Number) as String {
        var t = Gregorian.info(new Time.Moment(sec), Time.FORMAT_SHORT);
        return (t.hour as Number).format("%02d") + ":" + (t.min as Number).format("%02d");
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

    // Raccourcit un texte pour qu'il tienne dans maxW pixels.
    function fit(dc as Graphics.Dc, text as String, font, maxW as Number) as String {
        var t = text;
        while (t.length() > 3 && dc.getTextWidthInPixels(t, font) > maxW) {
            t = t.substring(0, t.length() - 1) as String;
        }
        return t;
    }

    // Éléments du sac sur au plus `rows` lignes : on réunit chaque fois les deux voisins dont la ligne
    // commune est la plus courte (« 1.2 L d'eau · 3 Gel »), pour qu'aucune ligne ne soit tronquée si possible.
    function packItems(dc as Graphics.Dc, entries as Array<String>, font, rows as Number) as Array<String> {
        var items = entries;
        while (items.size() > rows && items.size() > 1) {
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
        return items;
    }

    // Plus grande police (petite, très petite, minuscule) dans laquelle le texte tient sur maxW ; s'il ne
    // tient dans aucune, la plus petite (et le texte est raccourci).
    function lineFont(dc as Graphics.Dc, text as String, maxW as Number) {
        var fonts = [Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY];
        for (var i = 0; i < fonts.size() - 1; i++) {
            if (dc.getTextWidthInPixels(text, fonts[i]) <= maxW) {
                return fonts[i];
            }
        }
        return fonts[fonts.size() - 1];
    }

    // Durée en minutes et secondes : « 4:05 », « 1:02:30 ».
    function mmss(sec as Number) as String {
        var s0 = sec > 0 ? sec : 0;
        var h0 = s0 / 3600;
        var m0 = (s0 % 3600) / 60;
        var r0 = (s0 % 60).format("%02d");
        return h0 > 0 ? h0 + ":" + m0.format("%02d") + ":" + r0 : m0 + ":" + r0;
    }

    // --- Appli : écran au style d'EndurancePro ------------------------------------------------------
    // Mêmes éléments graphiques qu'EP, entre ses bandeaux (FC, tour, 2e métrique, barre FC en haut ;
    // autonomie, mode d'allure, heure en bas) : colonne gauche = vers le prochain point (km, D+, D-),
    // colonne centrale d'EP, colonne droite = vers l'arrivée (km, D+, D-) ; à la place de la batterie,
    // la progression d'un ravito au suivant ; dessous, écart réel / prévu et heure estimée au prochain
    // point ; à la place du chrono, le prochain point (ou passage, hors parcours, marge sur la barrière en
    // alternance). Au ravito : « À consommer » / « À prendre » en alternance, tronçon suivant, temps passé
    // sur l'arrêt prévu, durée prévue du tronçon suivant.

    // Icônes d'EP (polices iconsMed et paramIcons).
    const ICON_WAYPOINT = "";
    const ICON_FOOD = "";
    const ICON_FLAG = "";
    const ICON_DOWN_R = "";
    const ICON_UP_R = "";
    const ICON_ALARM = "";

    // Demi-largeur de l'écran rond à la hauteur y.
    function halfChord(y as Number, w as Number, h as Number) as Number {
        var r = w / 2.0;
        var dy = y - h / 2.0;
        var c2 = r * r - dy * dy;
        return c2 > 0 ? Math.sqrt(c2).toNumber() : 0;
    }

    // Valeur centrée sur l'axe x avec son icône à gauche, comme les colonnes d'EP.
    function iconValue(dc as Graphics.Dc, l, x as Number, y as Number, icon as String, value as String, color, fg) as Void {
        var font = l.fontSecondary;
        var vx = x - dc.getTextWidthInPixels(value, font) / 2;
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(vx, y, font, value, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(vx - 5, y + l.iconSmallOffsetY, getRun().ep.iconFonts()[0], icon, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // Colonne « km, D+, D- » de la distance `from` à la distance `to` (m), sur l'axe x.
    function legColumn(dc as Graphics.Dc, l, x as Number, from as Float, to as Float, icon as String, fg) as Void {
        var m = to - from;
        iconValue(dc, l, x, l.dataRowTopY, icon, ((m > 0 ? m : 0.0) / 1000.0).format("%.1f"), fg, fg);
        var up = "--";
        var dn = "--";
        if (plan.hasClimb()) {
            var c = plan.climbBetween(from, to);
            up = c[0].toString();
            dn = c[1].toString();
        }
        iconValue(dc, l, x, l.dataRowMidY, ICON_UP_R, up, fg, fg);
        iconValue(dc, l, x, l.dataRowBotY, ICON_DOWN_R, dn, fg, fg);
    }

    // Durée courte : « 45' », « 2h15 ».
    function shortDuration(sec as Number) as String {
        var m = (sec + 30) / 60;
        return m < 60 ? m + "'" : (m / 60) + "h" + (m % 60).format("%02d");
    }

    // Ligne du bas (place du chrono d'EP), raccourcie à la largeur de l'écran rond.
    // Appli : la plus grande police (moyenne à minuscule) dans laquelle le texte tient entier dans l'écran
    // rond à cette hauteur ; coupé seulement s'il ne tient dans aucune (nom du prochain point).
    function bottomLine(dc as Graphics.Dc, l, text as String, color) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var y = l.TimerY;
        var fonts = [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY, Graphics.FONT_XTINY];
        var font = Graphics.FONT_XTINY;
        var maxW = w;
        for (var i = 0; i < fonts.size(); i++) {
            font = fonts[i];
            var fh = dc.getFontHeight(font);
            var lo = halfChord(y - fh / 2, w, h);
            var hi = halfChord(y + fh / 2, w, h);
            maxW = isRound() ? 2 * (lo < hi ? lo : hi) - 10 : w - 10;
            if (dc.getTextWidthInPixels(text, font) <= maxW) {
                break;
            }
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, y, font, fit(dc, text, font, maxW), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // Barre à la place de la batterie d'EP : remplie de la fraction f (0 à 1), sans icône.
    function barFrame(dc as Graphics.Dc, l, f as Float, color, fg) as Void {
        var fw = (l.batBarW * (f < 0 ? 0.0 : (f > 1 ? 1.0 : f))).toNumber();
        if (fw > 2 * l.batBarR) {
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(l.batBarX, l.batteryBarY, fw, l.batBarH, l.batBarR);
        }
        dc.setPenWidth(1);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawRoundedRectangle(l.batBarX, l.batteryBarY, l.batBarW, l.batBarH, l.batBarR);
    }

    // Abscisse (gauche) d'un texte de largeur tw centré sous l'axe de droite, ramené dans l'écran rond à la
    // hauteur y (police de hauteur fh) : l'heure d'arrivée débordait à droite.
    function rightX(dc as Graphics.Dc, l, y as Number, fh as Number, tw as Number) as Number {
        var w = dc.getWidth();
        var x = l.axisRightX - tw / 2;
        var max = isRound() ? w / 2 + halfChord(y + fh / 2, w, dc.getHeight()) - 6 : w - 6;
        return x + tw > max ? max - tw : x;
    }

    // Progression du tronçon en cours, du dernier ravito passé (ou du départ) au suivant (ou à
    // l'arrivée) : partie faite pleine, un trait par point de passage, un point par produit à prendre
    // (orange à venir, gris déjà rappelé). Sans triangle de position.
    function drawBar(dc as Graphics.Dc, l, fg) as Void {
        var dark = getBackgroundColor() == Graphics.COLOR_BLACK;
        var gray = dark ? Graphics.COLOR_DK_GRAY : Graphics.COLOR_LT_GRAY;
        var d0 = 0.0;
        var d1 = plan.total.toFloat();
        var from = -1;
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (!plan.cpKind[i].equals("r")) {
                continue;
            }
            if (passes.hasKey(i) || plan.cpDist[i] <= dist) {
                d0 = plan.cpDist[i].toFloat();
                from = i;
            } else {
                d1 = plan.cpDist[i].toFloat();
                break;
            }
        }
        if (d1 <= d0) {
            return;
        }
        // Rappels de produits du tronçon : calculés une fois par tronçon.
        if (barFrom != from) {
            barFrom = from;
            barDots = [] as Array<Float>;
            barFirst = 0;
            var lg = plan.legFromCp(from);
            if (lg >= 0) {
                barFirst = plan.legFirst[lg];
                var n = plan.legCount(lg);
                for (var k = 0; k < n; k++) {
                    barDots.add(plan.foodDist(barFirst + k));
                }
            }
        }
        var span = d1 - d0;
        barFrame(dc, l, running ? (dist - d0) / span : 0.0, fg, fg);
        var x0 = l.batBarX;
        var bw = l.batBarW;
        var y = l.batteryBarY;
        var bh = l.batBarH;
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < plan.cpDist.size(); i++) {
            var cd = plan.cpDist[i].toFloat();
            if (cd > d0 && cd < d1 && !plan.cpKind[i].equals("r")) {
                dc.fillRectangle(x0 + (((cd - d0) / span) * bw).toNumber() - 1, y - 3, 2, bh + 6);
            }
        }
        for (var k = 0; k < barDots.size(); k++) {
            dc.setColor(barFirst + k < food ? gray : Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(x0 + (((barDots[k] - d0) / span) * bw).toNumber(), y + bh / 2, 3);
        }
    }

    // Prochain point vu d'ici (avant le départ : le premier après le départ).
    function nextPoint() as Number {
        if (running) {
            return next;
        }
        for (var i = 0; i < plan.cpDist.size(); i++) {
            if (plan.cpDist[i] > 50) {
                return i;
            }
        }
        return -1;
    }

    // Distance restante (m) pour le bas de l'écran EndurancePro : jusqu'au prochain point du plan, ou
    // jusqu'à l'arrivée ; -1 sans plan.
    function remainingTo(finish as Boolean) as Float {
        if (plan == null) {
            return -1.0;
        }
        var nx = finish ? -1 : nextPoint();
        var target = nx >= 0 ? plan.cpDist[nx].toFloat() : plan.total.toFloat();
        var r = target - (running ? dist : 0.0);
        return r > 0 ? r : 0.0;
    }

    function nextIsRavito() as Boolean {
        if (plan == null) {
            return false;
        }
        var nx = nextPoint();
        return nx >= 0 && plan.cpKind[nx].equals("r");
    }

    function drawMain(dc as Graphics.Dc, l, fg, red, green) as Void {
        var now = Time.now().value();
        var ep = getRun().ep;
        ep.drawCenterColumn(dc);
        var here = running ? dist : 0.0;
        var nx = nextPoint();
        var target = nx >= 0 ? plan.cpDist[nx].toFloat() : plan.total.toFloat();
        legColumn(dc, l, l.axisLeftX, here, target, ICON_WAYPOINT, fg);
        legColumn(dc, l, l.axisRightX, here, plan.total.toFloat(), ICON_FLAG, fg);
        drawBar(dc, l, fg);

        // Sous la barre : écart réel / prévu à gauche, heure estimée au prochain point à droite. Avant le
        // départ : temps prévu du parcours.
        var font = l.fontSecondary;
        if (running) {
            var gap = dist > 200 ? signedMinutes(delta) : "0'";
            dc.setColor(delta > 60 ? red : (delta < -60 ? green : fg), Graphics.COLOR_TRANSPARENT);
            dc.drawText(l.axisLeftX, l.DistY, font, gap, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            var eta = clock(nx >= 0 && nx < etas.size() ? etas[nx] : finishEta);
            var ex = rightX(dc, l, l.DistY, dc.getFontHeight(font), dc.getTextWidthInPixels(eta, font));
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(ex, l.DistY, font, eta, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(ex - 5, l.DistY, Graphics.FONT_XTINY, "E", Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, l.DistY, font, shortDuration(plan.finishTime()), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Place du chrono : hors parcours ; passage ou départ (5 s) ; note du point ; sinon prochain point,
        // en alternance (5 s) avec la marge sur la prochaine barrière horaire.
        if (!running) {
            // Avant START : « GPS... » en rouge puis « START : départ » en vert (pas d'anneau d'état).
            var hint = startHint(getRun());
            bottomLine(dc, l, hint[0] as String, hint[1]);
        } else if (offRoute) {
            bottomLine(dc, l, "Hors parcours · " + offBy + " m", red);
        } else if (now < lapMsgUntil) {
            bottomLine(dc, l, lapTitle + " · " + lapMsg, green);
        } else if (bagCp >= 0 && bagLeg < 0 && ravitoShown(now)) {
            bottomLine(dc, l, plan.cpNote[bagCp], fg);
        } else if (cutIdx >= 0 && (now / 5) % 2 == 1) {
            bottomLine(dc, l, (margin >= 0 ? "Marge BH " : "Hors délai ") + signedMinutes(margin), margin < CUTOFF_WARN ? red : fg);
        } else {
            bottomLine(dc, l, nx >= 0 ? plan.cpName[nx] : "Arrivée", fg);
        }
    }

    // Au ravito, jusqu'au départ : à gauche « À consommer » (produits sur ravito) puis « À prendre » (sac,
    // note du point), 5 s chacun ; à droite le tronçon suivant ; barre = temps passé sur l'arrêt prévu.
    function drawRavito(dc as Graphics.Dc, l, fg, red, green) as Void {
        var now = Time.now().value();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var xr = l.PiconX2;
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(xr, l.ParamBarY1, xr, l.ParamBarY2);

        // Gauche : liste en alternance.
        var site = plan.site(bagLeg);
        var bagItems = [] as Array<String>;
        if (bagCp >= 0 && bagCp < plan.cpNote.size() && plan.cpNote[bagCp].length() > 0) {
            bagItems.add(plan.cpNote[bagCp]);
        }
        var entries = plan.bag(bagLeg);
        for (var i = 0; i < entries.size(); i++) {
            bagItems.add(entries[i]);
        }
        var eat = site.size() > 0 && (now / 5) % 2 == 0;
        var title = eat ? "À consommer" : "À prendre";
        var items = eat ? site : bagItems;
        var tf = Graphics.FONT_XTINY;
        var lf = Graphics.FONT_SMALL;
        var y = l.ParamBarY1 + dc.getFontHeight(tf) / 2 + 2;
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(xr - 6, y, tf, title, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
        var lh = dc.getFontHeight(lf);
        y += dc.getFontHeight(tf) / 2 + lh / 2 + 2;
        var rows = packItems(dc, items, lf, 3);
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < rows.size() && i < 3; i++) {
            var maxW = xr - 6 - (w / 2 - halfChord(y, w, h)) - 4;
            var rf = lineFont(dc, rows[i], maxW);
            dc.drawText(xr - 6, y, rf, fit(dc, rows[i], rf, maxW), Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
            y += lh;
        }

        // Droite : tronçon suivant, jusqu'au prochain ravito (ou à l'arrivée).
        var from = plan.legFrom[bagLeg];
        var to = plan.legTo[bagLeg];
        var d0 = (from >= 0 && from < plan.cpDist.size()) ? plan.cpDist[from].toFloat() : 0.0;
        var d1 = (to >= 0 && to < plan.cpDist.size()) ? plan.cpDist[to].toFloat() : plan.total.toFloat();
        legColumn(dc, l, l.axisRightX, d0, d1, to >= 0 ? ICON_WAYPOINT : ICON_FLAG, fg);

        // Barre : temps passé au ravito sur l'arrêt prévu (rouge une fois dépassé).
        var arrived = passes.hasKey(bagCp) ? passes[bagCp] as Number : now;
        var stop = plan.cpStop[bagCp];
        var paused = now - arrived;
        var over = stop > 0 && paused > stop;
        barFrame(dc, l, stop > 0 ? paused.toFloat() / stop : 1.0, over ? red : green, fg);

        // Sous la barre : pause réelle / prévue à gauche ; durée prévue du tronçon suivant (corrigée du
        // rythme du moment) à droite.
        var pf = Graphics.FONT_MEDIUM;
        dc.setColor(over ? red : fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(l.axisLeftX, l.DistY, pf, mmss(paused) + (stop > 0 ? "/" + mmss(stop) : ""), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var dep = (from >= 0 && from < plan.cpPlan.size()) ? plan.cpPlan[from] + plan.cpStop[from] : 0;
        var arr = (to >= 0 && to < plan.cpPlan.size()) ? plan.cpPlan[to] : plan.finishTime();
        var legTime = shortDuration(((arr - dep > 0 ? arr - dep : 0) * paceRatio).toNumber());
        var font = l.fontSecondary;
        var lx = rightX(dc, l, l.DistY, dc.getFontHeight(font), dc.getTextWidthInPixels(legTime, font));
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(lx, l.DistY, font, legTime, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(lx - 5, l.DistY + l.iconSmallOffsetY, getRun().ep.iconFonts()[0], ICON_FOOD, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);

        var toName = (to >= 0 && to < plan.cpName.size()) ? plan.cpName[to] : "Arrivée";
        bottomLine(dc, l, toName.equals("Arrivée") ? "Vers l'arrivée" : "Vers " + toName, fg);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var bg = getBackgroundColor();
        var dark = bg == Graphics.COLOR_BLACK;
        var fg = dark ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        var red = dark ? Graphics.COLOR_RED : Graphics.COLOR_DK_RED;
        var green = dark ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GREEN;
        var ep = getRun().ep;
        var l = ep.lay();
        dc.setColor(fg, bg);
        dc.clear();
        if (plan == null) {
            dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL, status, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else if (running && bagLeg >= 0 && ravitoShown(Time.now().value())) {
            drawRavito(dc, l, fg, red, green);
        } else {
            drawMain(dc, l, fg, red, green);
        }
        // Bandeaux d'EP par-dessus (et popup d'alarme ou de rappel).
        ep.drawBands(dc);
    }
}

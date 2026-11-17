import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Position;
import Toybox.Sensor;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

// États de la sortie.
const READY = 0;    // avant le départ : START pour démarrer
const RUNNING = 1;  // enregistrement en cours : START = pause, BACK = tour (et passage au point)
const PAUSED = 2;   // en pause : START pour reprendre, BACK = menu Reprendre / Enregistrer / Supprimer
const DONE = 3;     // enregistrée ou supprimée : BACK pour quitter

// La sortie :
// - enregistrement (activité Trail, fichier FIT avec les champs d'EndurancePro) ;
// - EndurancePro : calculs chaque seconde, départ, tours et fin transmis comme à un champ de données ;
// - position le long du parcours (GPS calé sur le tracé du plan, comme le champ Trail Planner) ;
// - passages aux points (position, ou bouton Lap = passage au point le plus proche, 2e Lap au ravito =
//   départ) et suivi envoyé à l'assistance (document live/{code}, même format que le champ) ;
// - plan de la course, profil et réglages EndurancePro (champs w, wp et ep du document du code
//   montre), téléchargés via le téléphone au lancement puis toutes les 5 minutes.
class Run {
    const PROJECT = "trail-planner-814f6";

    var ep as EnduranceProView;   // écran et calculs EndurancePro
    var plan = null;          // Plan ou null
    var status = "";          // message affiché sans plan
    var noCourse = false;     // document du code sans course envoyée (réglages EndurancePro seuls)
    var state = READY;
    var saved = false;        // DONE : sortie enregistrée (sinon supprimée)
    var session = null;       // ActivityRecording.Session
    var gpsOk = false;
    var dist = 0.0;           // m le long du parcours
    var matched = -1.0;       // m le long du parcours au dernier calage GPS (-1 : pas encore calé)
    var matchedAt = 0.0;      // distance montre (m) à ce calage
    var offCount = 0;         // relevés GPS consécutifs hors du tracé
    var offRoute = false;     // hors du tracé depuis 5 relevés
    var offBy = 0;            // écart au tracé (m)
    var lapOffset = 0.0;      // sans tracé GPS : correction de distance apportée par les tours (m)
    var lastWalked = 0.0;     // distance montre au dernier calcul (m)
    var elapsed = 0.0;        // temps écoulé de la sortie (s, pauses comprises)
    var startUnix = 0;        // départ réel (s Unix) = maintenant − temps écoulé
    var passes = {};          // indice du point -> instant de passage (s Unix)
    var departs = {};         // ravito -> instant de départ (s Unix)
    var lapped = {};          // points validés par un tour (bouton Lap)
    var laps = 1;             // tour en cours
    var msg = "";             // « Passage · nom », « Départ · nom », « Tour N »...
    var msgShort = "";        // ... forme courte si la place manque (nom du point seul)
    var msgUntil = 0;         // ... affiché jusqu'à cet instant (s Unix)
    var dirty = false;        // passages changés depuis le dernier envoi à l'assistance
    var lastSent = 0;         // dernier envoi du suivi (s Unix)
    var planText = null;      // textes du plan et du profil chargés (seul un plan modifié est relu)
    var profText = null;
    var timer = null;
    var ticks = 0;
    var lastCode = null;      // code montre en vigueur (réglages)
    var fetchCode = null;     // code de la dernière demande de plan

    function initialize() {
        ep = new EnduranceProView();
        lastCode = codeSetting();
        load();
    }

    // Lancement de l'appli : GPS, cardio, calculs chaque seconde, plan.
    function begin() as Void {
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        if (Sensor has :setEnabledSensors) {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE] as Array<Sensor.SensorType>);
        }
        timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        fetch();
    }

    // Sortie de l'appli.
    function end() as Void {
        if (timer != null) {
            timer.stop();
        }
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
    }

    function onPosition(info as Position.Info) as Void {
        var q = info.accuracy;
        gpsOk = q != null && q >= Position.QUALITY_USABLE;
    }

    function onTick() as Void {
        ticks++;
        var info = Activity.getActivityInfo();
        if (info != null) {
            // Comme pour un champ de données : calcul chaque seconde, chrono arrêté ou non.
            ep.compute(info);
            if (state == RUNNING && plan != null) {
                update(info);
            }
        }
        if (ticks % 300 == 0) {
            fetch();
        }
        WatchUi.requestUpdate();
    }

    // --- Enregistrement --------------------------------------------------------------------------------

    function start() as Void {
        if (session == null) {
            session = ActivityRecording.createSession({
                :name => "Trail Planner",
                :sport => Activity.SPORT_RUNNING,
                :subSport => Activity.SUB_SPORT_TRAIL
            });
            // Champs FIT d'EndurancePro : à créer avant le départ de la session.
            ep.createFitFields(session);
            passes = {};
            departs = {};
            lapped = {};
            matched = -1.0;
            matchedAt = 0.0;
            offCount = 0;
            offRoute = false;
            lapOffset = 0.0;
            dist = 0.0;
            laps = 1;
            lastSent = 0;
        }
        session.start();
        ep.onTimerStart();
        state = RUNNING;
        signal(Attention.TONE_START);
    }

    function pause() as Void {
        session.stop();
        state = PAUSED;
        signal(Attention.TONE_STOP);
        sendNow();
    }

    function resume() as Void {
        session.start();
        state = RUNNING;
        signal(Attention.TONE_START);
    }

    function save() as Void {
        sendNow();
        session.save();
        ep.onTimerReset();
        session = null;
        saved = true;
        state = DONE;
    }

    function discard() as Void {
        session.discard();
        ep.onTimerReset();
        session = null;
        saved = false;
        state = DONE;
    }

    // BACK (Lap) pendant l'enregistrement : nouveau tour dans le fichier FIT et nouveau circuit
    // d'EndurancePro (les valeurs du tour qui se termine sont déjà dans ses champs FIT), et passage au
    // point le plus proche (réglage « Tour = passage au point »).
    function lap() as Void {
        session.addLap();
        ep.onTimerLap();
        laps++;
        signal(Attention.TONE_LAP);
        var now = Time.now().value();
        if (!lapPassage(now)) {
            show(tpText(Rez.Strings.tp_lap) + " " + laps, "", now);
        }
    }

    function signal(tone as Attention.Tone) as Void {
        if (Attention has :playTone) {
            Attention.playTone(tone);
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(60, 250)] as Array<Attention.VibeProfile>);
        }
    }

    function show(text as String, brief as String, now as Number) as Void {
        msg = text;
        msgShort = brief;
        msgUntil = now + 5;
    }

    // --- Position et passages (comme le champ de données) -------------------------------------------

    function update(info as Activity.Info) as Void {
        elapsed = info.elapsedTime != null ? info.elapsedTime / 1000.0 : 0.0;
        var now = Time.now().value();
        startUnix = now - elapsed.toNumber();
        lastWalked = info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        var d = courseDistance(info);
        dist = d;
        var n = plan.cpDist.size();
        var changed = false;
        // Passage (tour Lap ou position) contredit par le GPS calé sur le tracé (coureur à plus de 200 m
        // avant le point) : annulé, le point sera de nouveau détecté en y arrivant.
        if (plan.hasRoute() && matched >= 0) {
            var keys = passes.keys();
            for (var k = 0; k < keys.size(); k++) {
                var li = keys[k] as Number;
                if (li < n && d < plan.cpDist[li] - 200) {
                    passes.remove(li);
                    lapped.remove(li);
                    departs.remove(li);
                    changed = true;
                }
            }
        }
        // Points atteints d'après la position.
        for (var i = 0; i < n; i++) {
            if (!passes.hasKey(i) && d >= plan.cpDist[i] - 30) {
                passes.put(i, now);
                changed = true;
            }
        }
        // Départ d'un ravito noté tout seul 150 m après le point, 300 m après une base de vie (sans
        // attendre un 2e tour Lap) : temps passé au ravito envoyé à l'assistance.
        for (var i = 0; i < n; i++) {
            var away = plan.cpBase[i] ? 300 : 150;
            if (plan.cpKind[i].equals("r") && passes.hasKey(i) && !departs.hasKey(i) && d > plan.cpDist[i] + away) {
                departs.put(i, now);
                changed = true;
            }
        }
        if (changed) {
            dirty = true;
        }
        // Suivi pour l'assistance : peu après un passage (30 s au moins entre deux envois), sinon
        // toutes les 5 minutes.
        if ((dirty && now - lastSent >= 30) || now - lastSent >= 300) {
            sendProgress(info, now);
        }
    }

    // Distance le long du parcours (m) : position GPS calée sur le tracé du plan près de la position
    // attendue (dernier calage + distance montre depuis) ; hors du tracé, elle reste figée (« Hors
    // parcours ») ; sans position GPS, elle avance avec la distance montre. Plan sans tracé : distance
    // parcourue, corrigée par les tours.
    function courseDistance(info as Activity.Info) as Float {
        var walked = lastWalked;
        if (!plan.hasRoute()) {
            return walked + lapOffset;
        }
        var since = walked - matchedAt;
        var expected = matched >= 0 ? matched + since : walked;
        var loc = info.currentLocation;
        var q = info.currentLocationAccuracy;
        if (loc == null || (q != null && q < Position.QUALITY_USABLE)) {
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

    // Bouton Lap = passage, comme le champ : 2e tour au ravito (arrivée validée par un tour, pas encore
    // reparti, moins de 300 m après et 2 h au plus) = départ du ravito ; sinon passage au point le plus
    // proche pas encore validé par un tour, à 150 m au plus devant ou 300 m derrière avec le GPS calé
    // (500 m sans tracé calé), position recalée sur le point. Un tour loin de tout point reste un tour.
    // Renvoie true si le tour a servi.
    function lapPassage(now as Number) as Boolean {
        if (plan == null || Application.Properties.getValue("lapPass") == false) {
            return false;
        }
        var n = plan.cpDist.size();
        for (var i = n - 1; i >= 0; i--) {
            if (plan.cpKind[i].equals("r") && lapped.hasKey(i) && !departs.hasKey(i) &&
                dist < plan.cpDist[i] + 300 && now - (passes[i] as Number) < 7200) {
                departs.put(i, now);
                dirty = true;
                show(tpText(Rez.Strings.tp_depart) + " · " + plan.cpName[i], plan.cpName[i], now);
                return true;
            }
        }
        var gps = plan.hasRoute() && matched >= 0;
        var win = gps ? 300.0 : 500.0;
        var ahead = gps ? 150.0 : 500.0;
        var best = -1;
        var bestGap = 0.0;
        for (var i = 0; i < n; i++) {
            if (lapped.hasKey(i)) {
                continue;
            }
            var gap = plan.cpDist[i] - dist;
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
            return false;
        }
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
        dirty = true;
        show(tpText(Rez.Strings.tp_passage) + " · " + plan.cpName[best], plan.cpName[best], now);
        return true;
    }

    // --- Suivi pour l'assistance ---------------------------------------------------------------------

    // Envoi immédiat (pause, fin de la sortie).
    function sendNow() as Void {
        var info = Activity.getActivityInfo();
        if (info != null && plan != null) {
            sendProgress(info, Time.now().value());
        }
    }

    // Document live/{code}, comme le champ (mêmes champs, acceptés par les règles Firestore) : instant,
    // départ réel, distance le long du parcours, passages « indice:arrivée[:départ] », position, batterie.
    function sendProgress(info as Activity.Info, now as Number) as Void {
        var code = codeSetting();
        if (code == null) {
            return;
        }
        lastSent = now;
        dirty = false;
        var p = "";
        var keys = passes.keys();
        for (var k = 0; k < keys.size(); k++) {
            p += (k > 0 ? "," : "") + keys[k] + ":" + passes[keys[k]];
            if (departs.hasKey(keys[k])) {
                p += ":" + departs[keys[k]];
            }
        }
        var fields = {
            "t" => { "integerValue" => now.toString() },
            "s" => { "integerValue" => startUnix.toString() },
            "d" => { "integerValue" => dist.toNumber().toString() },
            "p" => { "stringValue" => p },
            "v" => { "integerValue" => "1" }
        };
        var loc = info.currentLocation;
        if (loc != null) {
            var deg = loc.toDegrees();
            fields.put("lat", { "doubleValue" => deg[0].toFloat() });
            fields.put("lon", { "doubleValue" => deg[1].toFloat() });
        }
        var stats = System.getSystemStats();
        if (stats != null && stats.battery != null) {
            fields.put("bat", { "integerValue" => stats.battery.toNumber().toString() });
        }
        var name = "projects/" + PROJECT + "/databases/(default)/documents/live/" + code;
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents:commit",
            { "writes" => [{ "update" => { "name" => name, "fields" => fields } }] },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onSent)
        );
    }

    // Échec (téléphone hors de portée…) : le relevé suivant repartira dans 5 minutes au plus.
    function onSent(responseCode as Number, data as Dictionary or String or Null) as Void {
    }

    // --- Plan de la course ---------------------------------------------------------------------------

    // Document du code montre (le même que pour le champ et EndurancePro) : plan `w`, profil `wp` et
    // réglages EndurancePro `ep`, via le téléphone.
    function fetch() as Void {
        var code = codeSetting();
        if (code == null) {
            refreshStatus();
            return;
        }
        fetchCode = code;
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents/shares/" +
                code + "?mask.fieldPaths=w&mask.fieldPaths=wp&mask.fieldPaths=ep",
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onPlan)
        );
    }

    function onPlan(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (responseCode == 200 && data instanceof Dictionary) {
            var fields = data["fields"];
            var w = null;
            var wp = null;
            var epText = null;
            if (fields instanceof Dictionary) {
                w = textOf(fields["w"]);
                wp = textOf(fields["wp"]);
                epText = textOf(fields["ep"]);
            }
            // Document sans course (`w` vide : réglages EndurancePro seuls) : on garde le dernier plan.
            noCourse = true;
            if (w != null && w.length() > 4) {
                noCourse = false;
                Application.Storage.setValue("plan", w);
                Application.Storage.setValue("profile", wp);
                Application.Storage.setValue("planCode", fetchCode);
            }
            Application.Storage.setValue("fetchError", null);
            // Réglages EndurancePro (VC, zones, équivalences, zone de la séance), comme la synchro du champ.
            if (epText != null && applyTrailSync(epText)) {
                getApp().refreshViewSettings();
            }
        } else {
            Application.Storage.setValue("fetchError", responseCode);
            applyTrailSync(responseCode);
        }
        load();
        WatchUi.requestUpdate();
    }

    function textOf(field) as String or Null {
        if (field instanceof Dictionary && field["stringValue"] instanceof String) {
            return field["stringValue"] as String;
        }
        return null;
    }

    // Relit le plan enregistré s'il a changé ; il faut alors recaler la position sur tout le parcours.
    // En course, les passages déjà notés sont gardés (rapportés aux points du nouveau plan). Un plan
    // téléchargé avec un autre code (code changé depuis) est ignoré.
    function load() as Void {
        var text = Application.Storage.getValue("plan");
        var prof = Application.Storage.getValue("profile");
        if (!(prof instanceof String)) {
            prof = null;
        }
        if (!sameText(Application.Storage.getValue("planCode"), lastCode)) {
            text = null;
        }
        if (!(text instanceof String)) {
            plan = null;
            planText = null;
            profText = null;
        } else if (planText == null || !text.equals(planText) || !sameText(prof, profText)) {
            var old = plan;
            plan = parsePlan(text as String, prof as String or Null);
            planText = plan != null ? text : null;
            profText = plan != null ? prof : null;
            matched = -1.0;
            offCount = 0;
            offRoute = false;
            if (state != READY && old != null && plan != null) {
                passes = remap(passes, old, plan);
                departs = remap(departs, old, plan);
                lapped = remap(lapped, old, plan);
            }
        }
        refreshStatus();
    }

    // Points notés (passages, départs) d'un plan à l'autre : même point à moins de 100 m près.
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

    function sameText(a, b) as Boolean {
        if (!(a instanceof String) || !(b instanceof String)) {
            return a == null && b == null;
        }
        return (a as String).equals(b as String);
    }

    // Code montre des réglages (celui d'EndurancePro, trail_code_prop), ou null s'il manque.
    function codeSetting() as String or Null {
        var code = Application.Properties.getValue("trail_code_prop");
        if (code instanceof String && code.length() >= 8) {
            return code as String;
        }
        return null;
    }

    function refreshStatus() as Void {
        var err = Application.Storage.getValue("fetchError");
        if (lastCode == null) {
            status = tpText(Rez.Strings.tp_no_code);
        } else if (plan != null) {
            status = "";
        } else if (err == 404) {
            status = tpText(Rez.Strings.tp_unknown_code);
        } else if (err == Communications.BLE_CONNECTION_UNAVAILABLE) {
            status = tpText(Rez.Strings.tp_no_phone);
        } else if (err == Communications.NETWORK_RESPONSE_TOO_LARGE) {
            status = tpText(Rez.Strings.tp_too_big);
        } else if (err != null) {
            status = tpText(Rez.Strings.tp_plan_error) + " " + err;
        } else if (noCourse) {
            status = tpText(Rez.Strings.tp_no_course);
        } else {
            status = tpText(Rez.Strings.tp_waiting);
        }
    }

    // Réglages changés (Garmin Connect, ou code saisi sur la montre) : avec un autre code, l'ancien plan
    // est oublié et le nouveau téléchargé (avec les réglages EndurancePro).
    function settingsChanged() as Void {
        var code = codeSetting();
        if (sameText(code, lastCode)) {
            return;
        }
        lastCode = code;
        Application.Storage.setValue("fetchError", null);
        noCourse = false;
        load();
        fetch();
    }

    // Écart au plan à l'endroit où l'on est (s, positif : retard), ou null (pas de plan, avant 200 m).
    function planGap() as Float or Null {
        if (plan == null || state == READY || dist <= 200) {
            return null;
        }
        return elapsed - plan.plannedAt(dist);
    }
}

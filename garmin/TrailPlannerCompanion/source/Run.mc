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
// - EndurancePro (ep) et Trail Planner (tp, le champ de données repris à l'identique) : calculs chaque
//   seconde, départ, tours et fin transmis comme à des champs de données. Trail Planner est le moteur du
//   suivi : position calée sur le tracé, passages (position ou Lap), estimations, rappels ; le profil, la
//   carte et l'envoi à l'assistance (document live/{code}) lisent ses données ;
// - plan de la course, profil et réglages EndurancePro (champs w, wp et ep du document du code
//   montre), téléchargés via le téléphone au lancement puis toutes les 5 minutes ; tracé fin de l'écran
//   Carte (champ wr) dans une requête à part, quand le plan change.
class Run {
    const PROJECT = "trail-planner-814f6";

    var ep as EnduranceProView;   // écran et calculs EndurancePro
    var tp as TrailPlannerScreen; // écran et calculs Trail Planner (suivi de la course)
    var plan = null;          // Plan ou null
    var status = "";          // message affiché sans plan
    var noCourse = false;     // document du code sans course envoyée (réglages EndurancePro seuls)
    var state = READY;
    var saved = false;        // DONE : sortie enregistrée (sinon supprimée)
    var session = null;       // ActivityRecording.Session
    var gpsOk = false;
    // Repris de Trail Planner chaque seconde, pour le profil et la carte.
    var dist = 0.0;           // m le long du parcours
    var offRoute = false;     // hors du tracé
    var offBy = 0;            // écart au tracé (m)
    var laps = 1;             // tour en cours
    var msg = "";             // « Passage · nom », « Départ · nom », « Tour N »...
    var msgShort = "";        // ... forme courte si la place manque (nom du point seul)
    var msgUntil = 0;         // ... affiché jusqu'à cet instant (s Unix)
    var lastSent = 0;         // dernier envoi du suivi (s Unix)
    var planText = null;      // textes du plan et du profil chargés (seul un plan modifié est relu)
    var profText = null;
    var timer = null;
    var ticks = 0;
    var lastCode = null;      // code montre en vigueur (réglages)
    var fetchCode = null;     // code de la dernière demande de plan
    var lastLoc = null;       // dernière position GPS (Position.Location), pour la carte
    var heading = 0.0;        // cap GPS (radians, 0 = nord), flèche de la carte
    var route = null;         // tracé de la carte (MapRoute) : champ wr, sinon ligne G du plan
    var routeText = null;     // texte du champ wr chargé (null : tracé tiré du plan)
    var routePlan = null;     // plan dont le tracé de repli est tiré

    function initialize() {
        ep = new EnduranceProView();
        tp = new TrailPlannerScreen();
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
        if (info.position != null && q != null && q >= Position.QUALITY_POOR) {
            lastLoc = info.position;
        }
        if (info.heading != null) {
            heading = info.heading.toFloat();
        }
    }

    function onTick() as Void {
        ticks++;
        var now = Time.now().value();
        var info = Activity.getActivityInfo();
        if (info != null) {
            // Comme pour des champs de données : calcul chaque seconde, chrono arrêté ou non.
            ep.compute(info);
            ep.tickPopup();
            tp.compute(info);
            dist = tp.dist;
            offRoute = tp.offRoute;
            offBy = tp.offBy;
            // Suivi pour l'assistance : peu après un passage (30 s au moins entre deux envois), sinon
            // toutes les 5 minutes.
            if (state == RUNNING && tp.progress != null &&
                ((tp.progressDirty && now - lastSent >= 30) || now - lastSent >= 300)) {
                sendProgress(now);
            }
        }
        if (ticks % 300 == 0) {
            fetch();
        }
        var app = getApp();
        // « Explorer la carte » choisi dans le menu, maintenant fermé.
        if (app.pendingExplore) {
            app.startExplore();
        }
        // Rappel nutrition, ravito, barrière horaire : écran Trail Planner, puis retour.
        if (state == RUNNING) {
            app.checkFocus(tp.focusKey(now));
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
    // d'EndurancePro (les valeurs du tour qui se termine sont déjà dans ses champs FIT), et, comme le
    // champ Trail Planner, passage au point le plus proche (2e tour au ravito = départ), réglage « Tour =
    // passage au point ». Un tour loin de tout point reste un tour (« Tour N »).
    function lap() as Void {
        session.addLap();
        ep.onTimerLap();
        laps++;
        signal(Attention.TONE_LAP);
        var now = Time.now().value();
        var before = tp.lapMsgUntil;
        tp.onTimerLap();
        if (tp.lapMsgUntil != before) {
            show(tp.lapTitle + " · " + tp.lapMsg, tp.lapMsg, now);
        } else {
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

    // --- Suivi pour l'assistance ---------------------------------------------------------------------

    // Envoi immédiat (pause, fin de la sortie).
    function sendNow() as Void {
        if (tp.progress != null) {
            sendProgress(Time.now().value());
        }
    }

    // Document live/{code}, comme le champ (mêmes champs, acceptés par les règles Firestore) : dernier
    // relevé de Trail Planner (instant, départ réel, distance le long du parcours, passages
    // « indice:arrivée[:départ] », position, batterie).
    function sendProgress(now as Number) as Void {
        var code = codeSetting();
        var rec = tp.progress;
        if (code == null || !(rec instanceof Dictionary)) {
            return;
        }
        lastSent = now;
        tp.progressDirty = false;
        var fields = {
            "t" => { "integerValue" => rec["t"].toString() },
            "s" => { "integerValue" => rec["s"].toString() },
            "d" => { "integerValue" => rec["d"].toString() },
            "p" => { "stringValue" => rec["p"] },
            "v" => { "integerValue" => "1" }
        };
        if (rec["lat"] != null && rec["lon"] != null) {
            fields.put("lat", { "doubleValue" => rec["lat"] });
            fields.put("lon", { "doubleValue" => rec["lon"] });
        }
        if (rec["bat"] != null) {
            fields.put("bat", { "integerValue" => rec["bat"].toString() });
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
        var needRoute = false;
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
                // Nouveau plan (ou nouveau code) : tracé de la carte à retélécharger.
                if (!sameText(Application.Storage.getValue("plan"), w) || !sameText(Application.Storage.getValue("planCode"), fetchCode)) {
                    Application.Storage.setValue("route", null);
                }
                Application.Storage.setValue("plan", w);
                Application.Storage.setValue("profile", wp);
                Application.Storage.setValue("planCode", fetchCode);
                needRoute = Application.Storage.getValue("route") == null;
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
        if (needRoute) {
            fetchRoute();
        }
        WatchUi.requestUpdate();
    }

    // Tracé fin de l'écran Carte (champ wr, jusqu'à 10 000 caractères) : requête à part, la réponse du
    // plan restant de taille raisonnable pour la montre.
    function fetchRoute() as Void {
        var code = codeSetting();
        if (code == null) {
            return;
        }
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents/shares/" +
                code + "?mask.fieldPaths=wr",
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onRoute)
        );
    }

    // Sans champ wr (site d'une ancienne version) : "" (téléchargé, rien), le tracé est tiré du plan.
    // En cas d'échec : nouvel essai avec le plan suivant (5 min).
    function onRoute(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (responseCode == 200 && data instanceof Dictionary) {
            var fields = data["fields"];
            var wr = fields instanceof Dictionary ? textOf(fields["wr"]) : null;
            Application.Storage.setValue("route", wr != null ? wr : "");
            loadRoute();
            WatchUi.requestUpdate();
        }
    }

    // Tracé de la carte : champ wr s'il est là, sinon ligne G du plan (relu seulement s'il a changé).
    function loadRoute() as Void {
        if (plan == null) {
            route = null;
            routeText = null;
            routePlan = null;
            return;
        }
        var text = Application.Storage.getValue("route");
        if (text instanceof String && (text as String).length() > 4) {
            if (routeText != null && (text as String).equals(routeText)) {
                return;
            }
            var r = parseMapRoute(text as String);
            if (r != null) {
                route = r;
                routeText = text;
                routePlan = plan;
                return;
            }
        }
        if (routeText != null || routePlan != plan) {
            route = mapRouteFromPlan(plan);
            routeText = null;
            routePlan = plan;
        }
    }

    function textOf(field) as String or Null {
        if (field instanceof Dictionary && field["stringValue"] instanceof String) {
            return field["stringValue"] as String;
        }
        return null;
    }

    // Relit le plan enregistré s'il a changé et le donne à Trail Planner (qui recale la position et, en
    // course, garde les passages déjà notés). Un plan téléchargé avec un autre code (code changé depuis)
    // est ignoré.
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
            plan = parsePlan(text as String, prof as String or Null);
            planText = plan != null ? text : null;
            profText = plan != null ? prof : null;
        }
        tp.setPlan(plan);
        loadRoute();
        refreshStatus();
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
        tp.status = status;
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

    // Écart au plan à l'endroit où l'on est (s, positif : retard), comme l'écran Trail Planner, ou null
    // (avant le départ, sans plan, avant 200 m).
    function planGap() as Float or Null {
        if (plan == null || state == READY || !tp.running || tp.dist <= 200) {
            return null;
        }
        return tp.delta.toFloat();
    }
}

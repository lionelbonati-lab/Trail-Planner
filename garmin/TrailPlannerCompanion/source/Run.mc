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
const LAP_UNDO_S = 8; // s pour annuler un tour (Bas), décompte en anneau

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
    const LOAD_STEP = 600;    // nombres lus par seconde dans le profil fin ou le tracé fin (chien de garde)

    var ep as EnduranceProView;   // écran et calculs EndurancePro
    var tp as TrailPlannerScreen; // écran et calculs Trail Planner (suivi de la course)
    var plan = null;          // Plan ou null
    var status = "";          // message affiché sans plan
    var noCourse = false;     // document du code sans course envoyée (réglages EndurancePro seuls)
    var state = READY;
    var saved = false;        // DONE : sortie enregistrée (sinon supprimée)
    var session = null;       // ActivityRecording.Session
    var gpsOk = false;        // GPS prêt : position (qualité « faible » au moins) par les événements GPS ou l'activité...
    var posOk = false;        // ... événements GPS (onPosition)
    var infoOk = false;       // ... position de l'activité (Activity.Info : trajet GPX rejoué au simulateur)
    // Repris de Trail Planner chaque seconde, pour le profil et la carte.
    var dist = 0.0;           // m le long du parcours
    var offRoute = false;     // hors du tracé
    var offBy = 0;            // écart au tracé (m)
    var laps = 1;             // tour en cours
    var msg = "";             // nom du point passé, « Départ · nom », « Tour N »...
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
    var routeFor = null;      // parcours de la dernière demande de tracé
    var lastLapMs = 0;        // dernier tour (System.getTimer), pour ne pas le compter deux fois (restoreCourse)
    // Tour en attente d'annulation (8 s, lap / undoLap / commitLap).
    var lapPending = 0;       // instant de l'appui (s Unix), 0 : aucun...
    var lapPendingMs = 0;     // ... (System.getTimer, anneau du décompte)
    var lapPressTimer = 0;    // ... chrono (ms), distance montre (m) et distance sur le parcours (m) à l'appui
    var lapPressWalked = 0.0;
    var lapPressDist = 0.0;
    var lapStartTimer = 0;    // début du tour en cours : chrono (ms) et distance montre (m)
    var lapStartWalked = 0.0;
    var lapShownTime = 0;     // tour affiché pendant le décompte (sorties libres) : temps (ms), distance (m)
    var lapShownDist = 0.0;
    var lapPreview = null;    // avec un parcours : point que le tour va valider (nom, « Départ · nom ») ou null
    var lapFrame = null;      // décompte : écran redessiné 10 fois par seconde (Timer.Timer ou null)
    // Lectures en cours, une tranche par seconde (stepLoads) : profil fin du plan et tracé fin de la carte.
    var profLoad = null;      // [ProfileReader, GroupReader] ou null...
    var profLoadPlan = null;  // ... pour ce plan
    var routeLoad = null;     // [MapRoute, GroupReader] ou null...
    var routeLoadText = null; // ... pour ce champ wr...
    var routeLoadCourse = null; // ... de ce parcours
    var courseId = null;      // parcours choisi à l'écran de démarrage (id, "" course envoyée, null libre)

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
        stopLapFrame();
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
    }

    function onPosition(info as Position.Info) as Void {
        var q = info.accuracy;
        // Qualité « faible » acceptée (simulateur, premières secondes sur la montre) : position GPS quand même.
        posOk = q != null && q >= Position.QUALITY_POOR;
        gpsOk = posOk || infoOk;
        if (info.position != null && q != null && q >= Position.QUALITY_POOR) {
            lastLoc = info.position;
        }
        if (info.heading != null) {
            heading = info.heading.toFloat();
        }
    }

    function onTick() as Void {
        ticks++;
        stepLoads();
        var now = Time.now().value();
        // Tour en attente : enregistré à la fin du décompte d'annulation.
        if (lapPending > 0 && now - lapPending >= LAP_UNDO_S) {
            commitLap();
        }
        var info = Activity.getActivityInfo();
        if (info != null) {
            // GPS aussi d'après la position de l'activité (au simulateur, un trajet GPX rejoué n'arrive que
            // par là) ; elle sert alors aussi à la carte (position, cap).
            var q = info.currentLocationAccuracy;
            infoOk = q != null && q >= Position.QUALITY_POOR && info.currentLocation != null;
            gpsOk = posOk || infoOk;
            if (infoOk && !posOk) {
                lastLoc = info.currentLocation;
                if (info.currentHeading != null) {
                    heading = info.currentHeading.toFloat();
                }
            }
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
            lapPending = 0;
            lapStartTimer = 0;
            lapStartWalked = 0.0;
        }
        session.start();
        ep.onTimerStart();
        state = RUNNING;
        signal(Attention.TONE_START);
    }

    // Sortie en cours (chrono lancé ou en pause) : les écrans de course ne doivent pas être quittés.
    function active() as Boolean {
        return state == RUNNING || state == PAUSED;
    }

    function pause() as Void {
        // Tour en attente : enregistré avant la pause.
        commitLap();
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
        lapPending = 0;
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
    // BACK (Lap) pendant la sortie : tour en attente 8 s (anneau de décompte, Bas pour l'annuler), enregistré
    // ensuite (commitLap) : un tour écrit dans l'activité ne peut plus être effacé. Un nouvel appui pendant
    // le décompte valide le tour en attente et en lance un autre. Le temps, la distance et l'allure du tour
    // (écran du tour des sorties libres) sont pris à l'appui.
    function lap() as Void {
        lastLapMs = System.getTimer();
        if (lapPending > 0) {
            commitLap();
        }
        var info = Activity.getActivityInfo();
        var timer = info != null && info.timerTime != null ? info.timerTime as Number : 0;
        var walked = info != null && info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        lapPending = Time.now().value();
        lapPendingMs = System.getTimer();
        lapPressTimer = timer;
        lapPressWalked = walked;
        lapPressDist = tp.dist;
        lapShownTime = timer - lapStartTimer;
        lapShownDist = walked - lapStartWalked;
        // Avec un parcours : point que le tour va valider, affiché dès l'appui (pendant le décompte).
        lapPreview = tp.lapPreview(lapPending, lapPressDist);
        if (lapPreview != null) {
            var text = lapPreview as String;
            var cut = text.find(" · ");
            msg = text;
            msgShort = cut != null ? text.substring(cut + 3, text.length()) : "";
            msgUntil = lapPending + LAP_UNDO_S;
        }
        // Anneau du décompte et nom qui défile : écran redessiné 10 fois par seconde pendant le décompte.
        if (lapFrame == null) {
            lapFrame = new Timer.Timer();
            (lapFrame as Timer.Timer).start(method(:onLapFrame), 100, true);
        }
        signal(Attention.TONE_LAP);
        WatchUi.requestUpdate();
    }

    // Décompte d'un tour : anneau et nom qui défile ; arrêt une fois le tour enregistré ou annulé.
    function onLapFrame() as Void {
        if (lapPending == 0) {
            stopLapFrame();
        }
        WatchUi.requestUpdate();
    }

    function stopLapFrame() as Void {
        if (lapFrame != null) {
            (lapFrame as Timer.Timer).stop();
            lapFrame = null;
        }
    }

    // Bas pendant le décompte : tour annulé (rien n'est enregistré). false : pas de tour en attente.
    function undoLap() as Boolean {
        if (lapPending == 0) {
            return false;
        }
        lapPending = 0;
        lapPreview = null;
        signal(Attention.TONE_RESET);
        show(tpText(Rez.Strings.tp_lap_undone), "", Time.now().value());
        WatchUi.requestUpdate();
        return true;
    }

    // Tour en attente enregistré (fin du décompte, nouvel appui, pause, fin de la sortie) : tour de
    // l'activité, tours d'EndurancePro, passage au point Trail Planner à l'heure et à la position de l'appui.
    function commitLap() as Void {
        var at = lapPending;
        if (at == 0 || session == null) {
            lapPending = 0;
            return;
        }
        lapPending = 0;
        lapPreview = null;
        session.addLap();
        ep.onTimerLap();
        laps++;
        lapStartTimer = lapPressTimer;
        lapStartWalked = lapPressWalked;
        var now = Time.now().value();
        var before = tp.lapMsgUntil;
        tp.onTimerLap(at, lapPressDist);
        if (tp.lapMsgUntil != before) {
            show(tp.lapText(), tp.lapMsg, now);
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
    // « indice:arrivée[:départ] », position, batterie). « v » : 1 pour la course envoyée à la montre
    // (comme le champ), sinon l'id du parcours choisi dans la liste, pour que le site range le suivi
    // (lien d'assistance, debrief) dans la bonne course. Rien en sortie libre.
    function sendProgress(now as Number) as Void {
        var code = codeSetting();
        var rec = tp.progress;
        if (code == null || courseId == null || !(rec instanceof Dictionary)) {
            return;
        }
        lastSent = now;
        tp.progressDirty = false;
        var fields = {
            "t" => { "integerValue" => rec["t"].toString() },
            "s" => { "integerValue" => rec["s"].toString() },
            "d" => { "integerValue" => rec["d"].toString() },
            "p" => { "stringValue" => rec["p"] },
            "v" => courseId.equals("") ? { "integerValue" => "1" } : { "stringValue" => courseId }
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
    // Document du code montre (le même que pour le champ et EndurancePro) : plan de la course envoyée à
    // la montre `w` (et son profil `wp`), réglages EndurancePro `ep`, liste des parcours de l'appli `wl`.
    // Parcours choisi à l'écran de démarrage (courseId) :
    // - un parcours de la liste : son document `<code>-<id>` (plan w, profil wp, tracé wr) ;
    // - "" : la course envoyée à la montre (document du code, quand la liste est vide) ;
    // - null : sortie libre, sans plan (ou rien encore choisi).
    // Plans gardés dans le stockage de la montre : « plan0 » / « profile0 » (course envoyée), « plan » /
    // « profile » (parcours de la liste, planCourse), « route » (tracé du parcours choisi, routeCourse).

    function fetch() as Void {
        var code = codeSetting();
        if (code == null) {
            refreshStatus();
            return;
        }
        fetchCode = code;
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents/shares/" +
                code + "?mask.fieldPaths=w&mask.fieldPaths=wp&mask.fieldPaths=ep&mask.fieldPaths=wl",
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onPlan)
        );
        if (courseId != null && !courseId.equals("")) {
            fetchCourse();
        }
    }

    function onPlan(responseCode as Number, data as Dictionary or String or Null) as Void {
        var needRoute = false;
        if (responseCode == 200 && data instanceof Dictionary) {
            var fields = data["fields"];
            var w = null;
            var wp = null;
            var epText = null;
            var wl = null;
            if (fields instanceof Dictionary) {
                w = textOf(fields["w"]);
                wp = textOf(fields["wp"]);
                epText = textOf(fields["ep"]);
                wl = textOf(fields["wl"]);
            }
            // Course envoyée à la montre (`w` vide : réglages EndurancePro seuls, on garde la dernière).
            noCourse = true;
            if (w != null && w.length() > 4) {
                noCourse = false;
                if (!sameText(Application.Storage.getValue("plan0"), w) && courseId != null && courseId.equals("")) {
                    Application.Storage.setValue("route", null);
                }
                Application.Storage.setValue("plan0", w);
                Application.Storage.setValue("profile0", wp);
                Application.Storage.setValue("planCode", fetchCode);
                needRoute = courseId != null && courseId.equals("") && Application.Storage.getValue("route") == null;
            }
            // Liste des parcours de l'écran de démarrage.
            Application.Storage.setValue("list", wl);
            Application.Storage.setValue("listCode", fetchCode);
            // Liste ou course envoyée changée (nouveau code compris) : écran de démarrage refait s'il est
            // affiché, sinon à son retour.
            getApp().refreshStart();
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

    // Plan du parcours choisi dans la liste (document `<code>-<id>`).
    function fetchCourse() as Void {
        var code = codeSetting();
        if (code == null || courseId == null || courseId.equals("")) {
            return;
        }
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents/shares/" +
                code + "-" + courseId + "?mask.fieldPaths=w&mask.fieldPaths=wp",
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onCourse)
        );
    }

    function onCourse(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (responseCode != 200 || !(data instanceof Dictionary) || courseId == null) {
            return;
        }
        var fields = data["fields"];
        var w = fields instanceof Dictionary ? textOf(fields["w"]) : null;
        if (w == null || w.length() <= 4) {
            return;
        }
        var same = sameText(Application.Storage.getValue("planCourse"), courseId) && sameText(Application.Storage.getValue("plan"), w);
        if (!same) {
            Application.Storage.setValue("route", null);
        }
        Application.Storage.setValue("plan", w);
        Application.Storage.setValue("profile", textOf(fields["wp"]));
        Application.Storage.setValue("planCourse", courseId);
        Application.Storage.setValue("planCode", fetchCode != null ? fetchCode : codeSetting());
        load();
        if (Application.Storage.getValue("route") == null) {
            fetchRoute();
        }
        WatchUi.requestUpdate();
    }

    // Tracé fin de l'écran Carte (champ wr, jusqu'à 10 000 caractères) du parcours choisi : requête à part,
    // pour que chaque réponse reste de taille raisonnable pour la montre.
    function fetchRoute() as Void {
        var code = codeSetting();
        if (code == null || courseId == null) {
            return;
        }
        var doc = courseId.equals("") ? code : code + "-" + courseId;
        routeFor = courseId;
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents/shares/" +
                doc + "?mask.fieldPaths=wr",
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
        if (responseCode == 200 && data instanceof Dictionary && sameText(routeFor, courseId)) {
            var fields = data["fields"];
            var wr = fields instanceof Dictionary ? textOf(fields["wr"]) : null;
            Application.Storage.setValue("route", wr != null ? wr : "");
            Application.Storage.setValue("routeCourse", courseId);
            loadRoute();
            WatchUi.requestUpdate();
        }
    }

    // Une tranche du profil fin, sinon du tracé fin, à chaque seconde ; une fois lu, il remplace la
    // version tirée du plan (s'il concerne toujours le plan et le parcours affichés).
    function stepLoads() as Void {
        if (profLoad != null) {
            if (((profLoad as Array)[1] as GroupReader).step(LOAD_STEP)) {
                if (plan != null && profLoadPlan == plan) {
                    ((profLoad as Array)[0] as ProfileReader).finish(plan as Plan);
                    WatchUi.requestUpdate();
                }
                profLoad = null;
                profLoadPlan = null;
            }
            return;
        }
        if (routeLoad != null) {
            if (((routeLoad as Array)[1] as GroupReader).step(LOAD_STEP)) {
                var r = (routeLoad as Array)[0] as MapRoute;
                if (plan != null && r.size() >= 2 && sameText(routeLoadCourse, courseId)) {
                    route = r;
                    routeText = routeLoadText;
                    routePlan = plan;
                    WatchUi.requestUpdate();
                }
                routeLoad = null;
                routeLoadText = null;
                routeLoadCourse = null;
            }
        }
    }

    // Tracé de la carte : champ wr du parcours choisi s'il est là (lu en quelques secondes, stepLoads),
    // sinon, et en attendant, ligne G du plan (relu seulement s'il a changé).
    function loadRoute() as Void {
        if (plan == null) {
            route = null;
            routeText = null;
            routePlan = null;
            routeLoad = null;
            routeLoadText = null;
            routeLoadCourse = null;
            return;
        }
        var text = Application.Storage.getValue("route");
        if (!sameText(Application.Storage.getValue("routeCourse"), courseId)) {
            text = null;
        }
        if (text instanceof String && (text as String).length() > 4) {
            if (routeText != null && (text as String).equals(routeText)) {
                return;
            }
            if (routeLoad == null || !sameText(text, routeLoadText) || !sameText(routeLoadCourse, courseId)) {
                routeLoad = startMapRoute(text as String);
                routeLoadText = routeLoad != null ? text : null;
                routeLoadCourse = routeLoad != null ? courseId : null;
            }
        } else {
            routeLoad = null;
            routeLoadText = null;
            routeLoadCourse = null;
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

    // Écran de démarrage : parcours choisi (id de la liste, "" course envoyée, null sortie libre).
    function selectCourse(id) as Void {
        courseId = id;
        load();
        if (id != null && !id.equals("")) {
            fetchCourse();
        } else if (id != null && route == null) {
            fetchRoute();
        }
    }

    // Liste des parcours de l'écran de démarrage : [id, « c » / « p », nom, départ, distance, D+, envoyé]
    // par parcours (champ wl, téléchargé avec le même code).
    function courses() as Array {
        var out = [] as Array;
        var text = Application.Storage.getValue("list");
        if (!(text instanceof String) || !sameText(Application.Storage.getValue("listCode"), lastCode)) {
            return out;
        }
        var lines = splitText(text as String, "\n");
        if (lines.size() < 1 || !lines[0].equals("TPL1")) {
            return out;
        }
        for (var i = 1; i < lines.size(); i++) {
            var p = splitText(lines[i], "|");
            if (p.size() >= 6) {
                out.add([p[0], p[1], p[2], toNum(p[3]), toNum(p[4]), toNum(p[5]), p.size() >= 7 && p[6].equals("*")]);
            }
        }
        return out;
    }

    // Nom de la course envoyée à la montre (document du code), ou null.
    function mainCourseName() as String or Null {
        var text = Application.Storage.getValue("plan0");
        if (!(text instanceof String) || !sameText(Application.Storage.getValue("planCode"), lastCode)) {
            return null;
        }
        return planName(text as String);
    }

    // Relit le plan du parcours choisi s'il a changé et le donne à Trail Planner (qui recale la position
    // et, en course, garde les passages déjà notés). Un plan téléchargé avec un autre code est ignoré.
    function load() as Void {
        var text = null;
        var prof = null;
        if (courseId != null && sameText(Application.Storage.getValue("planCode"), lastCode)) {
            if (courseId.equals("")) {
                text = Application.Storage.getValue("plan0");
                prof = Application.Storage.getValue("profile0");
            } else if (sameText(Application.Storage.getValue("planCourse"), courseId)) {
                text = Application.Storage.getValue("plan");
                prof = Application.Storage.getValue("profile");
            }
        }
        if (!(prof instanceof String)) {
            prof = null;
        }
        if (!(text instanceof String)) {
            plan = null;
            planText = null;
            profText = null;
            profLoad = null;
            profLoadPlan = null;
        } else {
            if (planText == null || !text.equals(planText)) {
                plan = parsePlan(text as String);
                planText = plan != null ? text : null;
                profText = null;
            }
            // Profil fin lu en quelques secondes (stepLoads) ; en attendant, celui tiré du plan.
            if (plan != null && !sameText(prof, profText)) {
                profText = prof;
                profLoad = prof != null ? startProfile(prof as String) : null;
                profLoadPlan = profLoad != null ? plan : null;
            }
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
        } else if (courseId == null) {
            status = tpText(Rez.Strings.tp_free_run);
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
    // Contenu de l'écran de démarrage (liste des parcours et son code, code en vigueur, course envoyée à la
    // montre) : la liste affichée est refaite quand il change (CompanionApp.refreshStart).
    function startSignature() as String {
        var list = Application.Storage.getValue("list");
        var lc = Application.Storage.getValue("listCode");
        var name = mainCourseName();
        return (list instanceof String ? list as String : "") + "#" + (lc instanceof String ? lc as String : "") + "#" +
            (lastCode instanceof String ? lastCode as String : "") + "#" + (name != null ? name : "");
    }

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

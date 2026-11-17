import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Application;
import Toybox.Attention;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Position;
import Toybox.Sensor;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

// États de la sortie.
const READY = 0;    // avant le départ : START pour démarrer
const RUNNING = 1;  // enregistrement en cours : START = pause, BACK = tour
const PAUSED = 2;   // en pause : START pour reprendre, BACK = menu Reprendre / Enregistrer / Supprimer
const DONE = 3;     // enregistrée ou supprimée : BACK pour quitter

// La sortie : enregistrement (activité Trail, fichier FIT envoyé à Garmin Connect), GPS, position
// le long du parcours (GPS calé sur le tracé du plan, comme le champ de données) et plan de la course,
// téléchargé via le téléphone au lancement puis toutes les 5 minutes.
class Run {
    const PROJECT = "trail-planner-814f6";

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
    var laps = 1;             // tour en cours
    var lapUntil = 0;         // s Unix : « Tour N » affiché jusqu'à cet instant
    var planText = null;      // textes du plan et du profil chargés (seul un plan modifié est relu)
    var profText = null;
    var timer = null;
    var ticks = 0;
    var lastCode = null;      // code montre en vigueur (réglages)
    var fetchCode = null;     // code de la dernière demande de plan

    function initialize() {
        lastCode = codeSetting();
        load();
    }

    // Lancement de l'appli : GPS, cardio, rafraîchissement chaque seconde, plan.
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
        if (state == RUNNING) {
            var info = Activity.getActivityInfo();
            if (info != null && plan != null) {
                dist = courseDistance(info);
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
        }
        session.start();
        state = RUNNING;
        signal(Attention.TONE_START);
    }

    function pause() as Void {
        session.stop();
        state = PAUSED;
        signal(Attention.TONE_STOP);
    }

    function resume() as Void {
        session.start();
        state = RUNNING;
        signal(Attention.TONE_START);
    }

    function save() as Void {
        session.save();
        session = null;
        saved = true;
        state = DONE;
    }

    function discard() as Void {
        session.discard();
        session = null;
        saved = false;
        state = DONE;
    }

    // BACK pendant l'enregistrement : nouveau tour dans le fichier FIT (« Tour N » 4 s).
    function lap() as Void {
        session.addLap();
        laps++;
        lapUntil = Time.now().value() + 4;
        signal(Attention.TONE_LAP);
    }

    function signal(tone as Attention.Tone) as Void {
        if (Attention has :playTone) {
            Attention.playTone(tone);
        }
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(60, 250)] as Array<Attention.VibeProfile>);
        }
    }

    // --- Position le long du parcours --------------------------------------------------------------

    // Distance le long du parcours (m), comme le champ de données : position GPS calée sur le tracé du
    // plan près de la position attendue (dernier calage + distance montre depuis) ; hors du tracé, elle
    // reste figée (« Hors parcours ») ; sans position GPS, elle avance avec la distance montre. Plan sans
    // tracé : distance parcourue.
    function courseDistance(info as Activity.Info) as Float {
        var walked = info.elapsedDistance != null ? info.elapsedDistance.toFloat() : 0.0;
        if (!plan.hasRoute()) {
            return walked;
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

    // --- Plan de la course ---------------------------------------------------------------------------

    // Document du code montre (le même que pour le champ) : plan `w` et profil `wp`, via le téléphone.
    function fetch() as Void {
        var code = codeSetting();
        if (code == null) {
            refreshStatus();
            return;
        }
        fetchCode = code;
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents/shares/" +
                code + "?mask.fieldPaths=w&mask.fieldPaths=wp",
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
            if (fields instanceof Dictionary) {
                w = textOf(fields["w"]);
                wp = textOf(fields["wp"]);
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
        } else {
            Application.Storage.setValue("fetchError", responseCode);
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
    // Un plan téléchargé avec un autre code (code changé depuis) est ignoré.
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
            matched = -1.0;
            offCount = 0;
            offRoute = false;
        }
        refreshStatus();
    }

    function sameText(a, b) as Boolean {
        if (!(a instanceof String) || !(b instanceof String)) {
            return a == null && b == null;
        }
        return (a as String).equals(b as String);
    }

    // Code montre des réglages, ou null s'il manque (moins de 8 caractères).
    function codeSetting() as String or Null {
        var code = Application.Properties.getValue("code");
        if (code instanceof String && code.length() >= 8) {
            return code as String;
        }
        return null;
    }

    function refreshStatus() as Void {
        var err = Application.Storage.getValue("fetchError");
        if (lastCode == null) {
            status = "Saisis le code montre";
        } else if (plan != null) {
            status = "";
        } else if (err == 404) {
            status = "Code inconnu";
        } else if (err == Communications.BLE_CONNECTION_UNAVAILABLE) {
            status = "Téléphone non connecté";
        } else if (err == Communications.NETWORK_RESPONSE_TOO_LARGE) {
            status = "Plan trop gros pour la montre";
        } else if (err != null) {
            status = "Plan : erreur " + err;
        } else if (noCourse) {
            status = "Aucune course envoyée";
        } else {
            status = "Plan en attente...";
        }
    }

    // Réglages changés (Garmin Connect, ou code saisi sur la montre) : avec un autre code, l'ancien plan
    // est oublié et le nouveau téléchargé.
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
}

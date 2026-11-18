import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

(:background)
class TrailPlannerApp extends Application.AppBase {
    var field = null;

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        field = new TrailPlannerField();
        scheduleFetch();
        return [field];
    }

    function getServiceDelegate() {
        return [new PlanService()];
    }

    // Réglages sur la montre : saisie du code montre court (8 chiffres), voir SettingsMenu.mc.
    function getSettingsView() {
        return [new TrailPlannerSettingsMenu(), new TrailPlannerSettingsDelegate()];
    }

    // Contrôle du plan toutes les 5 minutes (minimum imposé par Garmin) tant qu'un code est saisi.
    function scheduleFetch() as Void {
        if (!(Toybox.System has :ServiceDelegate)) {
            return;
        }
        var code = Application.Properties.getValue("code");
        if (code instanceof String && code.length() >= 8) {
            Background.registerForTemporalEvent(new Time.Duration(5 * 60));
        } else {
            Background.deleteTemporalEvent();
        }
    }

    function onBackgroundData(raw) as Void {
        // Tâche de fond : { plan, msg, acked } (plan seul, texte ou code d'erreur, dans les anciennes versions).
        var data = raw;
        if (raw instanceof Dictionary) {
            data = raw["plan"];
            onAcked(raw["acked"]);
            onMessage(raw["msg"]);
        }
        if (data instanceof String && data.length() > 1 && data.substring(0, 1).equals("-")) {
            // Rien sur la montre : sortie libre (plan vide), position masquée à moins de ce rayon du départ.
            Application.Storage.setValue("plan", "");
            Application.Storage.setValue("freeHide", data.substring(1, data.length()).toNumber());
            Application.Storage.setValue("fetchError", null);
        } else if (data instanceof String && data.length() > 4) {
            Application.Storage.setValue("plan", data);
            Application.Storage.setValue("fetchError", null);
        } else if (data instanceof Number) {
            Application.Storage.setValue("fetchError", data);
        }
        if (field != null) {
            field.reload();
        }
        WatchUi.requestUpdate();
    }

    // Accusé écrit par la tâche de fond : oublié s'il correspond toujours à l'accusé en attente
    // (sinon, par exemple message fermé d'un tour entre-temps, il repartira au prochain contrôle).
    function onAcked(acked) as Void {
        if (!(acked instanceof Array) || acked.size() < 2) {
            return;
        }
        var pend = Application.Storage.getValue("msgAck");
        if (pend instanceof Dictionary && acked[0] instanceof String && (acked[0] as String).equals(pend["id"]) && pend["read"] == acked[1]) {
            Application.Storage.setValue("msgAck", null);
        }
    }

    // Nouveau message de l'assistance (jamais affiché) : plein écran sur la montre, accusé « reçu » en attente.
    function onMessage(msg) as Void {
        if (!(msg instanceof Array) || msg.size() < 2 || !(msg[0] instanceof String) || !(msg[1] instanceof String)) {
            return;
        }
        var id = msg[0] as String;
        var seen = Application.Storage.getValue("msgSeen");
        if (seen instanceof String && seen.equals(id)) {
            return;
        }
        Application.Storage.setValue("msgSeen", id);
        Application.Storage.setValue("msgAck", { "id" => id, "got" => Time.now().value(), "read" => 0 });
        if (field != null) {
            field.showMessage(id, msg[1] as String);
        }
    }

    function onSettingsChanged() as Void {
        // Nouveau code : on oublie l'ancien plan.
        Application.Storage.setValue("plan", null);
        Application.Storage.setValue("fetchError", null);
        if (field != null) {
            field.reload();
        }
        scheduleFetch();
        WatchUi.requestUpdate();
    }
}

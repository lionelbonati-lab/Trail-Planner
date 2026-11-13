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

    function onBackgroundData(data) as Void {
        if (data instanceof String && data.length() > 4) {
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

import Toybox.Activity;
import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Trail Planner Companion : appli montre qui enregistre la sortie Trail avec l'écran et les calculs
// d'EndurancePro, le profil de la course qui suit le coureur et le suivi pour l'assistance, d'après le
// plan envoyé par l'app web (même code montre que le champ Trail Planner et EndurancePro).
class CompanionApp extends Application.AppBase {
    var run = null;
    var view = null;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary or Null) as Void {
        run = new Run();
        run.begin();
    }

    function onStop(state as Dictionary or Null) as Void {
        if (run != null) {
            run.end();
        }
    }

    function getInitialView() {
        view = new MainView(run as Run);
        return [view, new MainDelegate(run as Run, view as MainView)];
    }

    // Comme EnduranceProApp.refreshViewSettings() : appelé par le menu après chaque réglage changé,
    // relu tout de suite par EndurancePro (y compris pendant la sortie).
    function refreshViewSettings() as Void {
        if (run != null) {
            (run as Run).ep.updateAllSettings();
        }
        WatchUi.requestUpdate();
    }

    // Réglages changés dans Garmin Connect. Code montre : pris en compte tout de suite (plan, profil,
    // réglages EndurancePro). Réglages EndurancePro : comme dans le champ, ignorés une fois la sortie
    // démarrée (seul le menu de la montre les change en course).
    function onSettingsChanged() as Void {
        if (run == null) {
            return;
        }
        (run as Run).settingsChanged();
        var info = Activity.getActivityInfo();
        if (info == null || info.timerTime == null || info.timerTime == 0) {
            (run as Run).ep.updateAllSettings();
        }
        WatchUi.requestUpdate();
    }
}

function getApp() as CompanionApp {
    return Application.getApp() as CompanionApp;
}

function getRun() as Run {
    return getApp().run as Run;
}

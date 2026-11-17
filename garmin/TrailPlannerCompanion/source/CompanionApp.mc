import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Trail Planner Companion : appli montre qui enregistre la sortie Trail avec le plan de la course
// envoyé par l'app web (même code montre que le champ de données Trail Planner). Écrans : profil de la
// course qui suit le coureur (zoom et couleurs des pentes dans le menu), données de la sortie.
class CompanionApp extends Application.AppBase {
    var run = null;

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
        var view = new MainView(run as Run);
        return [view, new MainDelegate(run as Run, view)];
    }

    // Réglages changés dans Garmin Connect (code, zoom, couleurs des pentes).
    function onSettingsChanged() as Void {
        if (run != null) {
            run.settingsChanged();
        }
        WatchUi.requestUpdate();
    }
}

function getRun() as Run {
    return (Application.getApp() as CompanionApp).run as Run;
}

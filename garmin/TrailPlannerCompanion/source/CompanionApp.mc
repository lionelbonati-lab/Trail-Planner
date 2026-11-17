import Toybox.Activity;
import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Trail Planner Companion : appli montre qui enregistre la sortie Trail avec l'écran et les calculs
// d'EndurancePro, le profil de la course qui suit le coureur, la carte et le suivi pour l'assistance,
// d'après le plan envoyé par l'app web (même code montre que le champ Trail Planner et EndurancePro).
class CompanionApp extends Application.AppBase {
    const PAGES = 3;          // EndurancePro, profil, carte

    var run = null;
    var mainView = null;      // écrans EndurancePro, profil (et carte sans fond de carte)
    var mapView = null;       // carte avec fond Garmin (montres à cartes), créée à la première visite
    var mapTried = false;
    var page = 0;
    var pendingExplore = false; // « Explorer la carte » choisi dans le menu, lancé une fois le menu fermé

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
        mainView = new MainView(run as Run);
        return [mainView, new MainDelegate(run as Run)];
    }

    // Carte avec fond Garmin, si la montre en a (créée une seule fois).
    function map() {
        if (!mapTried) {
            mapTried = true;
            mapView = createMapView(run as Run);
        }
        return mapView;
    }

    // Fond de carte Garmin disponible (sinon l'écran Carte montre le tracé seul).
    function hasMap() as Boolean {
        return mapSupported();
    }

    function nextPage(dir as Number) as Void {
        showPage((page + dir + PAGES) % PAGES);
    }

    // Écran p : la carte Garmin est une vue à part, les autres écrans sont dans MainView.
    function showPage(p as Number) as Void {
        var wasMap = page == 2 && mapView != null;
        page = p;
        if (p == 2 && map() != null) {
            if (!wasMap) {
                WatchUi.switchToView(mapView, new MainDelegate(run as Run), WatchUi.SLIDE_IMMEDIATE);
            }
        } else {
            (mainView as MainView).page = p;
            if (wasMap) {
                WatchUi.switchToView(mainView, new MainDelegate(run as Run), WatchUi.SLIDE_IMMEDIATE);
            }
        }
        WatchUi.requestUpdate();
    }

    // Carte en cours d'exploration (déplacer, zoomer avec les boutons de la carte Garmin).
    function exploring() as Boolean {
        return page == 2 && mapView != null && mapView.exploring;
    }

    // « Explorer la carte » : appelé une fois le menu fermé (Run.onTick).
    function startExplore() as Void {
        pendingExplore = false;
        if (!hasMap()) {
            return;
        }
        showPage(2);
        mapView.setExploring(true);
    }

    function stopExplore() as Void {
        if (mapView != null) {
            mapView.setExploring(false);
        }
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
    // tracé, réglages EndurancePro). Réglages EndurancePro : comme dans le champ, ignorés une fois la
    // sortie démarrée (seul le menu de la montre les change en course).
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

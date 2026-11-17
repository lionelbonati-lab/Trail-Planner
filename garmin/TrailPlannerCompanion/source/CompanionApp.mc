import Toybox.Activity;
import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

// Trail Planner Companion : appli montre qui enregistre la sortie Trail avec les écrans et les calculs
// d'EndurancePro et du champ Trail Planner, le profil de la course qui suit le coureur, la carte et le
// suivi pour l'assistance, d'après le plan envoyé par l'app web (même code montre que le champ Trail
// Planner et EndurancePro).
class CompanionApp extends Application.AppBase {
    const PAGES = 4;          // EndurancePro, Trail Planner, profil, carte
    const TP_PAGE = 1;
    const MAP_PAGE = 3;

    var run = null;
    var mainView = null;      // écrans EndurancePro, profil (et carte sans fond de carte)
    var mapView = null;       // carte avec fond Garmin (montres à cartes), créée à la première visite
    var mapTried = false;
    var page = 0;
    var pendingExplore = false; // « Explorer la carte » choisi dans le menu, lancé une fois le menu fermé
    var baseVisible = true;   // écran de la sortie au premier plan (aucun menu par-dessus)
    var focusKey = null;      // dernier événement qui a affiché l'écran Trail Planner
    var focusBack = -1;       // écran à retrouver une fois l'événement passé (-1 : aucun)

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

    // Haut / Bas : écran suivant ; un changement à la main annule le retour automatique.
    function nextPage(dir as Number) as Void {
        focusBack = -1;
        showPage((page + dir + PAGES) % PAGES);
    }

    // Chaque seconde pendant la sortie (Run.onTick) : un rappel nutrition, l'arrivée à un ravito ou une
    // alerte de barrière horaire (TrailPlannerScreen.focusKey) affiche l'écran Trail Planner, une fois par
    // événement ; l'événement passé, retour à l'écran d'avant. Jamais par-dessus un menu ni pendant
    // l'exploration de la carte.
    function checkFocus(key) as Void {
        if (!baseVisible || exploring()) {
            return;
        }
        if (key != null) {
            if (focusKey == null || !(key as String).equals(focusKey)) {
                focusKey = key;
                if (page != TP_PAGE) {
                    focusBack = page;
                    showPage(TP_PAGE);
                }
            }
        } else {
            focusKey = null;
            if (focusBack >= 0) {
                var back = focusBack;
                focusBack = -1;
                if (page == TP_PAGE) {
                    showPage(back);
                }
            }
        }
    }

    // Écran p : la carte Garmin est une vue à part, les autres écrans sont dans MainView.
    function showPage(p as Number) as Void {
        var wasMap = page == MAP_PAGE && mapView != null;
        page = p;
        if (p == MAP_PAGE && map() != null) {
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
        return page == MAP_PAGE && mapView != null && mapView.exploring;
    }

    // « Explorer la carte » : appelé une fois le menu fermé (Run.onTick).
    function startExplore() as Void {
        pendingExplore = false;
        if (!hasMap()) {
            return;
        }
        focusBack = -1;
        showPage(MAP_PAGE);
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

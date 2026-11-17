import Toybox.Activity;
import Toybox.Application;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

// Trail Planner Companion : appli montre qui enregistre la sortie Trail avec les écrans et les calculs
// d'EndurancePro et du champ Trail Planner, le profil de la course qui suit le coureur, la carte et le
// suivi pour l'assistance, d'après le plan envoyé par l'app web (même code montre que le champ Trail
// Planner et EndurancePro).
class CompanionApp extends Application.AppBase {
    const PAGES = 4;          // EndurancePro, Trail Planner, profil, carte
    const TP_PAGE = 1;
    const PROFILE_PAGE = 2;
    const MAP_PAGE = 3;

    var run = null;
    var mainView = null;      // écrans EndurancePro, profil (et carte sans fond de carte)
    var mapView = null;       // carte avec fond Garmin (montres à cartes), créée à la première visite
    var mapTried = false;
    var page = 0;
    var pendingExplore = false; // « Explorer la carte » choisi dans le menu, lancé une fois le menu fermé
    var baseVisible = true;   // écran de la sortie au premier plan (aucun menu par-dessus)
    var startShown = false;   // liste de l'écran de démarrage au premier plan
    var overviewOn = false;   // fiche d'un parcours sur la carte Garmin (écran de démarrage)
    var courseOn = false;     // écrans de course affichés (entre « Démarrer » et le retour à la liste)
    var restoreTimer = null;  // retour à la course si la liste apparaît pendant une sortie (restoreCourse)
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

    // L'appli s'ouvre sur l'écran de démarrage (liste des parcours, Start.mc).
    function getInitialView() {
        mainView = new MainView(run as Run);
        return [new StartMenu(), new StartDelegate()];
    }

    // Liste des parcours changée (téléchargée) : la liste affichée est refaite (jamais pendant une sortie).
    function refreshStart() as Void {
        if (startShown && !(run as Run).active()) {
            WatchUi.switchToView(new StartMenu(), new StartDelegate(), WatchUi.SLIDE_IMMEDIATE);
        }
    }

    // Fiche du parcours choisi : résumé d'avant départ, comme le champ Trail Planner (CourseOverview) ; la
    // carte reste sur l'écran Carte (la fiche sur la carte Garmin, setOverview, n'est plus utilisée).
    function showOverview() as Void {
        WatchUi.pushView(new CourseOverview(), new OverviewDelegate(), WatchUi.SLIDE_LEFT);
    }

    // Liste à l'écran (StartMenu.onShow) : pendant une sortie, elle ne doit pas rester affichée. Si la
    // montre a retiré l'écran de course (bouton BACK / Lap traité par le système), il revient aussitôt.
    function onStartShown() as Void {
        if (run != null && (run as Run).active()) {
            restoreTimer = new Timer.Timer();
            (restoreTimer as Timer.Timer).start(method(:restoreCourse), 50, false);
        }
    }

    // Retour à l'écran de course affiché avant ; tour noté s'il ne l'a pas été (le BACK qui a retiré l'écran
    // était un tour), menu de pause en pause.
    function restoreCourse() as Void {
        restoreTimer = null;
        var r = run as Run;
        if (!startShown || !r.active()) {
            return;
        }
        courseOn = true;
        focusBack = -1;
        var v = (page == MAP_PAGE && mapView != null) ? mapView : mainView;
        WatchUi.pushView(v, new MainDelegate(r), WatchUi.SLIDE_IMMEDIATE);
        if (r.state == RUNNING) {
            if (System.getTimer() - r.lastLapMs > 1500) {
                r.lap();
            }
        } else {
            pushPauseMenu();
        }
        WatchUi.requestUpdate();
    }

    function endOverview() as Void {
        overviewOn = false;
        if (mapView != null) {
            mapView.setOverview(false);
        }
    }

    // Démarrer : écrans de course, au-dessus de la liste (BACK avant le départ y revient).
    function beginCourse() as Void {
        endOverview();
        courseOn = true;
        page = 0;
        focusBack = -1;
        (mainView as MainView).page = 0;
        if (startShown) {
            WatchUi.pushView(mainView, new MainDelegate(run as Run), WatchUi.SLIDE_LEFT);
        } else {
            WatchUi.switchToView(mainView, new MainDelegate(run as Run), WatchUi.SLIDE_LEFT);
        }
    }

    // BACK avant le départ : retour à la liste des parcours (l'écran de course est retiré par la montre).
    function leaveCourse() as Void {
        stopExplore();
        courseOn = false;
        page = 0;
        focusBack = -1;
        (mainView as MainView).page = 0;
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

    // Haut / Bas : écran suivant ; un changement à la main annule le retour automatique. En sortie libre
    // (aucun parcours choisi), seulement EndurancePro et la carte : Trail Planner et Profil n'ont rien à
    // montrer.
    function nextPage(dir as Number) as Void {
        focusBack = -1;
        var p = (page + dir + PAGES) % PAGES;
        if ((run as Run).courseId == null) {
            while (p == TP_PAGE || p == PROFILE_PAGE) {
                p = (p + dir + PAGES) % PAGES;
            }
        }
        showPage(p);
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

    // Appui long sur Haut : menu du zoom sur l'écran Profil, de l'échelle sur l'écran Carte (true) ; sinon
    // false (menu complet d'EndurancePro).
    function quickMenu() as Boolean {
        if (page == PROFILE_PAGE) {
            pushZoomMenu();
            return true;
        }
        if (page == MAP_PAGE) {
            pushMapScaleMenu();
            return true;
        }
        return false;
    }

    // Carte en cours d'exploration (déplacer, zoomer avec les boutons de la carte Garmin).
    function exploring() as Boolean {
        return page == MAP_PAGE && mapView != null && mapView.exploring;
    }

    // Fiche du parcours en exploration (BACK revient à la vue d'ensemble).
    function overviewExploring() as Boolean {
        return overviewOn && mapView != null && mapView.exploring;
    }

    // « Explorer la carte » proposé dans le menu : seulement si une carte est à l'écran sous le menu
    // (écrans de course, ou fiche d'un parcours), pas depuis la liste.
    function canExplore() as Boolean {
        return hasMap() && (courseOn || overviewOn);
    }

    // « Explorer la carte » : appelé une fois le menu fermé (Run.onTick). Sur la fiche du parcours, la
    // carte déjà affichée passe en exploration ; en course, l'écran Carte s'affiche en exploration.
    function startExplore() as Void {
        pendingExplore = false;
        if (!canExplore()) {
            return;
        }
        if (overviewOn) {
            mapView.setExploring(true);
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

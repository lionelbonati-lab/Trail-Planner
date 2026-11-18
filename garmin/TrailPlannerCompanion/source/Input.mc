import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Boutons, comme dans une activité Garmin :
// - START : départ, pause (menu Reprendre / Enregistrer / Supprimer), reprise ;
// - BACK (Lap) : nouveau tour pendant l'enregistrement (et passage au point le plus proche, 2e tour au
//   ravito = départ), menu de pause en pause, sortie de l'appli avant le départ ou une fois la sortie
//   enregistrée ;
// - Haut / Bas : écran suivant (EndurancePro, profil, carte) ;
// - appui long sur Haut (Menu) : zoom du profil depuis le profil, échelle depuis la carte ; ailleurs,
//   réglages d'EndurancePro (avec ceux de l'appli dans ses dossiers).
// Carte en exploration (menu « Explorer la carte ») : les boutons vont à la carte Garmin (déplacer,
// zoomer), sauf BACK qui revient au suivi du coureur.
// Écran tactile : balayages pour changer d'écran ; un balayage « retour » ne coupe pas la sortie et le tap
// ne fait rien (START et BACK restent sur les boutons).
class MainDelegate extends WatchUi.BehaviorDelegate {
    var run as Run;
    var lastAction = 0;       // dernière action START ou BACK (System.getTimer), contre un double envoi

    function initialize(r as Run) {
        BehaviorDelegate.initialize();
        run = r;
    }

    // Selon la montre, START et BACK arrivent comme touches (onKey) ou comme comportements (onSelect,
    // onBack) : sur l'Enduro 3, START arrivait par onSelect, qui ne démarrait rien. Les deux chemins mènent
    // à startAction / backAction ; un second envoi du même appui (moins de 0,4 s) est ignoré.
    function twice() as Boolean {
        var now = System.getTimer();
        if (now - lastAction < 400) {
            return true;
        }
        lastAction = now;
        return false;
    }

    // START : départ, pause (menu Reprendre / Enregistrer / Supprimer), reprise.
    function startAction() as Boolean {
        if (run.state == DONE || twice()) {
            return true;
        }
        if (run.state == READY) {
            run.start();
        } else if (run.state == RUNNING) {
            run.pause();
            pushPauseMenu();
        } else if (run.state == PAUSED) {
            run.resume();
        }
        WatchUi.requestUpdate();
        return true;
    }

    // BACK (Lap) : tour pendant la sortie, menu de pause en pause, sortie de l'appli une fois la sortie
    // enregistrée ; avant le départ, retour à la liste des parcours (false : la montre retire l'écran).
    function backAction() as Boolean {
        if (run.state == READY) {
            getApp().leaveCourse();
            return false;
        }
        if (twice()) {
            return true;
        }
        if (run.state == RUNNING) {
            run.lap();
            WatchUi.requestUpdate();
        } else if (run.state == PAUSED) {
            pushPauseMenu();
        } else {
            System.exit();
        }
        return true;
    }

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
        var key = evt.getKey();
        if (getApp().exploring()) {
            if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
                getApp().stopExplore();
                return true;
            }
            return false;
        }
        if (key == WatchUi.KEY_ENTER) {
            return startAction();
        }
        if (key == WatchUi.KEY_LAP || (key == WatchUi.KEY_ESC && run.state != READY)) {
            return backAction();
        }
        // Haut, Bas, Menu, BACK avant le départ : comportements habituels (onNextPage, onPreviousPage,
        // onMenu, onBack).
        return BehaviorDelegate.onKey(evt);
    }

    function onSelect() as Boolean {
        if (getApp().exploring()) {
            return false;
        }
        return startAction();
    }

    function onBack() as Boolean {
        if (getApp().exploring()) {
            getApp().stopExplore();
            return true;
        }
        return backAction();
    }

    // Écran tactile : un tap ne démarre rien (START reste sur le bouton) ; le balayage « retour » ne fait
    // ni tour ni retour à la liste ; haut / bas changent d'écran.
    function onTap(evt as WatchUi.ClickEvent) as Boolean {
        return !getApp().exploring();
    }

    function onSwipe(evt as WatchUi.SwipeEvent) as Boolean {
        if (getApp().exploring()) {
            return false;
        }
        return evt.getDirection() == WatchUi.SWIPE_RIGHT;
    }

    function onNextPage() as Boolean {
        if (getApp().exploring()) {
            return false;
        }
        getApp().nextPage(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        if (getApp().exploring()) {
            return false;
        }
        getApp().nextPage(-1);
        return true;
    }

    // Appui long sur Haut : zoom du profil depuis le profil, échelle depuis la carte ; ailleurs, menu
    // d'EndurancePro (réglables en course, comme dans le champ).
    function onMenu() as Boolean {
        if (getApp().exploring()) {
            return false;
        }
        if (run.state != DONE && !getApp().quickMenu()) {
            WatchUi.pushView(new EnduranceProSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_UP);
        }
        return true;
    }
}

// Texte d'une ressource (Rez.Strings.…).
function tpText(res) as String {
    return WatchUi.loadResource(res) as String;
}

// --- Menu de pause ----------------------------------------------------------------------------------------

function pushPauseMenu() as Void {
    var menu = new WatchUi.Menu2({ :title => tpText(Rez.Strings.tp_paused) });
    menu.addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_resume), null, :resume, {}));
    menu.addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_save), null, :save, {}));
    menu.addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_discard), null, :discard, {}));
    WatchUi.pushView(menu, new PauseDelegate(), WatchUi.SLIDE_UP);
}

class PauseDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var run = getRun();
        var id = item.getId();
        if (id == :resume) {
            run.resume();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        } else if (id == :save) {
            run.save();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        } else if (id == :discard) {
            // Confirmation dans un second menu, « Non » en premier.
            var ask = new WatchUi.Menu2({ :title => tpText(Rez.Strings.tp_discard_ask) });
            ask.addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_no), null, :no, {}));
            ask.addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_yes), null, :yes, {}));
            WatchUi.pushView(ask, new DiscardDelegate(), WatchUi.SLIDE_LEFT);
        }
        WatchUi.requestUpdate();
    }
}

class DiscardDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        if (item.getId() == :yes) {
            getRun().discard();
            // Ferme la confirmation et le menu de pause.
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
            WatchUi.popView(WatchUi.SLIDE_DOWN);
        } else {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
        WatchUi.requestUpdate();
    }
}

// --- Réglages de l'appli rangés dans les dossiers d'EndurancePro (voir EnduranceProSettingsMenu.mc) -------

function zoomLabel(z as Number) as String {
    return tpText([Rez.Strings.tp_zoom_all, Rez.Strings.tp_zoom_20, Rez.Strings.tp_zoom_10, Rez.Strings.tp_zoom_5, Rez.Strings.tp_zoom_2,
        Rez.Strings.tp_zoom_leg, Rez.Strings.tp_zoom_ravito][z]);
}

// Choix du zoom du profil (appui long sur Haut depuis le profil, ou Affichage › Zoom du profil) ; depuis
// le profil (slopes), « Couleurs des pentes » en fin de menu.
function pushZoomMenu(slopes as Boolean) as Void {
    var menu = new WatchUi.Menu2({ :title => tpText(Rez.Strings.tp_zoom) });
    for (var z = 0; z < ZOOM_SPANS.size(); z++) {
        menu.addItem(new WatchUi.MenuItem(zoomLabel(z), null, z, {}));
    }
    if (slopes) {
        menu.addItem(new WatchUi.ToggleMenuItem(tpText(Rez.Strings.tp_slopes), tpText(Rez.Strings.tp_slopes_sub), :slopes, slopesOn(), {}));
    }
    menu.setFocus(zoomLevel());
    WatchUi.pushView(menu, new ZoomDelegate(), WatchUi.SLIDE_UP);
}

// Choix de l'échelle de la carte (appui long sur Haut depuis la carte, ou Affichage › Échelle de la carte).
function pushMapScaleMenu() as Void {
    var menu = new WatchUi.Menu2({ :title => tpText(Rez.Strings.tp_map_scale) });
    for (var z = 0; z < MAP_SCALES.size(); z++) {
        menu.addItem(new WatchUi.MenuItem(mapScaleLabel(z), null, z, {}));
    }
    menu.setFocus(mapScaleLevel());
    WatchUi.pushView(menu, new MapScaleDelegate(), WatchUi.SLIDE_UP);
}

class ZoomDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    // Un zoom : choisi, menu fermé ; « Couleurs des pentes » : bascule, menu laissé ouvert.
    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :slopes) {
            Application.Properties.setValue("slopes", (item as WatchUi.ToggleMenuItem).isEnabled());
            WatchUi.requestUpdate();
            return;
        }
        Application.Properties.setValue("zoom", id as Number);
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

class MapScaleDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        Application.Properties.setValue("mapScale", item.getId() as Number);
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

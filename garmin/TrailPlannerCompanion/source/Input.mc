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
// - appui long sur Haut (Menu) : réglages d'EndurancePro, avec le dossier « Trail Planner » en tête.
// Carte en exploration (menu « Explorer la carte ») : les boutons vont à la carte Garmin (déplacer,
// zoomer), sauf BACK qui revient au suivi du coureur.
// Écran tactile : balayages pour changer d'écran ; un balayage « retour » ne coupe pas la sortie et le tap
// ne fait rien (START et BACK restent sur les boutons).
class MainDelegate extends WatchUi.BehaviorDelegate {
    var run as Run;

    function initialize(r as Run) {
        BehaviorDelegate.initialize();
        run = r;
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
        if (key == WatchUi.KEY_ESC || key == WatchUi.KEY_LAP) {
            if (run.state == RUNNING) {
                run.lap();
                WatchUi.requestUpdate();
                return true;
            }
            if (run.state == PAUSED) {
                pushPauseMenu();
                return true;
            }
            // Sortie terminée : BACK quitte l'appli. Avant le départ : retour à la liste des parcours.
            if (run.state == DONE) {
                System.exit();
            }
            return BehaviorDelegate.onKey(evt);
        }
        // Haut, Bas, Menu : comportements habituels (onNextPage, onPreviousPage, onMenu).
        return BehaviorDelegate.onKey(evt);
    }

    // Balayage « retour » (écran tactile) : ignoré pendant la sortie ; en exploration, retour au suivi ;
    // avant le départ, retour à la liste des parcours.
    function onBack() as Boolean {
        if (getApp().exploring()) {
            getApp().stopExplore();
            return true;
        }
        if (run.state == READY) {
            getApp().leaveCourse();
            return false;
        }
        return run.state == RUNNING || run.state == PAUSED;
    }

    function onSelect() as Boolean {
        return !getApp().exploring();
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

    // Menu d'EndurancePro (réglables en course, comme dans le champ).
    function onMenu() as Boolean {
        if (getApp().exploring()) {
            return false;
        }
        if (run.state != DONE) {
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

// --- Dossier « Trail Planner » du menu (en tête du menu d'EndurancePro) -----------------------------------

function zoomLabel(z as Number) as String {
    return tpText([Rez.Strings.tp_zoom_all, Rez.Strings.tp_zoom_20, Rez.Strings.tp_zoom_10, Rez.Strings.tp_zoom_5, Rez.Strings.tp_zoom_2][z]);
}

class TrailPlannerMenu extends WatchUi.Menu2 {
    private var _zoomItem as WatchUi.MenuItem;
    private var _codeItem as WatchUi.MenuItem;
    private var _planItem as WatchUi.MenuItem;
    private var _scaleItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({ :title => "Trail Planner" });
        _zoomItem = new WatchUi.MenuItem(tpText(Rez.Strings.tp_zoom), null, :zoom, {});
        addItem(_zoomItem);
        addItem(new WatchUi.ToggleMenuItem(tpText(Rez.Strings.tp_slopes), tpText(Rez.Strings.tp_slopes_sub), :slopes, slopesOn(), {}));
        addItem(new WatchUi.ToggleMenuItem(tpText(Rez.Strings.tp_lap_pass), null, :lapPass,
            Application.Properties.getValue("lapPass") != false, {}));
        addItem(new WatchUi.ToggleMenuItem(tpText(Rez.Strings.tp_finish), tpText(Rez.Strings.tp_finish_sub), :finishStats,
            Application.Properties.getValue("finishStats") == true, {}));
        _codeItem = new WatchUi.MenuItem(tpText(Rez.Strings.set_trail_code), null, :code, {});
        addItem(_codeItem);
        _scaleItem = new WatchUi.MenuItem(tpText(Rez.Strings.tp_map_scale), null, :mapScale, {});
        addItem(_scaleItem);
        // Exploration : seulement avec le fond de carte Garmin, et une carte à l'écran sous le menu (écrans
        // de course ou fiche du parcours ; depuis la liste, l'option ferait disparaître la liste).
        if (getApp().canExplore()) {
            addItem(new WatchUi.MenuItem(tpText(Rez.Strings.tp_explore), null, :explore, {}));
        }
        _planItem = new WatchUi.MenuItem(tpText(Rez.Strings.tp_reload), null, :reload, {});
        addItem(_planItem);
        onShow();
    }

    function onShow() as Void {
        _zoomItem.setSubLabel(zoomLabel(zoomLevel()));
        _scaleItem.setSubLabel(mapScaleLabel(mapScaleLevel()));
        var code = Application.Properties.getValue("trail_code_prop");
        var text = "-";
        if (code instanceof String && (code as String).length() > 0) {
            var c = code as String;
            text = (c.length() <= 8) ? c : (c.substring(0, 8) as String) + "...";
        }
        _codeItem.setSubLabel(text);
        var run = getRun();
        _planItem.setSubLabel(run.plan != null ? run.plan.name : run.status);
    }
}

class TrailPlannerMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :zoom) {
            var menu = new WatchUi.Menu2({ :title => tpText(Rez.Strings.tp_zoom) });
            for (var z = 0; z < ZOOM_SPANS.size(); z++) {
                menu.addItem(new WatchUi.MenuItem(zoomLabel(z), null, z, {}));
            }
            menu.setFocus(zoomLevel());
            WatchUi.pushView(menu, new ZoomDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :mapScale) {
            var menu = new WatchUi.Menu2({ :title => tpText(Rez.Strings.tp_map_scale) });
            for (var z = 0; z < MAP_SCALES.size(); z++) {
                menu.addItem(new WatchUi.MenuItem(mapScaleLabel(z), null, z, {}));
            }
            menu.setFocus(mapScaleLevel());
            WatchUi.pushView(menu, new MapScaleDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :explore) {
            // Lancée une fois le menu fermé (dossier Trail Planner et menu principal), au tour suivant
            // de Run.onTick : la carte remplace alors l'écran affiché.
            var app = getApp();
            app.pendingExplore = true;
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        } else if (id == :slopes) {
            Application.Properties.setValue("slopes", (item as WatchUi.ToggleMenuItem).isEnabled());
        } else if (id == :lapPass) {
            Application.Properties.setValue("lapPass", (item as WatchUi.ToggleMenuItem).isEnabled());
        } else if (id == :finishStats) {
            Application.Properties.setValue("finishStats", (item as WatchUi.ToggleMenuItem).isEnabled());
        } else if (id == :code) {
            // Code à 8 chiffres d'EndurancePro (le même pour le plan, le profil et le suivi).
            pushTrailCodePicker();
        } else if (id == :reload) {
            getRun().fetch();
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
    }
}

class ZoomDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        Application.Properties.setValue("zoom", item.getId() as Number);
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

import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Boutons, comme dans une activité Garmin :
// - START : départ, pause (menu Reprendre / Enregistrer / Supprimer), reprise ;
// - BACK (Lap) : nouveau tour pendant l'enregistrement, menu de pause en pause, sortie de l'appli
//   avant le départ ou une fois la sortie enregistrée ;
// - Haut / Bas : écran suivant (profil, données) ;
// - appui long sur Haut (Menu) : zoom du profil, couleurs des pentes, code montre, plan.
// Écran tactile : balayages pour changer d'écran ; un balayage « retour » ne coupe pas la sortie et le tap
// ne fait rien (START et BACK restent sur les boutons).
class MainDelegate extends WatchUi.BehaviorDelegate {
    var run as Run;
    var view as MainView;

    function initialize(r as Run, v as MainView) {
        BehaviorDelegate.initialize();
        run = r;
        view = v;
    }

    function onKey(evt as WatchUi.KeyEvent) as Boolean {
        var key = evt.getKey();
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
            // Avant le départ ou sortie terminée : BACK quitte l'appli.
            return BehaviorDelegate.onKey(evt);
        }
        // Haut, Bas, Menu : comportements habituels (onNextPage, onPreviousPage, onMenu).
        return BehaviorDelegate.onKey(evt);
    }

    // Balayage « retour » (écran tactile) : ignoré pendant la sortie.
    function onBack() as Boolean {
        return run.state == RUNNING || run.state == PAUSED;
    }

    function onSelect() as Boolean {
        return true;
    }

    function onNextPage() as Boolean {
        view.nextPage(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        view.nextPage(-1);
        return true;
    }

    function onMenu() as Boolean {
        if (run.state != DONE) {
            WatchUi.pushView(new SettingsMenu(run), new SettingsDelegate(run), WatchUi.SLIDE_UP);
        }
        return true;
    }
}

// Texte d'une ressource (Rez.Strings.…).
function label(res) as String {
    return WatchUi.loadResource(res) as String;
}

// --- Menu de pause ----------------------------------------------------------------------------------------

function pushPauseMenu() as Void {
    var menu = new WatchUi.Menu2({ :title => "Pause" });
    menu.addItem(new WatchUi.MenuItem(label(Rez.Strings.Resume), null, :resume, {}));
    menu.addItem(new WatchUi.MenuItem(label(Rez.Strings.Save), null, :save, {}));
    menu.addItem(new WatchUi.MenuItem(label(Rez.Strings.Discard), null, :discard, {}));
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
            var ask = new WatchUi.Menu2({ :title => label(Rez.Strings.DiscardAsk) });
            ask.addItem(new WatchUi.MenuItem(label(Rez.Strings.No), null, :no, {}));
            ask.addItem(new WatchUi.MenuItem(label(Rez.Strings.Yes), null, :yes, {}));
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

// --- Menu des réglages (appui long sur Haut) ----------------------------------------------------------------

function zoomLabel(z as Number) as String {
    return label([Rez.Strings.ZoomAll, Rez.Strings.Zoom20, Rez.Strings.Zoom10, Rez.Strings.Zoom5, Rez.Strings.Zoom2][z]);
}

class SettingsMenu extends WatchUi.Menu2 {
    private var _zoomItem as WatchUi.MenuItem;
    private var _codeItem as WatchUi.MenuItem;

    function initialize(run as Run) {
        Menu2.initialize({ :title => "Trail Planner" });
        _zoomItem = new WatchUi.MenuItem(label(Rez.Strings.ZoomTitle), null, :zoom, {});
        addItem(_zoomItem);
        addItem(new WatchUi.ToggleMenuItem(label(Rez.Strings.SlopesTitle), label(Rez.Strings.SlopesSub), :slopes, slopesOn(), {}));
        _codeItem = new WatchUi.MenuItem(label(Rez.Strings.CodeTitle), null, :code, {});
        addItem(_codeItem);
        addItem(new WatchUi.MenuItem(label(Rez.Strings.ReloadTitle), run.plan != null ? run.plan.name : run.status, :reload, {}));
        onShow();
    }

    function onShow() as Void {
        _zoomItem.setSubLabel(zoomLabel(zoomLevel()));
        var code = Application.Properties.getValue("code");
        var text = "-";
        if (code instanceof String && (code as String).length() > 0) {
            var c = code as String;
            text = (c.length() <= 8) ? c : (c.substring(0, 8) as String) + "...";
        }
        _codeItem.setSubLabel(text);
    }
}

class SettingsDelegate extends WatchUi.Menu2InputDelegate {
    var run as Run;

    function initialize(r as Run) {
        Menu2InputDelegate.initialize();
        run = r;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :zoom) {
            var menu = new WatchUi.Menu2({ :title => label(Rez.Strings.ZoomTitle) });
            for (var z = 0; z < ZOOM_SPANS.size(); z++) {
                menu.addItem(new WatchUi.MenuItem(zoomLabel(z), null, z, {}));
            }
            menu.setFocus(zoomLevel());
            WatchUi.pushView(menu, new ZoomDelegate(), WatchUi.SLIDE_LEFT);
        } else if (id == :slopes) {
            Application.Properties.setValue("slopes", (item as WatchUi.ToggleMenuItem).isEnabled());
        } else if (id == :code) {
            pushCodePicker();
        } else if (id == :reload) {
            run.fetch();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
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

// --- Code montre à 8 chiffres (comme dans le champ de données) -------------------------------------------

// Un chiffre par colonne (police texte, assez étroite pour 8 colonnes).
class CodeDigitFactory extends WatchUi.PickerFactory {
    function initialize() {
        PickerFactory.initialize();
    }

    function getSize() as Number {
        return 10;
    }

    function getValue(index as Number) as Object or Null {
        return index;
    }

    function getDrawable(index as Number, selected as Boolean) as WatchUi.Drawable or Null {
        return new WatchUi.Text({
            :text => index.toString(),
            :color => Graphics.COLOR_WHITE,
            :font => Graphics.FONT_MEDIUM,
            :locX => WatchUi.LAYOUT_HALIGN_CENTER,
            :locY => WatchUi.LAYOUT_VALIGN_CENTER
        });
    }
}

function pushCodePicker() as Void {
    var cur = Application.Properties.getValue("code");
    var code = (cur instanceof String && (cur as String).length() == 8) ? cur as String : "00000000";
    var pattern = [] as Array<WatchUi.PickerFactory>;
    var defaults = [] as Array<Number>;
    for (var i = 0; i < 8; i++) {
        var d = (code.substring(i, i + 1) as String).toNumber();
        pattern.add(new CodeDigitFactory());
        defaults.add((d != null && d >= 0 && d <= 9) ? d as Number : 0);
    }
    var picker = new WatchUi.Picker({
        :title => new WatchUi.Text({
            :text => label(Rez.Strings.CodeTitle),
            :color => Graphics.COLOR_WHITE,
            :locX => WatchUi.LAYOUT_HALIGN_CENTER,
            :locY => WatchUi.LAYOUT_VALIGN_CENTER
        }),
        :pattern => pattern,
        :defaults => defaults
    });
    WatchUi.pushView(picker, new CodePickerDelegate(), WatchUi.SLIDE_LEFT);
}

// 00000000 efface le code.
class CodePickerDelegate extends WatchUi.PickerDelegate {
    function initialize() {
        PickerDelegate.initialize();
    }

    function onAccept(values as Array) as Boolean {
        var code = "";
        for (var i = 0; i < values.size(); i++) {
            code += (values[i] as Number).toString();
        }
        Application.Properties.setValue("code", code.equals("00000000") ? "" : code);
        getRun().settingsChanged();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    function onCancel() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

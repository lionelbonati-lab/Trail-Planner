// Réglages sur la montre (pendant une activité : appui long sur Haut › Champs Connect IQ ›
// Trail Planner) : saisie du code montre court à 8 chiffres affiché par l'app web, sans passer
// par Garmin Connect (dont les réglages manquent quand le champ est installé hors Store).
// Le code long reste saisissable dans Garmin Connect. 00000000 efface le code.
// « Tour = passage au point » : le bouton Lap valide le passage au point le plus proche.
import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class TrailPlannerSettingsMenu extends WatchUi.Menu2 {
    private var _codeItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({ :title => "Trail Planner" });
        _codeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.CodeTitle) as String, null, :code, {});
        addItem(_codeItem);
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.LapTitle) as String, null, :lap,
            Application.Properties.getValue("lapPass") != false, {}));
        onShow();
    }

    function onShow() as Void {
        var code = Application.Properties.getValue("code");
        var label = "-";
        if (code instanceof String && (code as String).length() > 0) {
            var c = code as String;
            label = (c.length() <= 8) ? c : (c.substring(0, 8) as String) + "...";
        }
        _codeItem.setSubLabel(label);
    }
}

class TrailPlannerSettingsDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        if (item.getId() == :code) {
            pushCodePicker();
        } else if (item.getId() == :lap) {
            Application.Properties.setValue("lapPass", (item as WatchUi.ToggleMenuItem).isEnabled());
        }
    }
}

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
            :text => WatchUi.loadResource(Rez.Strings.CodeTitle) as String,
            :color => Graphics.COLOR_WHITE,
            :locX => WatchUi.LAYOUT_HALIGN_CENTER,
            :locY => WatchUi.LAYOUT_VALIGN_CENTER
        }),
        :pattern => pattern,
        :defaults => defaults
    });
    WatchUi.pushView(picker, new CodePickerDelegate(), WatchUi.SLIDE_LEFT);
}

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
        // Même traitement qu'un code changé dans Garmin Connect : ancien plan oublié, contrôle relancé.
        (Application.getApp() as TrailPlannerApp).onSettingsChanged();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }

    function onCancel() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

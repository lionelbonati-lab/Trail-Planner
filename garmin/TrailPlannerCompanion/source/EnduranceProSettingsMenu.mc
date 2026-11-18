// EnduranceProSettingsMenu.mc — repris d'EndurancePro 2.7.3 dans l'appli Trail Planner Companion :
// c'est le menu de l'appli (appui long sur Haut). Ajouts de l'appli, rangés dans les dossiers
// d'EndurancePro (pas de dossier à part) : « Explorer la carte » en tête du menu (seulement avec une carte
// à l'écran) ; Affichage : zoom du profil, échelle de la carte ; Colorisation :
// couleurs des pentes ; Circuit : tour = passage au point ; Alarmes : rappels nutrition, vibrations des
// rappels ; Propriétés : code Trail Planner (déplacé d'Allure) et rechargement du plan. Un nouveau code
// montre relance le téléchargement du plan (Run.settingsChanged) au lieu de la tâche de fond.
// En-tête d'origine :
// EnduranceProSettingsMenu.mc — v2.2.4
// Menu de réglages on-watch (getSettingsView()) — accessible sans téléphone via appui long
// sur Haut pendant une activité > Champs Connect IQ > réglages du champ.
// Écrit directement dans Application.Properties (mêmes clés que properties.xml) ;
// EnduranceProApp.refreshViewSettings() est appelé après chaque écriture pour propager
// immédiatement le changement à la vue en cours d'exécution (y compris pendant l'activité).
// v1.9.45 : Tous les réglages migrés sur la montre, sauf lissage (buffer_size_prop) et
// unité d'allure (pace_unit_prop), qui restaient gérés depuis le téléphone. v2.1.2 :
// lissage et unité d'allure migrés à leur tour, dans le dossier "Propriétés". Les 8 toggles
// + l'unité FIT de la refonte v2.1.2 restent gérés depuis le téléphone (voir settings.xml).
import Toybox.WatchUi;
import Toybox.Application;
import Toybox.Application.Properties;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.UserProfile;

// Titre standard (centré, blanc) pour un WatchUi.Picker
function pickerTitle(text as String) as WatchUi.Text {
    return new WatchUi.Text({
        :text => text,
        :color => Graphics.COLOR_WHITE,
        :locX => WatchUi.LAYOUT_HALIGN_CENTER,
        :locY => WatchUi.LAYOUT_VALIGN_CENTER
    });
}

// --- Générique : sous-menu "liste de choix" qui écrit une valeur littérale dans une Property ---
class PropertyListMenu extends WatchUi.Menu2 {
    // options : Array de [label as String, value as Object]
    // propKey : si non-null, la case correspondant à la valeur actuelle de
    // la Property est automatiquement sélectionnée à l'ouverture
    function initialize(title as String, options as Array, propKey as String or Null) {
        Menu2.initialize({:title => title});
        for (var i = 0; i < options.size(); i++) {
            var opt = options[i];
            addItem(new WatchUi.MenuItem(opt[0] as String, null, opt[1], {}));
        }
        if (propKey != null) {
            setFocus(indexForValue(options, Properties.getValue(propKey)));
        }
    }
}

class PropertyListDelegate extends WatchUi.Menu2InputDelegate {
    private var _propKey as String;
    function initialize(propKey as String) {
        Menu2InputDelegate.initialize();
        _propKey = propKey;
    }
    function onSelect(item as WatchUi.MenuItem) as Void {
        Properties.setValue(_propKey, item.getId());
        getApp().refreshViewSettings();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}

// FONT_NUMBER_MEDIUM (et même FONT_NUMBER_MILD) débordent de la colonne du picker dès
// 4 caractères sur certaines montres (ex: "5:30", "1000") ; on bascule sur la police
// texte standard, plus étroite, dès ce seuil.
function pickerNumberFont(text as String) as Graphics.FontType {
    return (text.length() <= 3) ? Graphics.FONT_NUMBER_MEDIUM : Graphics.FONT_MEDIUM;
}

// --- Générique : picker numérique min..max avec pas configurable, écrit une valeur brute
// dans une Property (la valeur stockée n'est jamais affectée par le pas d'affichage) ---
class RangePickerFactory extends WatchUi.PickerFactory {
    private var _min as Number;
    private var _max as Number;
    private var _step as Number;
    function initialize(min as Number, max as Number, step as Number) {
        PickerFactory.initialize();
        _min = min;
        _max = max;
        _step = step;
    }
    function getSize() as Number { return (_max - _min) / _step + 1; }
    function getValue(index as Number) as Object or Null { return _min + index * _step; }
    // Convertit une valeur réelle en index — l'appelant fournit toujours la valeur réelle,
    // jamais un index calculé à la main
    function indexOf(value as Number) as Number { return (value - _min) / _step; }
    function getDrawable(index as Number, selected as Boolean) as WatchUi.Drawable or Null {
        // Chiffres seuls (pas d'unité) : police purement numérique, pas de risque de
        // glyphe manquant ; réduite au-delà de 4 caractères pour éviter le débordement.
        var text = (_min + index * _step).toString();
        return new WatchUi.Text({
            :text => text,
            :color => Graphics.COLOR_WHITE,
            :font => pickerNumberFont(text),
            :locX => WatchUi.LAYOUT_HALIGN_CENTER,
            :locY => WatchUi.LAYOUT_VALIGN_CENTER
        });
    }
}

// --- v2.4.0 : code Trail Planner à 8 chiffres, saisi sur la montre (affiché sur le site :
// profil › EndurancePro). Une colonne par chiffre ; 00000000 efface le code (plus de synchro).
// Le code long (32 caractères) reste saisissable dans les paramètres téléphone. ---
class DigitPickerFactory extends WatchUi.PickerFactory {
    function initialize() { PickerFactory.initialize(); }
    function getSize() as Number { return 10; }
    function getValue(index as Number) as Object or Null { return index; }
    function getDrawable(index as Number, selected as Boolean) as WatchUi.Drawable or Null {
        // Police texte (plus étroite que FONT_NUMBER_*) : 8 colonnes tiennent sur les petits écrans.
        return new WatchUi.Text({
            :text => index.toString(),
            :color => Graphics.COLOR_WHITE,
            :font => Graphics.FONT_MEDIUM,
            :locX => WatchUi.LAYOUT_HALIGN_CENTER,
            :locY => WatchUi.LAYOUT_VALIGN_CENTER
        });
    }
}

function pushTrailCodePicker() as Void {
    var cur = Properties.getValue("trail_code_prop");
    var code = (cur instanceof String && (cur as String).length() == 8) ? cur as String : "00000000";
    var pattern = [] as Array<WatchUi.PickerFactory>;
    var defaults = [] as Array<Number>;
    for (var i = 0; i < 8; i++) {
        var d = (code.substring(i, i + 1) as String).toNumber();
        pattern.add(new DigitPickerFactory());
        defaults.add((d != null && d >= 0 && d <= 9) ? d as Number : 0);
    }
    var picker = new WatchUi.Picker({
        :title => pickerTitle(WatchUi.loadResource(Rez.Strings.set_trail_code) as String),
        :pattern => pattern,
        :defaults => defaults
    });
    WatchUi.pushView(picker, new TrailCodePickerDelegate(), WatchUi.SLIDE_LEFT);
}

class TrailCodePickerDelegate extends WatchUi.PickerDelegate {
    function initialize() { PickerDelegate.initialize(); }
    function onAccept(values as Array) as Boolean {
        var code = "";
        for (var i = 0; i < values.size(); i++) { code += (values[i] as Number).toString(); }
        Properties.setValue("trail_code_prop", code.equals("00000000") ? "" : code);
        Application.Storage.deleteValue("ep_err");
        getRun().settingsChanged();   // plan et réglages du nouveau code téléchargés tout de suite
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
    function onCancel() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

// --- Picker allure : valeur interne en secondes/km, affichage mm:ss, pas configurable
// (ex: pas de 5s) — la Property stockée reste en secondes, seul l'affichage change ---
function paceLabel(sec as Number) as String {
    return (sec / 60).toString() + ":" + (sec % 60).format("%02d");
}

class PaceRangePickerFactory extends WatchUi.PickerFactory {
    private var _min as Number;
    private var _max as Number;
    private var _step as Number;
    function initialize(min as Number, max as Number, step as Number) {
        PickerFactory.initialize();
        _min = min;
        _max = max;
        _step = step;
    }
    function getSize() as Number { return (_max - _min) / _step + 1; }
    function getValue(index as Number) as Object or Null { return _min + index * _step; }
    function indexOf(value as Number) as Number { return (value - _min) / _step; }
    function getDrawable(index as Number, selected as Boolean) as WatchUi.Drawable or Null {
        var text = paceLabel(_min + index * _step);
        return new WatchUi.Text({
            :text => text,
            :color => Graphics.COLOR_WHITE,
            :font => pickerNumberFont(text),
            :locX => WatchUi.LAYOUT_HALIGN_CENTER,
            :locY => WatchUi.LAYOUT_VALIGN_CENTER
        });
    }
}

class PropertyRangePickerDelegate extends WatchUi.PickerDelegate {
    private var _propKey as String;
    private var _isPercent as Boolean; // true → écrit "NN%" (string), false → écrit le Number brut
    function initialize(propKey as String, isPercent as Boolean) {
        PickerDelegate.initialize();
        _propKey = propKey;
        _isPercent = isPercent;
    }
    function onAccept(values as Array) as Boolean {
        var v = values[0] as Number;
        Properties.setValue(_propKey, _isPercent ? (v.toString() + "%") : v);
        getApp().refreshViewSettings();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
    function onCancel() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

// --- Générique : 2 cases à cocher combinées en bitmask littéral (A=1, B=2, les deux=3) ---
// Le sous-menu garde les 2 cases affichées après une bascule (pas de popView), pour permettre
// de cocher/décocher plusieurs cases avant de revenir en arrière
class BiFlagDelegate extends WatchUi.Menu2InputDelegate {
    private var _propKey as String;
    private var _idA as Symbol;
    private var _idB as Symbol;
    private var _a as Boolean;
    private var _b as Boolean;
    function initialize(propKey as String, idA as Symbol, idB as Symbol, initA as Boolean, initB as Boolean) {
        Menu2InputDelegate.initialize();
        _propKey = propKey; _idA = idA; _idB = idB; _a = initA; _b = initB;
    }
    function onSelect(item as WatchUi.MenuItem) as Void {
        var t = item as WatchUi.ToggleMenuItem;
        var id = item.getId();
        if (id == _idA) { _a = t.isEnabled(); }
        else if (id == _idB) { _b = t.isEnabled(); }
        Properties.setValue(_propKey, (_a ? 1 : 0) + (_b ? 2 : 0));
        getApp().refreshViewSettings();
    }
}

// --- Générique : 3 cases à cocher combinées selon l'énumération déjà utilisée par
// alarm/hr_display_mode_prop : 0=aucune, 1/2/3=A/B/C seule, 4/5/6=AB/AC/BC, 7=toutes ---
function combine3(a as Boolean, b as Boolean, c as Boolean) as Number {
    if (a && b && c) { return 7; }
    if (b && c) { return 6; }
    if (a && c) { return 5; }
    if (a && b) { return 4; }
    if (c) { return 3; }
    if (b) { return 2; }
    if (a) { return 1; }
    return 0;
}

function flagsOf3(value as Number) as Array {
    if (value == 1) { return [true, false, false]; }
    if (value == 2) { return [false, true, false]; }
    if (value == 3) { return [false, false, true]; }
    if (value == 4) { return [true, true, false]; }
    if (value == 5) { return [true, false, true]; }
    if (value == 6) { return [false, true, true]; }
    if (value == 7) { return [true, true, true]; }
    return [false, false, false];
}

class TriFlagDelegate extends WatchUi.Menu2InputDelegate {
    private var _propKey as String;
    private var _idA as Symbol;
    private var _idB as Symbol;
    private var _idC as Symbol;
    private var _a as Boolean;
    private var _b as Boolean;
    private var _c as Boolean;
    function initialize(propKey as String, idA as Symbol, idB as Symbol, idC as Symbol, initA as Boolean, initB as Boolean, initC as Boolean) {
        Menu2InputDelegate.initialize();
        _propKey = propKey; _idA = idA; _idB = idB; _idC = idC;
        _a = initA; _b = initB; _c = initC;
    }
    function onSelect(item as WatchUi.MenuItem) as Void {
        var t = item as WatchUi.ToggleMenuItem;
        var id = item.getId();
        if (id == _idA) { _a = t.isEnabled(); }
        else if (id == _idB) { _b = t.isEnabled(); }
        else if (id == _idC) { _c = t.isEnabled(); }
        Properties.setValue(_propKey, combine3(_a, _b, _c));
        getApp().refreshViewSettings();
    }
}

// Ouvre un picker numérique générique pour une Property de type number (jamais de calcul
// d'index côté appelant : on donne min/max/valeur réelle par défaut, indexOf() convertit)
function pushRangePicker(propKey as String, title as String, min as Number, max as Number, step as Number, defaultReal as Number) as Void {
    var factory = new RangePickerFactory(min, max, step);
    var cur = Properties.getValue(propKey);
    var curVal = (cur != null) ? cur as Number : defaultReal;
    var picker = new WatchUi.Picker({
        :title => pickerTitle(title),
        :pattern => [factory],
        :defaults => [factory.indexOf(curVal)]
    });
    WatchUi.pushView(picker, new PropertyRangePickerDelegate(propKey, false), WatchUi.SLIDE_LEFT);
}

// Ouvre le picker d'allure (affichage mm:ss, valeur stockée en secondes/km)
function pushPacePicker(propKey as String, title as String, min as Number, max as Number, step as Number, defaultReal as Number) as Void {
    var factory = new PaceRangePickerFactory(min, max, step);
    var cur = Properties.getValue(propKey);
    var curVal = (cur != null) ? cur as Number : defaultReal;
    var picker = new WatchUi.Picker({
        :title => pickerTitle(title),
        :pattern => [factory],
        :defaults => [factory.indexOf(curVal)]
    });
    WatchUi.pushView(picker, new PropertyRangePickerDelegate(propKey, false), WatchUi.SLIDE_LEFT);
}

// --- Picker vitesse cible (mode km/h) : la Property reste en secondes/km (comme en mode
// allure), seule la saisie/l'affichage se fait en km/h. Unité interne : dixièmes de km/h
// (ex: 125 = 12.5 km/h) pour garder une arithmétique entière sur le pas/l'index. ---
function kmhTenthsToSec(tenths as Number) as Number {
    if (tenths <= 0) { return 0; }
    return (36000.0 / tenths + 0.5).toNumber();
}
function secToKmhTenths(sec as Number) as Number {
    if (sec <= 0) { return 0; }
    return (36000.0 / sec + 0.5).toNumber();
}

class TargetSpeedPickerFactory extends WatchUi.PickerFactory {
    private var _min as Number;
    private var _max as Number;
    private var _step as Number;
    function initialize(min as Number, max as Number, step as Number) {
        PickerFactory.initialize();
        _min = min;
        _max = max;
        _step = step;
    }
    function getSize() as Number { return (_max - _min) / _step + 1; }
    function getValue(index as Number) as Object or Null { return _min + index * _step; }
    function indexOf(value as Number) as Number { return (value - _min) / _step; }
    function getDrawable(index as Number, selected as Boolean) as WatchUi.Drawable or Null {
        var text = ((_min + index * _step) / 10.0).format("%.1f");
        return new WatchUi.Text({
            :text => text,
            :color => Graphics.COLOR_WHITE,
            :font => pickerNumberFont(text),
            :locX => WatchUi.LAYOUT_HALIGN_CENTER,
            :locY => WatchUi.LAYOUT_VALIGN_CENTER
        });
    }
}

class TargetSpeedPickerDelegate extends WatchUi.PickerDelegate {
    private var _propKey as String;
    function initialize(propKey as String) {
        PickerDelegate.initialize();
        _propKey = propKey;
    }
    function onAccept(values as Array) as Boolean {
        var tenths = values[0] as Number;
        Properties.setValue(_propKey, kmhTenthsToSec(tenths));
        getApp().refreshViewSettings();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
    function onCancel() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

// propKey stocke toujours des secondes/km ; min/max/step et defaultReal sont ici exprimés
// en dixièmes de km/h (ex: 60=6.0 km/h, 180=18.0 km/h, pas 5=0.5 km/h)
function pushTargetSpeedPicker(propKey as String, title as String, minTenths as Number, maxTenths as Number, step as Number, defaultTenths as Number) as Void {
    var factory = new TargetSpeedPickerFactory(minTenths, maxTenths, step);
    var cur = Properties.getValue(propKey);
    var curTenths = (cur != null) ? secToKmhTenths(cur as Number) : defaultTenths;
    if (curTenths < minTenths) { curTenths = minTenths; }
    if (curTenths > maxTenths) { curTenths = maxTenths; }
    var picker = new WatchUi.Picker({
        :title => pickerTitle(title),
        :pattern => [factory],
        :defaults => [factory.indexOf(curTenths)]
    });
    WatchUi.pushView(picker, new TargetSpeedPickerDelegate(propKey), WatchUi.SLIDE_LEFT);
}

// --- Helpers pour afficher la valeur actuelle en sous-libellé dans le menu ---
// Cherche le libellé correspondant à la valeur courante dans un tableau d'options
// [label, valeur] — le même tableau que celui donné à PropertyListMenu, pas de duplication
function labelForValue(options as Array, value as Object) as String {
    for (var i = 0; i < options.size(); i++) {
        if (options[i][1] == value) { return options[i][0] as String; }
    }
    return options[0][0] as String;
}

// Jumeau de labelForValue() : retourne l'index au lieu du libellé, pour Menu2.setFocus()
function indexForValue(options as Array, value as Object) as Number {
    for (var i = 0; i < options.size(); i++) {
        if (options[i][1] == value) { return i; }
    }
    return 0;
}

// Appli : rappels nutrition (fuelMin) : selon le plan (-1), désactivés (0) ou toutes les N minutes. Une
// valeur saisie dans Garmin Connect hors de la liste y est ajoutée.
function fuelOptions() as Array {
    var opts = [
        [WatchUi.loadResource(Rez.Strings.tp_fuel_plan) as String, -1],
        [WatchUi.loadResource(Rez.Strings.opt_disabled) as String, 0]
    ] as Array;
    var mins = [15, 20, 30, 45, 60];
    for (var i = 0; i < mins.size(); i++) {
        opts.add([mins[i].toString() + " min", mins[i]]);
    }
    var cur = Properties.getValue("fuelMin");
    if (cur instanceof Number && cur > 0 && indexForValue(opts, cur) == 0) {
        opts.add([(cur as Number).toString() + " min", cur]);
    }
    return opts;
}

function fuelValue() as Number {
    var v = Properties.getValue("fuelMin");
    return (v instanceof Number) ? v as Number : -1;
}

function distToTypeOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_disabled) as String, 0],
        [WatchUi.loadResource(Rez.Strings.opt_next_waypoint) as String, 1],
        [WatchUi.loadResource(Rez.Strings.opt_end_course) as String, 2],
        [WatchUi.loadResource(Rez.Strings.opt_alternating) as String, 3]
    ];
}

// v2.1.2 : Unité allure/vitesse — migrée du téléphone (pace_unit_prop), textes bruts
// comme dans l'ancien settings.xml (unités universelles, pas de traduction nécessaire)
function paceUnitOptions() as Array {
    return [
        ["min/km", 0],
        ["km/h", 1]
    ];
}

function paceModeOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_pace_normal) as String, 0],
        [WatchUi.loadResource(Rez.Strings.opt_pace_standard) as String, 1],
        [WatchUi.loadResource(Rez.Strings.opt_pace_mountain) as String, 2]
    ];
}

// v1.9.48 : 2nd métrique — 2 slots indépendants (metric_slot_a_prop / metric_slot_b_prop),
// chacun choisi dans cette même liste à 4 valeurs (remplace l'ancienne liste à 8 valeurs
// avec rotation figée ; l'alternance est désormais automatique dès que les 2 slots diffèrent)
function metricSlot2Options() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_disabled) as String, 0],
        [WatchUi.loadResource(Rez.Strings.menu_metric_fatigue) as String, 1],
        [WatchUi.loadResource(Rez.Strings.menu_metric_cal) as String, 2],
        [WatchUi.loadResource(Rez.Strings.menu_metric_km) as String, 3],
        [WatchUi.loadResource(Rez.Strings.label_fit_temp_bag_corr) as String, 7],
        [WatchUi.loadResource(Rez.Strings.menu_metric_body_battery) as String, 4]
    ];
}

// v2.4.0 : coeffOptions() (liste 0.5–1.5) retirée — climb/descent grade utilisent
// désormais pushRangePicker() en m/km directement, comme bag_weight_prop.

function batteryDisplayOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_battery) as String, 0],
        ["Body Battery", 1]
    ];
}

function bagWeightModeOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_bag_weight_flat) as String, 0],
        [WatchUi.loadResource(Rez.Strings.opt_bag_weight_relative) as String, 1]
    ];
}

// v2.0.4 : Colorisation VAM — liste à choix unique (remplace les 2 cases à cocher
// Activé/Barre, "vam_zones_enabled_prop" encode déjà directement 0=Off/1=Barre/2=Fond).
// v2.2.4 : ajout du choix "Police" (3) — colore le texte de la valeur au lieu du fond/barre.
function vamColorizeOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_off) as String, 0],
        [WatchUi.loadResource(Rez.Strings.opt_bar) as String, 1],
        [WatchUi.loadResource(Rez.Strings.opt_background) as String, 2],
        [WatchUi.loadResource(Rez.Strings.opt_font) as String, 3]
    ];
}

// v2.2.4 : Colorisation allure/vitesse (instantanée et moyenne, réglages indépendants) —
// même liste à choix unique que vamColorizeOptions() : 0=Off, 1=Barre, 2=Fond, 3=Police.
function paceColorModeOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_off) as String, 0],
        [WatchUi.loadResource(Rez.Strings.opt_bar) as String, 1],
        [WatchUi.loadResource(Rez.Strings.opt_background) as String, 2],
        [WatchUi.loadResource(Rez.Strings.opt_font) as String, 3]
    ];
}

// v2.7.0 : Référence de la cible d'allure — allure brute, zone VC ou % de VC (colorisation
// et alarme identiques dans les trois cas)
function paceRefOptions() as Array {
    return [
        [targetPaceLabel(), 0],
        [WatchUi.loadResource(Rez.Strings.opt_ref_vc) as String, 1],
        [WatchUi.loadResource(Rez.Strings.opt_ref_vc_pct) as String, 2]
    ];
}

// v2.7.0 : Zone VC cible (Z1..Z7)
// v2.7.0 : zone cible commune (allure en référence Zone VC, alarmes FC et VAM) : Z1-Z5, les
// zones que la FC et la VAM ont aussi (Lionel, 15/11/2026).
function vcZoneOptions() as Array {
    var opts = [] as Array;
    for (var k = 1; k <= 5; k++) {
        opts.add(["Z" + k.toString(), k]);
    }
    return opts;
}

// v2.4.0 : État de la synchronisation Trail Planner pour le sous-libellé du menu
// ("Synchro 14:05", "En attente", "Pas de code", ou le code d'erreur réseau)
function trailSyncSubLabel() as String {
    if (!trailCodeSet()) { return WatchUi.loadResource(Rez.Strings.opt_no_code) as String; }
    var t = Application.Storage.getValue("ep_time");
    var err = Application.Storage.getValue("ep_err");
    if (t instanceof Number) {
        var info = Gregorian.info(new Time.Moment(t as Number), Time.FORMAT_SHORT);
        var label = (WatchUi.loadResource(Rez.Strings.opt_synced) as String) + " " + info.hour.format("%02d") + ":" + info.min.format("%02d");
        return (err instanceof Number) ? label + " (" + (err as Number).toString() + ")" : label;
    }
    if (err instanceof Number) { return (WatchUi.loadResource(Rez.Strings.opt_waiting) as String) + " (" + (err as Number).toString() + ")"; }
    return WatchUi.loadResource(Rez.Strings.opt_waiting) as String;
}

// v2.0.4 : true si l'unité d'allure choisie (téléphone) est km/h plutôt que min/km —
// centralise le test réutilisé par tous les libellés "allure"/"vitesse" dynamiques ci-dessous
function isKmhMode() as Boolean {
    var pu = Properties.getValue("pace_unit_prop");
    return (pu != null) && (pu.toNumber() == 1);
}

// v2.0.4 : Libellé dynamique "Colorisation allure"/"Colorisation vitesse" selon pace_unit_prop
function colorizePaceLabel() as String {
    return WatchUi.loadResource(isKmhMode() ? Rez.Strings.set_colorize_speed : Rez.Strings.set_colorize_pace) as String;
}

// v2.0.4 : Libellé dynamique "Allure cible"/"Vitesse cible" selon pace_unit_prop
function targetPaceLabel() as String {
    return WatchUi.loadResource(isKmhMode() ? Rez.Strings.set_target_speed : Rez.Strings.set_target_pace) as String;
}

// v2.0.5 : Libellé dynamique "Allure"/"Vitesse" pour le dossier de réglages
function paceFolderLabel() as String {
    return WatchUi.loadResource(isKmhMode() ? Rez.Strings.menu_speed_folder : Rez.Strings.menu_pace_folder) as String;
}

// v2.0.5 : Libellé dynamique "Mode allure"/"Mode vitesse"
function paceModeLabel() as String {
    return WatchUi.loadResource(isKmhMode() ? Rez.Strings.set_speed_mode : Rez.Strings.set_pace_mode) as String;
}

// v2.0.5 : Libellé dynamique "Allure"/"Vitesse" pour la case à cocher d'alarme
function alarmPaceLabel() as String {
    return WatchUi.loadResource(isKmhMode() ? Rez.Strings.opt_alarm_speed : Rez.Strings.opt_alarm_pace) as String;
}

// Sous-libellé "10:00 /km" (mode allure) ou "12.5 km/h" (mode vitesse) — la Property reste
// toujours en secondes/km, seul l'affichage change selon pace_unit_prop
function targetPaceSubLabel(sec as Number) as String {
    if (isKmhMode()) {
        if (sec <= 0) { return "--.- km/h"; }
        return (3600.0 / sec).format("%.1f") + " km/h";
    }
    return paceLabel(sec) + " /km";
}

// Résumé "A+B"/"A"/"B"/Désactivé pour un réglage à 2 cases à cocher
function summary2(a as Boolean, labelA as String, b as Boolean, labelB as String) as String {
    if (a && b) { return labelA + "+" + labelB; }
    if (a) { return labelA; }
    if (b) { return labelB; }
    return WatchUi.loadResource(Rez.Strings.opt_disabled) as String;
}

// Résumé pour un réglage à 3 cases à cocher (join des cases actives par "+")
function summary3(a as Boolean, labelA as String, b as Boolean, labelB as String, c as Boolean, labelC as String) as String {
    var parts = [] as Array<String>;
    if (a) { parts.add(labelA); }
    if (b) { parts.add(labelB); }
    if (c) { parts.add(labelC); }
    if (parts.size() == 0) { return WatchUi.loadResource(Rez.Strings.opt_disabled) as String; }
    var s = parts[0];
    for (var i = 1; i < parts.size(); i++) { s = s + "+" + parts[i]; }
    return s;
}

// --- Sous-menus à cases à cocher (combinaisons de flags indépendants) ---
class AlarmModeMenu extends WatchUi.Menu2 {
    function initialize(flags as Array) {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_alarm) as String});
        addItem(new WatchUi.ToggleMenuItem("VAM", null, :fA, flags[0] as Boolean, {}));
        addItem(new WatchUi.ToggleMenuItem(alarmPaceLabel(), null, :fB, flags[1] as Boolean, {}));
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.opt_alarm_hr) as String, null, :fC, flags[2] as Boolean, {}));
    }
}

class HrDisplayMenu extends WatchUi.Menu2 {
    function initialize(flags as Array) {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_zone_fc) as String});
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.opt_hr_value) as String, null, :fA, flags[0] as Boolean, {}));
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.opt_hr_circle) as String, null, :fB, flags[1] as Boolean, {}));
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.opt_bar) as String, null, :fC, flags[2] as Boolean, {}));
    }
}

class AlarmTypeMenu extends WatchUi.Menu2 {
    function initialize(a as Boolean, b as Boolean) {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.set_alarm_type) as String});
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.opt_vib) as String, null, :fA, a, {}));
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.opt_sound) as String, null, :fB, b, {}));
    }
}

// --- Mode affichage VAM : énumération différente (0=VAM seule, pas de "aucune"),
// donc combine/décompose dédiés plutôt que combine3()/flagsOf3() ---
function combineVamMode(vam as Boolean, grade as Boolean, lap as Boolean) as Number {
    if (vam && grade && lap) { return 6; }
    if (grade && lap) { return 5; }
    if (vam && lap) { return 4; }
    if (vam && grade) { return 3; }
    if (lap) { return 2; }
    if (grade) { return 1; }
    return 0; // VAM seule — aussi le repli si aucune case n'est cochée (comme l'ancien "VAM seule" par défaut)
}

function flagsOfVamMode(value as Number) as Array {
    if (value == 1) { return [false, true, false]; }
    if (value == 2) { return [false, false, true]; }
    if (value == 3) { return [true, true, false]; }
    if (value == 4) { return [true, false, true]; }
    if (value == 5) { return [false, true, true]; }
    if (value == 6) { return [true, true, true]; }
    return [true, false, false]; // 0
}

// v2.1.2 : la case "Circuit" (affichage de la moyenne VAM du circuit dans la rotation)
// redevient éditable ici, indépendamment du toggle global "Circuit" (cur_lap_pace_prop,
// menu principal) qui active/désactive le suivi de circuit dans son ensemble. Le réglage
// est stocké séparément (vam_circuit_display_prop) et n'a d'effet que si le suivi de
// circuit est actif ; sinon l'item est visuellement "grisé" (sous-titre + case forcée à
// OFF au clic) — Menu2/ToggleMenuItem n'a pas de vrai setEnabled() désactivant l'item.
function vamCircuitDisplayPref() as Boolean {
    var v = Properties.getValue("vam_circuit_display_prop");
    return (v == null) ? true : (v as Boolean);
}

class VamModeMenu extends WatchUi.Menu2 {
    private var _circuitItem as WatchUi.ToggleMenuItem;
    function initialize(flags as Array) {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_vam_mode_short) as String});
        addItem(new WatchUi.ToggleMenuItem("VAM", null, :fA, flags[0] as Boolean, {}));
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.opt_grade_only) as String, null, :fB, flags[1] as Boolean, {}));
        var circuitActive = Properties.getValue("cur_lap_pace_prop") == true;
        _circuitItem = new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_vam_circuit) as String, null, :vamCircuit,
            circuitActive && vamCircuitDisplayPref(), {});
        addItem(_circuitItem);
        if (!circuitActive) {
            _circuitItem.setSubLabel(WatchUi.loadResource(Rez.Strings.menu_vam_circuit_off) as String);
        }
    }
}

class VamModeDelegate extends WatchUi.Menu2InputDelegate {
    private var _a as Boolean;
    private var _b as Boolean;
    function initialize(initA as Boolean, initB as Boolean) {
        Menu2InputDelegate.initialize();
        _a = initA; _b = initB;
    }
    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :fA) { _a = (item as WatchUi.ToggleMenuItem).isEnabled(); }
        else if (id == :fB) { _b = (item as WatchUi.ToggleMenuItem).isEnabled(); }
        else if (id == :vamCircuit) {
            var t = item as WatchUi.ToggleMenuItem;
            var circuitActive = Properties.getValue("cur_lap_pace_prop") == true;
            if (!circuitActive) {
                // "Grisé" : le suivi de circuit est désactivé globalement, on ignore le tap
                // et on force la case à OFF (cohérent avec l'affichage effectif).
                t.setEnabled(false);
                return;
            }
            Properties.setValue("vam_circuit_display_prop", t.isEnabled());
        }
        var circuit = Properties.getValue("cur_lap_pace_prop") == true;
        Properties.setValue("vam_display_mode_prop", combineVamMode(_a, _b, circuit && vamCircuitDisplayPref()));
        getApp().refreshViewSettings();
    }
}

// --- Sous-dossiers thématiques (Allure / VAM / FC / Alarmes / Coefficients) ---
// Réutilisent EnduranceProSettingsDelegate comme délégué : les ids qu'ils exposent
// (:vamMode, :hrMode, :alarm, :climbCoeff, etc.) sont déjà gérés par ses branches.
class AllureSettingsMenu extends WatchUi.Menu2 {
    private var _paceModeItem as WatchUi.MenuItem;
    private var _targetPaceItem as WatchUi.MenuItem;
    private var _paceFastThresholdItem as WatchUi.MenuItem;
    // v2.4.0 : Zones VC
    private var _paceRefItem as WatchUi.MenuItem;
    private var _csPaceItem as WatchUi.MenuItem;
    private var _vcTargetZoneItem as WatchUi.MenuItem;
    private var _vcTargetPctItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => paceFolderLabel()});
        _paceModeItem = new WatchUi.MenuItem(paceModeLabel(), null, :paceMode, {});
        addItem(_paceModeItem);
        _paceRefItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_pace_ref) as String, null, :paceRef, {});
        addItem(_paceRefItem);
        _targetPaceItem = new WatchUi.MenuItem(targetPaceLabel(), null, :targetPace, {});
        addItem(_targetPaceItem);
        _paceFastThresholdItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_pace_fast_threshold) as String, null, :paceFastThreshold, {});
        addItem(_paceFastThresholdItem);
        _csPaceItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_cs) as String, null, :csPace, {});
        addItem(_csPaceItem);
        _vcTargetZoneItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vc_target_zone) as String, null, :vcTargetZone, {});
        addItem(_vcTargetZoneItem);
        _vcTargetPctItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vc_target_pct) as String, null, :vcTargetPct, {});
        addItem(_vcTargetPctItem);
        // Appli : code Trail Planner déplacé dans Propriétés (avec le rechargement du plan).
        onShow();
    }

    function onShow() as Void {
        var pm = Properties.getValue("pace_mode_prop");
        _paceModeItem.setLabel(paceModeLabel());
        _paceModeItem.setSubLabel(labelForValue(paceModeOptions(), (pm != null) ? pm as Number : 0));

        _targetPaceItem.setLabel(targetPaceLabel());
        var tp = Properties.getValue("target_pace_prop");
        _targetPaceItem.setSubLabel(targetPaceSubLabel((tp != null) ? tp as Number : 330));

        var pft = Properties.getValue("pace_fast_threshold_prop");
        _paceFastThresholdItem.setSubLabel(((pft != null) ? pft.toString() : "10") + "%");

        var pr = Properties.getValue("pace_ref_prop");
        _paceRefItem.setSubLabel(labelForValue(paceRefOptions(), (pr != null) ? pr as Number : 0));
        var cs = Properties.getValue("cs_pace_prop");
        _csPaceItem.setSubLabel(targetPaceSubLabel((cs != null) ? cs as Number : 300));
        var tz = Properties.getValue("vc_target_zone_prop");
        _vcTargetZoneItem.setSubLabel(labelForValue(vcZoneOptions(), (tz != null) ? tz as Number : 2));
        var tpc = Properties.getValue("vc_target_pct_prop");
        _vcTargetPctItem.setSubLabel(((tpc != null) ? tpc.toString() : "80") + "%");
    }
}

class VamSettingsMenu extends WatchUi.Menu2 {
    private var _vamZone1MinItem as WatchUi.MenuItem;
    private var _vamZone1MaxItem as WatchUi.MenuItem;
    private var _vamZone2MaxItem as WatchUi.MenuItem;
    private var _vamZone3MaxItem as WatchUi.MenuItem;
    private var _vamZone4MaxItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_vam_folder) as String});
        _vamZone1MinItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vam_zone1_min) as String, null, :vamZone1Min, {});
        addItem(_vamZone1MinItem);
        _vamZone1MaxItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vam_zone1_max) as String, null, :vamZone1Max, {});
        addItem(_vamZone1MaxItem);
        _vamZone2MaxItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vam_zone2_max) as String, null, :vamZone2Max, {});
        addItem(_vamZone2MaxItem);
        _vamZone3MaxItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vam_zone3_max) as String, null, :vamZone3Max, {});
        addItem(_vamZone3MaxItem);
        _vamZone4MaxItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vam_zone4_max) as String, null, :vamZone4Max, {});
        addItem(_vamZone4MaxItem);
        onShow();
    }

    function onShow() as Void {
        var z1min = Properties.getValue("vam_zone1_min");
        _vamZone1MinItem.setSubLabel(((z1min != null) ? z1min.toString() : "300") + " m/h");
        var z1max = Properties.getValue("vam_zone1_max");
        _vamZone1MaxItem.setSubLabel(((z1max != null) ? z1max.toString() : "600") + " m/h");
        var z2max = Properties.getValue("vam_zone2_max");
        _vamZone2MaxItem.setSubLabel(((z2max != null) ? z2max.toString() : "800") + " m/h");
        var z3max = Properties.getValue("vam_zone3_max");
        _vamZone3MaxItem.setSubLabel(((z3max != null) ? z3max.toString() : "1000") + " m/h");
        var z4max = Properties.getValue("vam_zone4_max");
        _vamZone4MaxItem.setSubLabel(((z4max != null) ? z4max.toString() : "1200") + " m/h");
    }
}

// v1.9.48 : dossier FC supprimé — "Affichage zone FC" déplacé dans le menu principal
// (sous "Circuit"), "Seuil Zone FC" déplacé dans le dossier Alarmes ci-dessous
// v2.2.11 : Durée de l'alarme visuelle — 0=OFF (coupe aussi vibration+son, voir alarmEnabled
// dans EnduranceProView), 3/5/10=secondes. Sert aussi de durée d'affichage au popup dessiné
// par l'app quand alarm_display_type_prop=0 (Popup).
function alarmPopupOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_off) as String, 0],
        ["3s", 3], ["5s", 5], ["10s", 10]
    ];
}

// v2.2.11 : Popup (dessiné par l'app, durée garantie) vs Notification (WatchUi.showToast,
// natif montre — sur certains modèles ne respecte pas la durée système, voir notes)
function alarmDisplayTypeOptions() as Array {
    return [
        [WatchUi.loadResource(Rez.Strings.opt_popup) as String, 0],
        [WatchUi.loadResource(Rez.Strings.opt_notification) as String, 1]
    ];
}

class AlarmSettingsMenu extends WatchUi.Menu2 {
    private var _alarmPopupDurationItem as WatchUi.MenuItem;
    private var _alarmDisplayTypeItem as WatchUi.MenuItem;
    private var _alarmItem as WatchUi.MenuItem;
    private var _vamAlarmTypeItem as WatchUi.MenuItem;
    private var _targetZoneItem as WatchUi.MenuItem;
    private var _fuelItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_alarm_folder) as String});
        _alarmPopupDurationItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_alarm_popup) as String, null, :alarmPopupDuration, {});
        addItem(_alarmPopupDurationItem);
        _alarmDisplayTypeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_alarm_display_type) as String, null, :alarmDisplayType, {});
        addItem(_alarmDisplayTypeItem);
        _alarmItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_alarm) as String, null, :alarm, {});
        addItem(_alarmItem);
        _vamAlarmTypeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_alarm_type) as String, null, :vamAlarmType, {});
        addItem(_vamAlarmTypeItem);
        // v2.7.0 : une seule zone cible (Z1-Z5) pour les alarmes allure (référence Zone VC), FC et
        // VAM : remplace « Seuil VAM alarme » et « Seuil FC ». Même réglage que dans le dossier Allure.
        _targetZoneItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_vc_target_zone) as String, null, :vcTargetZone, {});
        addItem(_targetZoneItem);
        // Appli : rappels nutrition (popup) et vibrations des rappels et alertes Trail Planner.
        _fuelItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.tp_fuel) as String, null, :fuelMin, {});
        addItem(_fuelItem);
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.tp_vibrate) as String, null, :tpVibrate,
            Properties.getValue("vibrate") != false, {}));
        onShow();
    }

    function onShow() as Void {
        _fuelItem.setSubLabel(labelForValue(fuelOptions(), fuelValue()));
        var apd = Properties.getValue("alarm_popup_duration_prop");
        _alarmPopupDurationItem.setSubLabel(labelForValue(alarmPopupOptions(), (apd != null) ? apd as Number : 5));

        var adt = Properties.getValue("alarm_display_type_prop");
        _alarmDisplayTypeItem.setSubLabel(labelForValue(alarmDisplayTypeOptions(), (adt != null) ? adt as Number : 0));

        var al = Properties.getValue("alarm");
        var alFlags = flagsOf3((al != null) ? al as Number : 0);
        _alarmItem.setSubLabel(summary3(alFlags[0] as Boolean, "VAM",
                                         alFlags[1] as Boolean, alarmPaceLabel(),
                                         alFlags[2] as Boolean, WatchUi.loadResource(Rez.Strings.opt_alarm_hr) as String));

        var vat = Properties.getValue("vam_alarm_type_prop");
        var vatVal = (vat != null) ? vat as Number : 3;
        _vamAlarmTypeItem.setSubLabel(summary2((vatVal & 1) != 0, WatchUi.loadResource(Rez.Strings.opt_vib) as String,
                                                (vatVal & 2) != 0, WatchUi.loadResource(Rez.Strings.opt_sound) as String));

        var tz = Properties.getValue("vc_target_zone_prop");
        _targetZoneItem.setSubLabel(labelForValue(vcZoneOptions(), (tz != null) ? tz as Number : 2));
    }
}

class CoeffSettingsMenu extends WatchUi.Menu2 {
    private var _climbCoeffItem as WatchUi.MenuItem;
    private var _descentCoeffItem as WatchUi.MenuItem;
    private var _bagWeightModeItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_coeff_folder) as String});
        var tempEnabled = Properties.getValue("temp_enabled_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_temp_corr) as String, null, :tempEnabled, tempEnabled == true, {}));
        var solarEnabled = Properties.getValue("solar_enabled_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_solar_corr) as String, null, :solarEnabled, solarEnabled == true, {}));
        _climbCoeffItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_climb_coeff) as String, null, :climbCoeff, {});
        addItem(_climbCoeffItem);
        _descentCoeffItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_descent_coeff) as String, null, :descentCoeff, {});
        addItem(_descentCoeffItem);
        _bagWeightModeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_bag_weight_mode) as String, null, :bagWeightMode, {});
        addItem(_bagWeightModeItem);
        onShow();
    }

    function onShow() as Void {
        var cc = Properties.getValue("climb_grade_mkm_prop");
        _climbCoeffItem.setSubLabel(((cc != null) ? cc.toString() : "100") + " m/km");
        var dc = Properties.getValue("descent_grade_mkm_prop");
        _descentCoeffItem.setSubLabel(((dc != null) ? dc.toString() : "330") + " m/km");
        var bm = Properties.getValue("bag_weight_mode_prop");
        _bagWeightModeItem.setSubLabel(labelForValue(bagWeightModeOptions(), (bm != null) ? bm as Number : 0));
    }
}

// --- Sous-dossier "Propriétés" : unité de vitesse et lissage, migrés du téléphone
// (settings.xml) — ne restent gérés depuis le téléphone que l'enregistrement FIT ---
class ProprietesSettingsMenu extends WatchUi.Menu2 {
    private var _paceUnitItem as WatchUi.MenuItem;
    private var _bufferSizeItem as WatchUi.MenuItem;
    private var _codeItem as WatchUi.MenuItem;
    private var _planItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_properties_folder) as String});
        _paceUnitItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_pace_unit) as String, null, :paceUnit, {});
        addItem(_paceUnitItem);
        _bufferSizeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_buffer_size) as String, null, :bufferSize, {});
        addItem(_bufferSizeItem);
        // Appli : code Trail Planner (état de la synchro en sous-titre ; appui = saisie du code à 8
        // chiffres) et rechargement du plan (nom de la course en sous-titre).
        _codeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_trail_code) as String, null, :trailSync, {});
        addItem(_codeItem);
        _planItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.tp_reload) as String, null, :reload, {});
        addItem(_planItem);
        onShow();
    }

    function onShow() as Void {
        _codeItem.setSubLabel(trailSyncSubLabel());
        var run = getRun();
        _planItem.setSubLabel(run.plan != null ? run.plan.name : run.status);
        var pu = Properties.getValue("pace_unit_prop");
        var puVal = (pu != null) ? pu as Number : 0;
        _paceUnitItem.setSubLabel(labelForValue(paceUnitOptions(), puVal));

        var bs = Properties.getValue("buffer_size_prop");
        _bufferSizeItem.setSubLabel(((bs != null) ? bs.toString() : "20") + " s");
    }
}

// --- Sous-dossier "Affichage" (réservé pour de futurs réglages d'affichage) ---
class AffichageSettingsMenu extends WatchUi.Menu2 {
    private var _vamModeItem as WatchUi.MenuItem;
    private var _distToTypeItem as WatchUi.MenuItem;
    private var _batteryModeItem as WatchUi.MenuItem;
    private var _zoomItem as WatchUi.MenuItem;
    private var _mapScaleItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_display_folder) as String});
        var darkMode = Properties.getValue("dark_mode_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_dark_mode) as String, null, :darkMode, darkMode == true, {}));
        _vamModeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_vam_mode_short) as String, null, :vamMode, {});
        addItem(_vamModeItem);
        _distToTypeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.set_dist_to_type) as String, null, :distToType, {});
        addItem(_distToTypeItem);
        _batteryModeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_battery_mode) as String, null, :batteryDisplay, {});
        addItem(_batteryModeItem);
        var clockMetricEnabled = Properties.getValue("clock_metric_enabled_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_clock_metric_folder) as String, null, :clockMetricEnabled, clockMetricEnabled == true, {}));
        var showClock = Properties.getValue("show_clock_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_show_clock) as String, null, :showClock, showClock == true, {}));
        // Appli : écran Profil, écran Carte.
        _zoomItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.tp_zoom) as String, null, :tpZoom, {});
        addItem(_zoomItem);
        _mapScaleItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.tp_map_scale) as String, null, :mapScale, {});
        addItem(_mapScaleItem);
        onShow();
    }

    function onShow() as Void {
        var vm = Properties.getValue("vam_display_mode_prop");
        var vmFlags = flagsOfVamMode((vm != null) ? vm as Number : 6);
        _vamModeItem.setSubLabel(summary3(vmFlags[0] as Boolean, "VAM",
                                           vmFlags[1] as Boolean, WatchUi.loadResource(Rez.Strings.opt_grade_only) as String,
                                           vmFlags[2] as Boolean, WatchUi.loadResource(Rez.Strings.opt_lap_avg_only) as String));

        var dt = Properties.getValue("dist_to_type_prop");
        _distToTypeItem.setSubLabel(labelForValue(distToTypeOptions(), (dt != null) ? dt as Number : 0));

        var bd = Properties.getValue("battery_display_prop");
        _batteryModeItem.setSubLabel(labelForValue(batteryDisplayOptions(), (bd != null) ? bd as Number : 0));
        _zoomItem.setSubLabel(zoomLabel(zoomLevel()));
        _mapScaleItem.setSubLabel(mapScaleLabel(mapScaleLevel()));
    }
}

// --- Sous-dossier "Colorisation" : regroupe tous les réglages de colorisation par zone
// (FC, VAM, allure/vitesse instantanée et moyenne) ---
class ColorisationSettingsMenu extends WatchUi.Menu2 {
    private var _zoneFcItem as WatchUi.MenuItem;
    private var _vamColorizeItem as WatchUi.MenuItem;
    private var _colorizePaceInstItem as WatchUi.MenuItem;
    private var _colorizePaceAvgItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_colorize_folder) as String});
        _zoneFcItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_zone_fc) as String, null, :hrMode, {});
        addItem(_zoneFcItem);
        _vamColorizeItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_vam_colorize) as String, null, :vamColorize, {});
        addItem(_vamColorizeItem);
        _colorizePaceInstItem = new WatchUi.MenuItem(colorizePaceLabel() + " (inst.)", null, :colorizePaceInst, {});
        addItem(_colorizePaceInstItem);
        _colorizePaceAvgItem = new WatchUi.MenuItem(colorizePaceLabel() + " (moy.)", null, :colorizePaceAvg, {});
        addItem(_colorizePaceAvgItem);
        var cdd = Properties.getValue("colorize_dplus_dmoins_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_colorize_dplus_dmoins) as String, null, :colorizeDPlusDMoins, cdd == true, {}));
        // Appli : profil coloré selon la pente.
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.tp_slopes) as String,
            WatchUi.loadResource(Rez.Strings.tp_slopes_sub) as String, :slopes, slopesOn(), {}));
        onShow();
    }

    function onShow() as Void {
        var hm = Properties.getValue("hr_display_mode_prop");
        var hmFlags = flagsOf3((hm != null) ? hm as Number : 7);
        _zoneFcItem.setSubLabel(summary3(hmFlags[0] as Boolean, WatchUi.loadResource(Rez.Strings.opt_hr_value) as String,
                                          hmFlags[1] as Boolean, WatchUi.loadResource(Rez.Strings.opt_hr_circle) as String,
                                          hmFlags[2] as Boolean, WatchUi.loadResource(Rez.Strings.opt_bar) as String));

        var vz = Properties.getValue("vam_zones_enabled_prop");
        var vzVal = (vz != null) ? vz as Number : 2;
        _vamColorizeItem.setSubLabel(labelForValue(vamColorizeOptions(), vzVal));

        _colorizePaceInstItem.setLabel(colorizePaceLabel() + " (inst.)");
        var cpi = Properties.getValue("colorize_pace_inst_prop");
        _colorizePaceInstItem.setSubLabel(labelForValue(paceColorModeOptions(), (cpi != null) ? cpi as Number : 2));

        _colorizePaceAvgItem.setLabel(colorizePaceLabel() + " (moy.)");
        var cpa = Properties.getValue("colorize_pace_avg_prop");
        _colorizePaceAvgItem.setSubLabel(labelForValue(paceColorModeOptions(), (cpa != null) ? cpa as Number : 3));
    }
}

// --- v2.2.8 : Sous-dossier "Circuit" — coupe-circuit général + toggle par donnée ---
class CircuitSettingsMenu extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_circuit_folder) as String});
        var master = Properties.getValue("cur_lap_pace_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.set_cur_lap_pace) as String, null, :curLapPace, master == true, {}));
        var cdd = Properties.getValue("circuit_dplus_dmoins_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_circuit_dplus_dmoins) as String, null, :circuitDPlusDMoins, cdd == true, {}));
        var ca = Properties.getValue("circuit_allure_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_circuit_allure) as String, null, :circuitAllure, ca == true, {}));
        var cdi = Properties.getValue("circuit_distance_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_circuit_distance) as String, null, :circuitDistance, cdi == true, {}));
        var cc = Properties.getValue("circuit_chrono_prop");
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.menu_circuit_chrono) as String, null, :circuitChrono, cc == true, {}));
        // Appli : le bouton Lap valide le passage au point le plus proche (2e tour au ravito = départ).
        addItem(new WatchUi.ToggleMenuItem(WatchUi.loadResource(Rez.Strings.tp_lap_pass) as String, null, :lapPass,
            Properties.getValue("lapPass") != false, {}));
    }
}

// --- Sous-dossier "2nd métrique" (2 slots indépendants) ---
class MetricSlotFolderMenu extends WatchUi.Menu2 {
    private var _slot1Item as WatchUi.MenuItem;
    private var _slot2Item as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_metric_slot) as String});
        _slot1Item = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_metric_slot1) as String, null, :metricSlotA, {});
        addItem(_slot1Item);
        _slot2Item = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_metric_slot2) as String, null, :metricSlotB, {});
        addItem(_slot2Item);
        onShow();
    }

    function onShow() as Void {
        var a = Properties.getValue("metric_slot_a_prop");
        _slot1Item.setSubLabel(labelForValue(metricSlot2Options(), (a != null) ? a as Number : 0));
        var b = Properties.getValue("metric_slot_b_prop");
        _slot2Item.setSubLabel(labelForValue(metricSlot2Options(), (b != null) ? b as Number : 0));
    }
}

// --- Menu principal des réglages on-watch (getSettingsView()) ---
// Ordre : paramètres les plus souvent modifiés en premier (poids du sac, dossier
// Affichage), puis le reste — VAM/Alarmes/Coefficients/Affichage regroupés en sous-dossiers.
// v2.0.4 : Mode sombre, Police agrandie, Zone FC, Mode VAM, Colorisation VAM,
// Colorisation allure/vitesse, Distance restante et Mode batterie déplacés dans le
// dossier Affichage (juste après le poids du sac). Correction temp. déplacée dans le
// dossier Coefficients.
class EnduranceProSettingsMenu extends WatchUi.Menu2 {
    // Références gardées pour rafraîchir les sous-libellés au retour au premier plan (onShow)
    private var _bagWeightItem as WatchUi.MenuItem;

    function initialize() {
        Menu2.initialize({:title => WatchUi.loadResource(Rez.Strings.menu_settings_title) as String});

        // Appli : « Explorer la carte » en tête, seulement avec une carte à l'écran sous le menu (écrans de
        // course ou fiche d'un parcours ; depuis la liste, la carte remplacerait la liste).
        if (getApp().canExplore()) {
            addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.tp_explore) as String, null, :explore, {}));
        }

        // v1.9.49 : Numéro de version en tout premier — purement informatif (pas de
        // branche dans le délégué : la sélection ne fait rien)
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_version_label) as String,
            WatchUi.loadResource(Rez.Strings.app_version) as String, :versionInfo, {}));

        _bagWeightItem = new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_bag_weight) as String, null, :bagWeight, {});
        addItem(_bagWeightItem);
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_display_folder) as String, null, :displayFolder, {}));
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_colorize_folder) as String, null, :colorizeFolder, {}));
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_circuit_folder) as String, null, :circuitFolder, {}));

        // Sous-dossiers thématiques
        addItem(new WatchUi.MenuItem(paceFolderLabel(), null, :paceFolder, {}));
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_vam_folder) as String, null, :vamFolder, {}));
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_alarm_folder) as String, null, :alarmFolder, {}));
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_coeff_folder) as String, null, :coeffFolder, {}));

        // 2nd métrique
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_metric_slot) as String, null, :metricSlot, {}));

        // v2.1.2 : Propriétés (unité de vitesse, lissage — migrées du téléphone)
        addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.menu_properties_folder) as String, null, :propertiesFolder, {}));

        onShow();
    }

    // v1.9.47 : rafraîchit les sous-libellés à chaque retour au premier plan (ex: après
    // fermeture d'un picker/sous-menu) — un MenuItem ne se met pas à jour tout seul
    function onShow() as Void {
        var bagWeight = Properties.getValue("bag_weight_prop");
        _bagWeightItem.setSubLabel(((bagWeight != null) ? bagWeight.toString() : "0") + " kg");
    }
}

class EnduranceProSettingsDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() { Menu2InputDelegate.initialize(); }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();

        if (id == :bagWeight) {
            pushRangePicker("bag_weight_prop", WatchUi.loadResource(Rez.Strings.menu_bag_weight_title) as String, 0, 20, 1, 0);

        } else if (id == :distToType) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_dist_to_type) as String, distToTypeOptions(), "dist_to_type_prop"),
                new PropertyListDelegate("dist_to_type_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :paceMode) {
            WatchUi.pushView(new PropertyListMenu(paceModeLabel(), paceModeOptions(), "pace_mode_prop"),
                new PropertyListDelegate("pace_mode_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :colorizePaceInst) {
            WatchUi.pushView(new PropertyListMenu(colorizePaceLabel() + " (inst.)", paceColorModeOptions(), "colorize_pace_inst_prop"),
                new PropertyListDelegate("colorize_pace_inst_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :colorizePaceAvg) {
            WatchUi.pushView(new PropertyListMenu(colorizePaceLabel() + " (moy.)", paceColorModeOptions(), "colorize_pace_avg_prop"),
                new PropertyListDelegate("colorize_pace_avg_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :targetPace) {
            if (isKmhMode()) {
                // 60-180 dixièmes = 6.0-18.0 km/h, pas 0.1 km/h ; défaut ≈ 330 s/km (10.9 km/h)
                pushTargetSpeedPicker("target_pace_prop", targetPaceLabel(), 60, 180, 1, 109);
            } else {
                pushPacePicker("target_pace_prop", targetPaceLabel(), 200, 600, 5, 330);
            }

        } else if (id == :paceFastThreshold) {
            pushRangePicker("pace_fast_threshold_prop", WatchUi.loadResource(Rez.Strings.set_pace_fast_threshold) as String, 1, 30, 1, 10);

        } else if (id == :paceRef) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_pace_ref) as String, paceRefOptions(), "pace_ref_prop"),
                new PropertyListDelegate("pace_ref_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :csPace) {
            // v2.4.0 : VC en s/km (même unité que l'allure cible), pas de 1 s. En km/h : pas de 0,1 km/h.
            if (isKmhMode()) {
                pushTargetSpeedPicker("cs_pace_prop", WatchUi.loadResource(Rez.Strings.set_cs) as String, 60, 240, 1, 120);
            } else {
                pushPacePicker("cs_pace_prop", WatchUi.loadResource(Rez.Strings.set_cs) as String, 150, 600, 1, 300);
            }

        } else if (id == :vcTargetZone) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_vc_target_zone) as String, vcZoneOptions(), "vc_target_zone_prop"),
                new PropertyListDelegate("vc_target_zone_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :trailSync) {
            pushTrailCodePicker();

        } else if (id == :vcTargetPct) {
            pushRangePicker("vc_target_pct_prop", WatchUi.loadResource(Rez.Strings.set_vc_target_pct) as String, 50, 130, 1, 80);

        } else if (id == :curLapPace) {
            // v2.1.2 : "Circuit" active/désactive le suivi de circuit dans son ensemble ; la
            // case "Circuit" de Mode VAM (vam_circuit_display_prop) reste respectée — ce
            // n'est pas parce qu'on réactive le circuit ici que l'utilisateur veut forcément
            // le revoir dans la rotation VAM.
            var c = item as WatchUi.ToggleMenuItem;
            var newCircuit = c.isEnabled();
            Properties.setValue("cur_lap_pace_prop", newCircuit);
            var vmC = Properties.getValue("vam_display_mode_prop");
            var vmCFlags = flagsOfVamMode((vmC != null) ? vmC as Number : 6);
            Properties.setValue("vam_display_mode_prop", combineVamMode(vmCFlags[0] as Boolean, vmCFlags[1] as Boolean, newCircuit && vamCircuitDisplayPref()));
            getApp().refreshViewSettings();

        } else if (id == :hrMode) {
            var hcur = Properties.getValue("hr_display_mode_prop");
            var hflags = flagsOf3((hcur != null) ? hcur as Number : 7);
            WatchUi.pushView(new HrDisplayMenu(hflags), new TriFlagDelegate("hr_display_mode_prop", :fA, :fB, :fC, hflags[0] as Boolean, hflags[1] as Boolean, hflags[2] as Boolean), WatchUi.SLIDE_LEFT);

        } else if (id == :metricSlot) {
            WatchUi.pushView(new MetricSlotFolderMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :metricSlotA) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.menu_metric_slot1) as String, metricSlot2Options(), "metric_slot_a_prop"),
                new PropertyListDelegate("metric_slot_a_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :metricSlotB) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.menu_metric_slot2) as String, metricSlot2Options(), "metric_slot_b_prop"),
                new PropertyListDelegate("metric_slot_b_prop"), WatchUi.SLIDE_LEFT);



        } else if (id == :paceFolder) {
            WatchUi.pushView(new AllureSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :vamFolder) {
            WatchUi.pushView(new VamSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :alarmFolder) {
            WatchUi.pushView(new AlarmSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :coeffFolder) {
            WatchUi.pushView(new CoeffSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :propertiesFolder) {
            WatchUi.pushView(new ProprietesSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :paceUnit) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_pace_unit) as String, paceUnitOptions(), "pace_unit_prop"),
                new PropertyListDelegate("pace_unit_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :bufferSize) {
            pushRangePicker("buffer_size_prop", WatchUi.loadResource(Rez.Strings.menu_buffer_size_title) as String, 5, 60, 1, 20);

        } else if (id == :displayFolder) {
            WatchUi.pushView(new AffichageSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :colorizeFolder) {
            WatchUi.pushView(new ColorisationSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :circuitFolder) {
            WatchUi.pushView(new CircuitSettingsMenu(), new EnduranceProSettingsDelegate(), WatchUi.SLIDE_LEFT);

        } else if (id == :circuitDPlusDMoins) {
            var cdd = item as WatchUi.ToggleMenuItem;
            Properties.setValue("circuit_dplus_dmoins_prop", cdd.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :circuitAllure) {
            var ca = item as WatchUi.ToggleMenuItem;
            Properties.setValue("circuit_allure_prop", ca.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :circuitDistance) {
            var cdi = item as WatchUi.ToggleMenuItem;
            Properties.setValue("circuit_distance_prop", cdi.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :circuitChrono) {
            var cc = item as WatchUi.ToggleMenuItem;
            Properties.setValue("circuit_chrono_prop", cc.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :vamMode) {
            var vmcur = Properties.getValue("vam_display_mode_prop");
            var vmflags = flagsOfVamMode((vmcur != null) ? vmcur as Number : 6);
            WatchUi.pushView(new VamModeMenu(vmflags), new VamModeDelegate(vmflags[0] as Boolean, vmflags[1] as Boolean), WatchUi.SLIDE_LEFT);

        } else if (id == :vamColorize) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.menu_vam_colorize) as String, vamColorizeOptions(), "vam_zones_enabled_prop"),
                new PropertyListDelegate("vam_zones_enabled_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :vamZone1Min) {
            pushRangePicker("vam_zone1_min", WatchUi.loadResource(Rez.Strings.set_vam_zone1_min) as String, 0, 1000, 50, 300);

        } else if (id == :vamZone1Max) {
            pushRangePicker("vam_zone1_max", WatchUi.loadResource(Rez.Strings.set_vam_zone1_max) as String, 100, 1400, 50, 600);

        } else if (id == :vamZone2Max) {
            pushRangePicker("vam_zone2_max", WatchUi.loadResource(Rez.Strings.set_vam_zone2_max) as String, 300, 1600, 50, 800);

        } else if (id == :vamZone3Max) {
            pushRangePicker("vam_zone3_max", WatchUi.loadResource(Rez.Strings.set_vam_zone3_max) as String, 500, 1800, 50, 1000);

        } else if (id == :vamZone4Max) {
            pushRangePicker("vam_zone4_max", WatchUi.loadResource(Rez.Strings.set_vam_zone4_max) as String, 700, 2000, 50, 1200);

        } else if (id == :alarm) {
            var acur = Properties.getValue("alarm");
            var aflags = flagsOf3((acur != null) ? acur as Number : 0);
            WatchUi.pushView(new AlarmModeMenu(aflags), new TriFlagDelegate("alarm", :fA, :fB, :fC, aflags[0] as Boolean, aflags[1] as Boolean, aflags[2] as Boolean), WatchUi.SLIDE_LEFT);

        } else if (id == :alarmPopupDuration) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_alarm_popup) as String, alarmPopupOptions(), "alarm_popup_duration_prop"),
                new PropertyListDelegate("alarm_popup_duration_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :alarmDisplayType) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_alarm_display_type) as String, alarmDisplayTypeOptions(), "alarm_display_type_prop"),
                new PropertyListDelegate("alarm_display_type_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :vamAlarmType) {
            var tcur = Properties.getValue("vam_alarm_type_prop");
            var tcurVal = (tcur != null) ? tcur as Number : 3;
            var ta = (tcurVal & 1) != 0;
            var tb = (tcurVal & 2) != 0;
            WatchUi.pushView(new AlarmTypeMenu(ta, tb), new BiFlagDelegate("vam_alarm_type_prop", :fA, :fB, ta, tb), WatchUi.SLIDE_LEFT);

        } else if (id == :tempEnabled) {
            var t = item as WatchUi.ToggleMenuItem;
            Properties.setValue("temp_enabled_prop", t.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :solarEnabled) {
            var t = item as WatchUi.ToggleMenuItem;
            Properties.setValue("solar_enabled_prop", t.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :climbCoeff) {
            // v2.4.0 : saisie directe en m de D+ équivalents à 1km plat (remplace le facteur 0.5–1.5)
            pushRangePicker("climb_grade_mkm_prop", WatchUi.loadResource(Rez.Strings.set_climb_coeff) as String, 30, 250, 10, 100);

        } else if (id == :descentCoeff) {
            // v2.4.0 : saisie directe en m de D- équivalents à 1km plat (remplace le facteur 0.5–1.5)
            pushRangePicker("descent_grade_mkm_prop", WatchUi.loadResource(Rez.Strings.set_descent_coeff) as String, 100, 800, 10, 330);

        } else if (id == :bagWeightMode) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_bag_weight_mode) as String, bagWeightModeOptions(), "bag_weight_mode_prop"),
                new PropertyListDelegate("bag_weight_mode_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :batteryDisplay) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.set_battery_display) as String, batteryDisplayOptions(), "battery_display_prop"),
                new PropertyListDelegate("battery_display_prop"), WatchUi.SLIDE_LEFT);

        } else if (id == :darkMode) {
            var d = item as WatchUi.ToggleMenuItem;
            Properties.setValue("dark_mode_prop", d.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :clockMetricEnabled) {
            var c = item as WatchUi.ToggleMenuItem;
            Properties.setValue("clock_metric_enabled_prop", c.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :showClock) {
            var sc = item as WatchUi.ToggleMenuItem;
            Properties.setValue("show_clock_prop", sc.isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :colorizeDPlusDMoins) {
            var cdd = item as WatchUi.ToggleMenuItem;
            Properties.setValue("colorize_dplus_dmoins_prop", cdd.isEnabled());
            getApp().refreshViewSettings();

        // --- Appli Trail Planner Companion ---
        } else if (id == :explore) {
            // Lancée une fois le menu fermé, au tour suivant de Run.onTick : la carte passe alors en
            // exploration (écran Carte en course, carte de la fiche du parcours).
            getApp().pendingExplore = true;
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);

        } else if (id == :tpZoom) {
            pushZoomMenu(false);

        } else if (id == :mapScale) {
            pushMapScaleMenu();

        } else if (id == :slopes) {
            Properties.setValue("slopes", (item as WatchUi.ToggleMenuItem).isEnabled());
            getApp().refreshViewSettings();

        } else if (id == :lapPass) {
            Properties.setValue("lapPass", (item as WatchUi.ToggleMenuItem).isEnabled());

        } else if (id == :fuelMin) {
            WatchUi.pushView(new PropertyListMenu(WatchUi.loadResource(Rez.Strings.tp_fuel) as String, fuelOptions(), "fuelMin"),
                new PropertyListDelegate("fuelMin"), WatchUi.SLIDE_LEFT);

        } else if (id == :tpVibrate) {
            Properties.setValue("vibrate", (item as WatchUi.ToggleMenuItem).isEnabled());

        } else if (id == :reload) {
            getRun().fetch();
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
    }
}

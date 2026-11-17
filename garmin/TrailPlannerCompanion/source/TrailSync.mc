// TrailSync.mc — repris d'EndurancePro 2.7.3 (source/TrailSync.mc)
// Synchronisation Trail Planner des réglages EndurancePro. Dans l'appli, pas de tâche de fond :
// le champ `ep` est lu avec le plan de la course, dans la même requête (Run.fetch), au lancement
// puis toutes les 5 minutes ; le code est le même (trail_code_prop).
//
// Format reçu (champ `ep` publié par Trail Planner), ex. :
//   EP1|cs=247|z=60,70,80,88,96,105,115,150|up=110|dn=330|vz=660,770,880,970,1060|zt=2
//   cs : vitesse critique en s/km      z  : bornes des zones VC en % de VC (N+1 valeurs)
//   up : m de D+ équivalents à 1 km    zt : zone de la séance envoyée = zone cible (0 = inchangée)
//   dn : m de D- équivalents à 1 km (allure effort montagne)
//   vz : zones VAM en m/h — min de Z1 puis max de Z1 à Z4 (5 valeurs croissantes)
//
// Les valeurs sont écrites dans les mêmes Properties que les réglages (menu montre et
// téléphone les affichent donc à jour). Elles ne sont réécrites que si Trail Planner a
// publié quelque chose de NOUVEAU : un réglage changé sur la montre en cours d'activité
// n'est pas écrasé à chaque synchronisation (même logique que onSettingsChanged()).
import Toybox.Application;
import Toybox.Application.Properties;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;

function trailCodeSet() as Boolean {
    var code = Properties.getValue("trail_code_prop");
    return (code instanceof String) && (code as String).length() >= 8;
}

// Valeur de la clé `key` dans "EP1|k1=v1|k2=v2", ou null.
function epValue(text as String, key as String) as String or Null {
    var tag = "|" + key + "=";
    var i = text.find(tag);
    if (i == null) { return null; }
    var rest = text.substring((i as Number) + tag.length(), text.length()) as String;
    var j = rest.find("|");
    return (j == null) ? rest : rest.substring(0, j as Number) as String;
}

function epNumber(text as String, key as String) as Number or Null {
    var v = epValue(text, key);
    return (v == null) ? null : v.toNumber();
}

// Nombres d'une liste "a,b,c" (les morceaux non numériques sont ignorés).
function epNumbers(text as String) as Array<Number> {
    var out = [] as Array<Number>;
    var rest = text;
    while (rest.length() > 0) {
        var j = rest.find(",");
        var part = (j == null) ? rest : rest.substring(0, j as Number) as String;
        var n = part.toNumber();
        if (n != null) { out.add(n as Number); }
        if (j == null) { break; }
        rest = rest.substring((j as Number) + 1, rest.length()) as String;
    }
    return out;
}

// Zones VAM (vz) : 5 valeurs croissantes dans les plages des réglages de la montre.
function applyVamZones(text as String) as Void {
    var vz = epValue(text, "vz");
    if (vz == null) { return; }
    var v = epNumbers(vz as String);
    if (v.size() != 5) { return; }
    var lo = [0, 100, 300, 500, 700] as Array<Number>;
    var hi = [1000, 1400, 1600, 1800, 2000] as Array<Number>;
    for (var i = 0; i < 5; i++) {
        if (v[i] < lo[i] || v[i] > hi[i]) { return; }
        if (i > 0 && v[i] <= v[i - 1]) { return; }
    }
    Properties.setValue("vam_zone1_min", v[0]);
    Properties.setValue("vam_zone1_max", v[1]);
    Properties.setValue("vam_zone2_max", v[2]);
    Properties.setValue("vam_zone3_max", v[3]);
    Properties.setValue("vam_zone4_max", v[4]);
}

// Applique le champ `ep` reçu avec le plan (ou le code d'erreur de la requête). Renvoie true si
// des réglages ont changé.
function applyTrailSync(data as Object or Null) as Boolean {
    if (!(data instanceof String)) {
        // Échec réseau (code de réponse) : on le garde pour l'afficher dans le menu.
        if (data instanceof Number) { Application.Storage.setValue("ep_err", data); }
        return false;
    }
    var text = data as String;
    if (text.find("EP1") != 0) { return false; }
    Application.Storage.setValue("ep_time", Time.now().value());
    Application.Storage.deleteValue("ep_err");
    var last = Application.Storage.getValue("ep_last");
    if (last instanceof String && (last as String).equals(text)) { return false; }

    var cs = epNumber(text, "cs");
    if (cs != null && cs >= 120 && cs <= 900) { Properties.setValue("cs_pace_prop", cs); }
    var z = epValue(text, "z");
    if (z != null && z.length() >= 3) { Properties.setValue("vc_zones_prop", z); }
    var up = epNumber(text, "up");
    if (up != null && up >= 30 && up <= 250) { Properties.setValue("climb_grade_mkm_prop", up); }
    var dn = epNumber(text, "dn");
    if (dn != null && dn >= 100 && dn <= 800) { Properties.setValue("descent_grade_mkm_prop", dn); }
    applyVamZones(text);
    var zt = epNumber(text, "zt");
    // v2.7.0 : séance envoyée avec une zone sur tout le parcours → zone cible commune = cette zone
    // (allure : même colorisation et même alarme que l'allure cible ; alarmes FC et VAM sur la même
    // zone). Zone cible limitée à Z1-Z5 : une séance en Z6-Z7 ne change pas la zone cible.
    if (zt != null && zt >= 1 && zt <= 5) {
        Properties.setValue("vc_target_zone_prop", zt);
        Properties.setValue("pace_ref_prop", 1);
    }
    Application.Storage.setValue("ep_last", text);
    return true;
}

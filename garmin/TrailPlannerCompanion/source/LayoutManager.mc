// LayoutManager.mc
import Toybox.Lang;
import Toybox.Graphics;

class LayoutManager {
    // Positions/tailles fixes — valeurs par défaut écrasées par DeviceLayout.apply()
    // (module sélectionné à la compilation par device via monkey.jungle, voir layouts/)
    var axisLeftX as Number = 79;
    var axisRightX as Number = 215;

    // Tailles de police (texte/valeurs)
    var fontPrimary   as Graphics.FontDefinition = Graphics.FONT_NUMBER_MILD;  // FC, chrono
    var fontSecondary as Graphics.FontDefinition = Graphics.FONT_LARGE;        // VAM, allures, D+/D-, altitude, distance
    var fontSmall     as Graphics.FontDefinition = Graphics.FONT_XTINY;        // lap, 2nd métrique, horloge, sac, temp, humidité

    var iconSmallOffsetY as Number = 0;
    var iconXLOffsetY    as Number = -1;
    var iconParamOffsetY as Number = -1;

    // Cercle + valeur FC
    var hrCircleW as Number = 8;
    var hrValueY as Number = 4;

    // Barre zone FC
    var hrZoneBarY as Number = 63;
    var hrZoneBarTickH as Number = 5;
    var hrBarStartX as Number = 38;
    var hrBarWidth  as Number = 204;

    // Barre batterie
    var batteryBarY as Number = 176;
    var batBarX as Number = 22;
    var batBarW as Number = 236;
    var batBarH as Number = 8;
    var batBarR as Number = 4;   // rayon coins arrondis
    var battIconX as Number = 22;  // icône batterie, centrée
    var battIconY as Number = 178;

    // Barre icônes param
    var PiconX1 as Number = 129;
    var PiconX2 as Number = 150;
    var ParamBarY1 as Number = 75;
    var ParamBarY2 as Number = 170;
    var ParamBarBagY as Number = 91;
    var ParamBarTempY as Number = 125;

    var alarmIconY as Number = 75;
    var bagIconY as Number = 94;
    var bagValueY as Number = 106;
    var sunIconY as Number = 128;
    var TempValueY as Number = 140;
    var HumidityValueY as Number = 154;

    // Centres Y des 3 lignes de données (partagés colonne gauche/droite)
    var dataRowTopY as Number = 91;   // VAM (droite) + D+ (gauche)
    var dataRowMidY as Number = 122;  // Allure inst. (droite) + D- (gauche)
    var dataRowBotY as Number = 155;  // Allure moy. (droite) + Altitude (gauche)

    // Rectangle de zone (fond coloré VAM / allures)
    var zoneRectX    as Number = 152;  // bord gauche du rectangle
    var zoneRectBarW as Number = 5;
    var zoneRectBgW as Number = 100;
    var zoneRectTopY as Number = 104;  // bas du rectangle — ligne VAM
    var zoneRectMidY as Number = 137;  // bas du rectangle — ligne allure inst.
    var zoneRectBotY as Number = 170;  // bas du rectangle — ligne allure moy.
    var zoneRectH    as Number = 33;   // hauteur, partagée par les 3 lignes

    // Encadré D+/D- (montée/descente) — colonne gauche, mêmes dimensions que
    // le fond de zone droite (zoneRectBgW x zoneRectH), bord gauche indépendant
    var dPlusMoinsRectX as Number = 29;  // bord gauche du rectangle

    var paceiconX as Number = 165;
    var paceiconY as Number = 254;
    var paceIconRingR as Number = 12;  // rayon de l'anneau (24px de diamètre)
    var lapY as Number = 36;
    var lapIconX as Number = 195;
    var lapValueX as Number = 203;
    var metric2AxisX as Number = 60;  // 2nd métrique — bloc icône+valeur centré sur cet axe
    var TimerY as Number = 204;
    var DistY as Number = 185;

    // Onglet horloge
    var clocktabY as Number = 252;
    var clockTextX as Number = 140;
    var clockTextY as Number = 266;
    var clockMetricValueX as Number = 97;  // métrique horloge — autonomie batterie, alignée à gauche

    function initialize() {
    }

    // Appelé UNE SEULE FOIS dans onLayout() — sélectionne les valeurs fixes du device
    // (module choisi à la compilation via monkey.jungle sourcePath, voir layouts/)
    function update() as Void {
        DeviceLayout.apply(self);
    }
}

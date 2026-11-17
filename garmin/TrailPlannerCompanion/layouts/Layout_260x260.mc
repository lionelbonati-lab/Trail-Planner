// layouts/Layout_260x260.mc
// fenix7pro / fenix8solar47mm — 260x260 MIP
// Coordonnees FIXES en pixels, calibrees a la main. Pas de calcul ici.
import Toybox.Lang;
import Toybox.Graphics;

module DeviceLayout {
    function apply(l as LayoutManager) as Void {
        // Axes colonnes gauche/droite
        l.axisLeftX          = 73;      l.axisRightX       = 206;

        // Tailles de police
        l.fontPrimary        = Graphics.FONT_NUMBER_MILD;
        l.fontSecondary      = Graphics.FONT_LARGE;
        l.fontSmall          = Graphics.FONT_XTINY;

        // Offsets verticaux icônes
        l.iconSmallOffsetY   = 0;
        l.iconXLOffsetY      = 0;
        l.iconParamOffsetY   = -1;

        // Cercle + valeur FC
        l.hrCircleW          = 7;
        l.hrValueY           = 32;

        // Barre zone FC
        l.hrZoneBarY         = 59;      l.hrZoneBarTickH   = 5;
        l.hrBarStartX        = 35;      l.hrBarWidth       = 189;

        // Barre batterie
        l.batteryBarY        = 162;
        l.batBarX            = 28;      l.batBarW          = 204;
        l.batBarH            = 7;       l.batBarR          = 4; // rayon coins arrondis
        l.battIconX          = 20;      l.battIconY        = 165;

        // Barre icônes param
        l.PiconX1            = 120;     l.PiconX2          = 139;
        l.ParamBarY1         = 66;      l.ParamBarY2       = 157;
        l.ParamBarBagY       = 81;      l.ParamBarTempY    = 112;

        // Icône alarme
        l.alarmIconY         = 72;

        // Icône + valeur sac
        l.bagIconY           = 90;      l.bagValueY        = 103;

        // Soleil / température / humidité
        l.sunIconY           = 122;
        l.TempValueY         = 136;
        l.HumidityValueY     = 150;

        // Centres Y des lignes de données
        l.dataRowTopY        = 80;
        l.dataRowMidY        = 111;
        l.dataRowBotY        = 141;

        // Rectangle de zone (fond coloré VAM / allures)
        l.zoneRectX          = 142;
        l.zoneRectBarW       = 4;       l.zoneRectBgW      = 104;
        l.zoneRectTopY       = 97;      l.zoneRectMidY     = 127;
        l.zoneRectBotY       = 158;     l.zoneRectH        = 31;
        l.dPlusMoinsRectX    = 13;

        // Icône allure
        l.paceiconX          = 130;     l.paceiconY        = 244;
        l.paceIconRingR      = 11;

        // Compteur de tours / métrique rotative
        l.lapY               = 45;
        l.lapIconX           = 181;     l.lapValueX        = 189;
        l.metric2AxisX       = 66;

        // Timer / Distance
        l.TimerY             = 214;     l.DistY            = 183;

        // Onglet horloge
        l.clocktabY          = 231;
        l.clockTextX         = 164;     l.clockTextY       = 239;
        l.clockMetricValueX  = 98;
    }
}

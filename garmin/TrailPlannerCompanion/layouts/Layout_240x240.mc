// layouts/Layout_240x240.mc
// fenix7s / fenix7spro — 240x240 MIP
// Coordonnees FIXES en pixels, calibrees a la main. Pas de calcul ici.
import Toybox.Lang;
import Toybox.Graphics;

module DeviceLayout {
    function apply(l as LayoutManager) as Void {
        // Axes colonnes gauche/droite
        l.axisLeftX          = 67;      l.axisRightX       = 191;

        // Tailles de police
        l.fontPrimary        = Graphics.FONT_NUMBER_MILD;
        l.fontSecondary      = Graphics.FONT_LARGE;
        l.fontSmall          = Graphics.FONT_XTINY;

        // Offsets verticaux icônes
        l.iconSmallOffsetY   = 0;
        l.iconXLOffsetY      = 0;
        l.iconParamOffsetY   = -1;

        // Cercle + valeur FC
        l.hrCircleW          = 6;
        l.hrValueY           = 29;

        // Barre zone FC
        l.hrZoneBarY         = 54;      l.hrZoneBarTickH   = 4;
        l.hrBarStartX        = 33;      l.hrBarWidth       = 174;

        // Barre batterie
        l.batteryBarY        = 149;
        l.batBarX            = 26;      l.batBarW          = 188;
        l.batBarH            = 6;       l.batBarR          = 3;
        l.battIconX          = 19;      l.battIconY        = 152;

        // Barre icônes param
        l.PiconX1            = 110;     l.PiconX2          = 129;
        l.ParamBarY1         = 61;      l.ParamBarY2       = 146;
        l.ParamBarBagY       = 75;      l.ParamBarTempY    = 104;

        // Icône alarme
        l.alarmIconY         = 67;

        // Icône + valeur sac
        l.bagIconY           = 83;      l.bagValueY        = 96;

        // Soleil / température / humidité
        l.sunIconY           = 112;
        l.TempValueY         = 126;
        l.HumidityValueY     = 140;

        // Centres Y des lignes de données
        l.dataRowTopY        = 74;
        l.dataRowMidY        = 102;
        l.dataRowBotY        = 131;

        // Rectangle de zone (fond coloré VAM / allures)
        l.zoneRectX          = 131;
        l.zoneRectBarW       = 4;       l.zoneRectBgW      = 98;
        l.zoneRectTopY       = 89;      l.zoneRectMidY     = 117;
        l.zoneRectBotY       = 145;     l.zoneRectH        = 28;
        l.dPlusMoinsRectX    = 10;

        // Icône allure
        l.paceiconX          = 120;     l.paceiconY        = 225;
        l.paceIconRingR      = 10;

        // Compteur de tours / métrique rotative
        l.lapY               = 41;
        l.lapIconX           = 167;     l.lapValueX        = 174;
        l.metric2AxisX       = 61;

        // Timer / Distance
        l.TimerY             = 197;
        l.DistY              = 168;

        // Onglet horloge
        l.clocktabY          = 213;
        l.clockTextX         = 152;     l.clockTextY       = 221;
        l.clockMetricValueX = 88;
    }
}

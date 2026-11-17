// layouts/Layout_enduro3.mc
// enduro3 — 280x280 MIP
// Coordonnees FIXES en pixels, calibrees a la main. Pas de calcul ici.
import Toybox.Lang;
import Toybox.Graphics;

module DeviceLayout {
    function apply(l as LayoutManager) as Void {
        // Axes colonnes gauche/droite
        l.axisLeftX          = 79;      l.axisRightX       = 222;

        // Tailles de police
        l.fontPrimary        = Graphics.FONT_NUMBER_MILD;
        l.fontSecondary      = Graphics.FONT_LARGE;
        l.fontSmall          = Graphics.FONT_XTINY;

        // Offsets verticaux icônes
        l.iconSmallOffsetY   = -2;
        l.iconXLOffsetY      = 0;
        l.iconParamOffsetY   = -1;

        // Cercle + valeur FC
        l.hrCircleW          = 8;
        l.hrValueY           = 35;

        // Barre zone FC
        l.hrZoneBarY         = 63;      l.hrZoneBarTickH   = 5;
        l.hrBarStartX        = 38;      l.hrBarWidth       = 203;

        // Barre batterie
        l.batteryBarY        = 174;
        l.batBarX            = 30;      l.batBarW          = 220;
        l.batBarH            = 8;       l.batBarR          = 4; // rayon coins arrondis
        l.battIconX          = 21;      l.battIconY        = 178;

        // Barre icônes param
        l.PiconX1            = 128;     l.PiconX2          = 150;
        l.ParamBarY1         = 71;      l.ParamBarY2       = 170;
        l.ParamBarBagY       = 87;      l.ParamBarTempY    = 121;

        // Icône alarme
        l.alarmIconY         = 78;

        // Icône + valeur sac
        l.bagIconY           = 97;      l.bagValueY        = 112;

        // Soleil / température / humidité
        l.sunIconY           = 131;
        l.TempValueY         = 147;
        l.HumidityValueY     = 163;

        // Centres Y des lignes de données
        l.dataRowTopY        = 88;
        l.dataRowMidY        = 121;
        l.dataRowBotY        = 154;

        // Rectangle de zone (fond coloré VAM / allures)
        l.zoneRectX          = 153;
        l.zoneRectBarW       = 4;       l.zoneRectBgW      = 112;
        l.zoneRectTopY       = 104;     l.zoneRectMidY     = 137;
        l.zoneRectBotY       = 170;     l.zoneRectH        = 33;
        l.dPlusMoinsRectX    = 14;

        // Icône allure
        l.paceiconX          = 140;     l.paceiconY        = 263;
        l.paceIconRingR      = 12;

        // Compteur de tours / métrique rotative
        l.lapY               = 49;
        l.lapIconX           = 195;     l.lapValueX        = 203;
        l.metric2AxisX       = 71;

        // Timer / Distance
        l.TimerY             = 233;     l.DistY            = 200;

        // Onglet horloge
        l.clocktabY          = 249;
        l.clockTextX         = 177;     l.clockTextY       = 259;
        l.clockMetricValueX = 102;
    }
}

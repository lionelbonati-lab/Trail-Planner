// layouts/Layout_454x454.mc
// epix2pro51mm / fr965 / venu3 / venu445mm — 454x454 AMOLED
// Coordonnees FIXES en pixels, calibrees a la main. Pas de calcul ici.
import Toybox.Lang;
import Toybox.Graphics;

module DeviceLayout {
    function apply(l as LayoutManager) as Void {
        // Axes colonnes gauche/droite
        l.axisLeftX          = 127;     l.axisRightX       = 358;

        // Tailles de police
        l.fontPrimary        = Graphics.FONT_LARGE;
        l.fontSecondary      = Graphics.FONT_MEDIUM;
        l.fontSmall          = Graphics.FONT_XTINY;

        // Offsets verticaux icônes
        l.iconSmallOffsetY   = 0;
        l.iconXLOffsetY      = 0;
        l.iconParamOffsetY   = -1;

        // Cercle + valeur FC
        l.hrCircleW          = 8 ;
        l.hrValueY           = 58;

        // Barre zone FC
        l.hrZoneBarY         = 101;     l.hrZoneBarTickH   = 8;
        l.hrBarStartX        = 62;      l.hrBarWidth       = 330;

        // Barre batterie
        l.batteryBarY        = 276;
        l.batBarX            = 48;      l.batBarW          = 358;
        l.batBarH            = 16;      l.batBarR          = 8;
        l.battIconX          = 34;      l.battIconY        = 284;

        // Barre icônes param
        l.PiconX1            = 207;     l.PiconX2          = 246;
        l.ParamBarY1         = 112;     l.ParamBarY2       = 274;
        l.ParamBarBagY       = 138;     l.ParamBarTempY    = 195;

        // Icône alarme
        l.alarmIconY         = 123;

        // Icône + valeur sac
        l.bagIconY           = 154;     l.bagValueY        = 180;

        // Soleil / température / humidité
        l.sunIconY           = 211;
        l.TempValueY         = 237;
        l.HumidityValueY     = 263;

        // Centres Y des lignes de données
        l.dataRowTopY        = 139;
        l.dataRowMidY        = 193;
        l.dataRowBotY        = 247;

        // Rectangle de zone (fond coloré VAM / allures)
        l.zoneRectX          = 249;
        l.zoneRectBarW       = 8;       l.zoneRectBgW      = 183;
        l.zoneRectTopY       = 166;     l.zoneRectMidY     = 220;
        l.zoneRectBotY       = 274;     l.zoneRectH        = 54;
        l.dPlusMoinsRectX    = 21;

        // Icône allure
        l.paceiconX          = 227;     l.paceiconY        = 427;
        l.paceIconRingR      = 19;

        // Compteur de tours / métrique rotative
        l.lapY               = 80;
        l.lapIconX           = 316;     l.lapValueX        = 329;
        l.metric2AxisX       = 118;

        // Timer / Distance
        l.TimerY             = 373;
        l.DistY              = 316;

        // Onglet horloge
        l.clocktabY          = 406;
        l.clockTextX         = 287;     l.clockTextY       = 420;
        l.clockMetricValueX = 163;
    }
}

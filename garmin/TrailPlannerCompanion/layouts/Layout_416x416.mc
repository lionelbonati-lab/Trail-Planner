// layouts/Layout_416x416.mc
// epix2 / fenixe — 416x416 AMOLED
// Coordonnees FIXES en pixels, calibrees a la main. Pas de calcul ici.
import Toybox.Lang;
import Toybox.Graphics;

module DeviceLayout {
    function apply(l as LayoutManager) as Void {
        // Axes colonnes gauche/droite
        l.axisLeftX          = 115;     l.axisRightX       = 331;

        // Tailles de police
        l.fontPrimary        = Graphics.FONT_LARGE;
        l.fontSecondary      = Graphics.FONT_MEDIUM;
        l.fontSmall           = Graphics.FONT_XTINY;

        // Offsets verticaux icônes
        l.iconSmallOffsetY   = 0;
        l.iconXLOffsetY      = 0;
        l.iconParamOffsetY   = -2;

        // Cercle + valeur FC
        l.hrCircleW          = 7;
        l.hrValueY           = 51;

        // Barre zone FC
        l.hrZoneBarY         = 94;      l.hrZoneBarTickH   = 8;
        l.hrBarStartX        = 57;      l.hrBarWidth       = 302;

        // Barre batterie
        l.batteryBarY        = 260;
        l.batBarX            = 44;      l.batBarW          = 328;
        l.batBarH            = 14;      l.batBarR          = 7;
        l.battIconX          = 33;      l.battIconY        = 266;

        // Barre icônes param
        l.PiconX1            = 190;     l.PiconX2          = 225;
        l.ParamBarY1         = 106;     l.ParamBarY2       = 252;
        l.ParamBarBagY       = 129;     l.ParamBarTempY    = 180;

        // Icône alarme
        l.alarmIconY         = 117;

        // Icône + valeur sac
        l.bagIconY           = 144;     l.bagValueY        = 167;

        // Soleil / température / humidité
        l.sunIconY           = 195;
        l.TempValueY         = 219;
        l.HumidityValueY     = 243;

        // Centres Y des lignes de données
        l.dataRowTopY        = 131;
        l.dataRowMidY        = 180;
        l.dataRowBotY        = 229;

        // Rectangle de zone (fond coloré VAM / allures)
        l.zoneRectX          = 228;
        l.zoneRectBarW       = 7;       l.zoneRectBgW      = 168;
        l.zoneRectTopY       = 155;     l.zoneRectMidY     = 204;
        l.zoneRectBotY       = 253;     l.zoneRectH        = 49;
        l.dPlusMoinsRectX    = 19;

        // Icône allure
        l.paceiconX          = 208;     l.paceiconY        = 392;
        l.paceIconRingR      = 18;

        // Compteur de tours / métrique rotative
        l.lapY               = 73;
        l.lapIconX           = 291;     l.lapValueX        = 301;
        l.metric2AxisX       = 107;

        // Timer / Distance
        l.TimerY             = 345;
        l.DistY              = 299;

        // Onglet horloge
        l.clocktabY          = 370;
        l.clockTextX         = 263;     l.clockTextY       = 386;
        l.clockMetricValueX  = 153;
    }
}

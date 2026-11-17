// EnduranceProView.mc — écran EndurancePro 2.7.3 (source/EnduranceProView_v2.7.3.mc du dépôt
// EnduranceProDatafield), repris tel quel dans l'appli Trail Planner Companion. Seules différences,
// d'un champ de données à une appli :
// - classe simple (plus de WatchUi.DataField) : l'appli appelle compute() chaque seconde, onLayout()
//   et onUpdate() depuis son écran (MainView), et onTimerStart() / onTimerLap() / onTimerReset() au
//   départ, aux tours et à la fin de la sortie (Run) ;
// - champs FIT créés sur la session d'enregistrement (createFitFields, appelé par Run au départ) au
//   lieu de DataField.createField() dans initialize() ;
// - drawAlarmPopup() public : le popup d'alarme s'affiche aussi sur les autres écrans ;
// - bandeaux d'EP sur tous les écrans (drawBands : FC, anneau, 2e métrique, tour, barre FC ; autonomie,
//   mode d'allure, heure, trait FC), colonne centrale (drawCenterColumn), mise en page et polices
//   d'icônes (lay, iconFonts) pour l'écran Trail Planner, popup des rappels Trail Planner (showPopup) ;
// - distance restante (bas d'écran) : sans parcours Garmin suivi, celle du plan Trail Planner (prochain
//   point, arrivée) ; le réglage « prochain point » / « fin de parcours » / « alternance » est respecté
//   (distPhase).
import Toybox.ActivityRecording;
import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.Activity;
import Toybox.Lang;
import Toybox.UserProfile;
import Toybox.System;
import Toybox.Application.Properties;
import Toybox.FitContributor;
import Toybox.Attention;
import Toybox.SensorHistory;

class EnduranceProView {
    private var iconsMed;
    private var paramIcons;
    private var notifIcons;

    // Vos codes Unicode personnalisés (depuis IcoMoon)
    // -- police EnduranceIconsParam (paramicon.fnt) --
    private const ICON_ALARM = "\ue93e";
    private const ICON_SUN = "\ue93f";
    private const ICON_BAG = "\ue940";
    private const ICON_BAG_SUN = "\ue941";
    private const ICON_FLASH   = "\ue942";
    private const ICON_RUN = "\ue943";
    private const ICON_CAL = "\ue944";
    private const ICON_BODY_BAT = "\ue945";
    private const ICON_BAT = "\ue946";
    private const ICON_LAP_S = "\ue947";

    // -- police EnduranceIconsMed (icon.fnt) --
    private const ICON_WAYPOINT = "\ue92a";
    private const ICON_WATER = "\ue92b";
    private const ICON_FOOD = "\ue92c";
    private const ICON_FLAG = "\ue92d";
    private const ICON_MOUNTAIN = "\ue92e";
    private const ICON_DOWN = "\ue92f";
    private const ICON_UP = "\ue930";
    private const ICON_DOWN_R = "\ue931";
    private const ICON_UP_R = "\ue932";
    private const ICON_AVGUP = "\ue933";
    private const ICON_AVGDOWN = "\ue934";
    private const ICON_PACE = "\ue935";
    private const ICON_AVGPACE = "\ue936";
    private const ICON_LAP = "\ue937";
    private const ICON_AVGLAP   = "\ue938";


    // -- police EnduranceIconsNotif (notificon.fnt) --
    private const NOTIF_HR = "\ue952";
    private const NOTIF_VAM = "\ue953";
    private const NOTIF_PACE = "\ue954";
    private const ICON_LAP_XL   = "\ue955";

    private var paceIcons;
    private const ICON_STD = "\ue91d";
    private const ICON_MNT = "\ue91e";
    private const ICON_FLAT = "\ue91f";

    private var bgIcon;
    // v2.2.5 : guide de calibration (icônes/valeurs) — jamais publié, repasser à false avant un build de publication
    private const SHOW_CALIBRATION_GUIDE = false;
    // v2.2.5 : valeurs de test en dur (D+/D- 10000m, chrono 30h, distance 100.44km, VAM 2000,
    // allure inst./moy. 14:44) — jamais publié, repasser à false avant un build de publication
    private const SHOW_TEST_VALUES = false;



    private var layout as LayoutManager;
    // v2.0.5 : variante "vive" (fond noir) vs "foncée" (fond blanc) d'une couleur sémantique —
    // les teintes claires (gris clair, bleu, vert) se noient sur fond blanc en mode clair.
    // Seule l'icône SUN (couleur selon zone WBGT) est volontairement exclue de ce traitement.
    private function themed(onDark as Number, onLight as Number) as Number {
        return isDarkMode ? onDark : onLight;
    }
    private const PARAM_ICON_OFF_DARK  = Graphics.COLOR_DK_GRAY; // SUN, BAG, ALARM — paramètre inactif (mode sombre)
    private const PARAM_ICON_OFF_LIGHT = Graphics.COLOR_DK_GRAY; // SUN, BAG, ALARM — paramètre inactif (mode clair)


    // --- v2.1.2 : Refonte complète des champs FIT (20 champs, voir matrice) — chaque champ a
    // désormais un ID et un DATA_TYPE fixes (plus de type dynamique sur un même ID, cause des
    // crashs "écran blanc IQ" précédents). Chaque groupe de champs est gardé par un toggle
    // dédié (Application.Properties, réglable depuis Garmin Connect uniquement) ; le champ
    // n'est créé (createField) que si son toggle est actif, il reste `null` sinon — tous les
    // .setData() plus bas sont déjà protégés par un `if (champ != null)`, donc aucun contrôle
    // supplémentaire n'est nécessaire à l'écriture. v2.2.9 : le picker Vitesse/Allure FIT a été
    // supprimé — chaque paire (allure STRING + vitesse FLOAT) est désormais toujours créée
    // ensemble, il n'y a plus de sélection à l'ID.
    // RECORD (IDs 1-4)
    private var fitAllureEffortField = null; // ID 1 — Allure effort (mn/km)
    private var fitVitesseEffortField = null; // ID 2 — Vitesse effort (km/h)
    private var fitTempBagCorrField  = null; // ID 3 — Correction temp.+sac appliquée (%)
    private var fitBagWeightRecField = null; // ID 4 — Poids du sac (RECORD)
    // CYCLE / LAP (IDs 5-11)
    private var fitLapAllureStdField   = null; // ID 5  — Allure moy. Standard (LAP)
    private var fitLapAllureMtnField   = null; // ID 6  — Allure moy. Montagne (LAP)
    private var fitLapVitesseStdField  = null; // ID 7  — Vitesse moy. Standard (LAP)
    private var fitLapVitesseMtnField  = null; // ID 8  — Vitesse moy. Montagne (LAP)
    private var fitLapDistField        = null; // ID 9  — Distance effort (LAP)
    private var fitLapBagWeightField   = null; // ID 10 — Poids du sac moyenne (LAP)
    private var fitLapVamField         = null; // ID 11 — VAM moyenne circuit (LAP)
    // SESSION (IDs 12-20)
    private var fitSesAllureStdField    = null; // ID 12 — Allure moy. Standard (SESSION)
    private var fitSesAllureMtnField    = null; // ID 13 — Allure moy. Montagne (SESSION)
    private var fitSesVitesseStdField   = null; // ID 14 — Vitesse moy. Standard (SESSION)
    private var fitSesVitesseMtnField   = null; // ID 15 — Vitesse moy. Montagne (SESSION)
    private var fitSesDistField         = null; // ID 16 — Distance effort (SESSION)
    private var fitSesTempCoeffField    = null; // ID 17 — Coeff. température ON/OFF (SESSION)
    // ID 18 (Poids du sac SESSION) supprimé v2.2.11 : déjà présent en RECORD (ID4) et LAP (ID10)
    private var fitSesClimbCoeffField   = null; // ID 19 — Coefficient montée (SESSION)
    private var fitSesDescentCoeffField = null; // ID 20 — Coefficient descente (SESSION)
    // Calculs toujours effectués (indépendants du paceMode d'affichage)
    private var curEffortPaceStd = 0.0f;
    private var curEffortPaceMtn = 0.0f;
    // v1.9.4 : Facteurs allure effort
    private var tempEnabled   = false;
    private var solarEnabled  = false; // v2.4.0 : capteur solaire ajouté au coefficient température
    private var currentSolar  = -1;    // intensité solaire (0-100) — -1 = non disponible
    private var bagWeight     = 0;
    private var climbGradeMKm   = 100.0f; // v2.4.0 : m de D+ équivalents à 1km plat (remplace climbCoeff)
    private var descentGradeMKm = 330.0f; // v2.4.0 : m de D- équivalents à 1km plat (remplace descentCoeff)
    private var tempFactor    = 1.0f;  // calculé dans compute(), lu dans draw
    private var currentTempC  = 0;     // température (°C, entier) — mise à jour toutes les 30 s
    private var currentHumidity = -1;  // humidité relative (%, entier) — -1 = non disponible
    private var currentWbgt   = -99.0f; // WBGT calculé — pour colorisation icône
    private var bagFactor     = 1.0f;  // 1 + bagWeight*0.01 — mis à jour dans updateAllSettings()
    private var fastPaceLimit = 0.0f;  // seuil « trop rapide » de la cible effective (targetPace) — mis à jour dans updateAllSettings()

    private var TARGET_PACE = 330; 
    private var isDarkMode = true;

    // --- v2.7.0 : CIBLE D'ALLURE TIRÉE DE LA VC — colorisation et alarme inchangées ---
    // (vert dans la cible, orange au-delà du seuil rapide, alarme si trop rapide). La cible
    // vient de pace_ref_prop : 0 = allure cible brute, 1 = zone VC, 2 = % de VC.
    // (v2.4.0 colorait l'allure avec les 7 couleurs des zones : abandonné à la demande de Lionel.)
    private var paceRef     as Number  = 0;
    private var targetPace  as Float   = 330.0f;  // allure cible effective (s/km)
    private var csPaceSec   as Float   = 300.0f;  // VC en s/km (cs_pace_prop)
    // Bornes des zones en fraction de VC (N+1 valeurs pour N zones), voir parseVcBounds()
    private var vcBounds    as Array<Float> = [0.60f, 0.70f, 0.80f, 0.88f, 0.96f, 1.05f, 1.15f, 1.50f] as Array<Float>;
    private var vcTargetZone as Number = 2;   // zone cible commune (1-5) : allure en référence Zone VC, alarmes FC et VAM
    private var vcTargetPct  as Number = 80;  // % de VC cible en référence % de VC



    // --- v1.2.0 : % INCLINAISON ---
    private var currentGrade = 0.0f;

    // --- v1.5.0 : ZONES VAM ---
    private var vamZonesEnabled = 2;   // 0=Off, 1=Barre, 2=Fond, 3=Police
    private var vamZones = [500, 700, 900, 1100] as Array<Number>;
    private var vamZoneMinThreshold = 300;  // en dessous : colorisation inactive

    // --- v1.6.0 ---
    private var vamDisplayMode = 6;  // 0=VAM seule, 1=% Pente seule, 2=Moy. tour seule, 3=VAM+% Pente, 4=VAM+Moy. tour, 5=Moy. tour+% Pente, 6=VAM+Moy. tour+% Pente

    // --- v1.7.1 : MODE ALLURE UNIFIÉ ---
    private var paceMode = 1;  // 0=Normale, 1=Effort Std, 2=Effort Mtn

    // --- v1.7.0 : LIGNE SÉPARATRICE FC ---
    private var showHRZoneBar = true;
    private var colorizeHRZoneBar = true;
    // --- v1.7.3 : CERCLE FC ---
    private var showHRCircle    = true;
    private var colorizeHRValue = true;


    // --- v1.8.0 : COLORISATION ALLURE — v2.2.4 : 2 réglages indépendants (inst./moy.),
    // chacun 0=Off, 1=Barre, 2=Fond, 3=Police (remplace l'ancien colorizePaceMode bitmask) ---
    private var colorizePaceInstMode = 2;
    private var colorizePaceAvgMode  = 3;
    private var colorizeDPlusDMoins  = true;  // v2.2.8 : encadré 1px D+/D- selon la tendance
    private var paceFastThreshold = 10;

    // --- v1.9.36 : Unité allure ---
    private var paceUnitKmh as Boolean = false; // true = affichage km/h — écran, réglable en course
    // v2.1.3 : Unité allure/vitesse pour l'ENREGISTREMENT FIT — indépendante de paceUnitKmh,
    // réglage téléphone uniquement, figée dès que l'activité est lancée (voir updateAllSettings())
    // v2.2.9 : tentative de créer allure+vitesse ensemble sur RECORD/LAP/SESSION → "Out of memory"
    // (budget mémoire FIT dépassé, une fois tous les champs optionnels combinés) : rétabli.
    private var fitPaceUnitKmh as Boolean = false;
    // --- v1.9.0 : DISTANCE TO ---
    private var distToType = 3;
    // --- v1.8.0 : ALARME ---
    private var alarmMode = 1;            // 0=Off, 1=VAM, 2=Allure, 3=FC, 4=VAM+Allure, 5=VAM+FC, 6=Allure+FC, 7=Tout
    private var vamAlarmType = 3;         // 1=Vibration, 2=Son, 3=Vibration+Son
    private const PACE_ALARM_DELAY    = 10;    // sec de dépassement continu avant 1ère alarme allure
    private const ALARM_REPEAT        = 30;   // sec entre deux rappels (toutes alarmes)
    private var paceAlarmDelay      = 0;
    private var globalAlarmCooldown = 0;  // v1.9.25 : bloque tous les types pendant ALARM_REPEAT après un déclenchement
    private var alarmEnabled  as Boolean = false;  // v2.2.1 : gate ON/OFF. v2.2.11 : coupe désormais TOUTE
        // l'alarme (popup + vibration + son), plus seulement le popup — voir triggerAlarm()
    // v2.2.11 : popup alarme dessiné par l'app (alternative à WatchUi.showToast, natif montre,
    // qui ne respecte pas toujours la durée système et peut nécessiter un appui bouton pour se
    // fermer selon le modèle — voir trail_datafield_notes.md). Choix Popup/Notification via
    // alarm_display_type_prop
    private var alarmPopupLabel       as String = "";
    private var alarmPopupValue       as String = "";
    private var alarmPopupTicks       as Number = 0;   // secondes restantes d'affichage
    private var alarmPopupDurationSec as Number = 0;   // durée configurée (0/3/5/10s), = alarm_popup_duration_prop
    // Appli : popup des rappels Trail Planner (police de l'icône, police du texte, durée propre).
    private var alarmPopupFont = null;                  // null : notifIcons (alarmes d'EP)
    private var alarmPopupValueFont = Graphics.FONT_NUMBER_MILD;
    private var popupOwnTicks as Number = 0;
    private var alarmDisplayType      as Number = 0;   // 0=Popup (dessiné par l'app), 1=Notification (showToast)
    // v1.9.21 : Booleans alarme pré-calculés (OPT 7)
    private var vamAlarmEnabled  as Boolean = false;
    private var paceAlarmEnabled as Boolean = false;
    private var fcAlarmEnabled   as Boolean = false;
    // Positions calculées une fois dans onLayout (invariantes entre frames)
    private var centerX    as Number = 0;
    private var centerY    as Number = 0;
    private var screenW    as Number = 280;
    private var screenH    as Number = 280;
    private var yDist      as Number = 0;
    private var yTimer     as Number = 0;
    // clockSec / 5 pré-calculé dans onUpdate
    private var clockDiv5  as Number = 0;
    // Cache formatTime (appelé avec la même valeur pendant ~1 s)
    private var cachedTimeStr   as String = "0:00";
    private var cachedTimeValue as Number = -1;
    // Cache horloge HH:MM — change toutes les 60 s seulement
    private var cachedClockStr as String = "--:--";
    private var cachedClockMin as Number = -1;
    // Largeurs d'icônes constantes (pré-calculées dans onLayout)
    private var iconLapW   as Number = 0;  // ICON_LAP
    private var iconLapXLW as Number = 0;  // ICON_LAP_XL
    private var iconFlagW  as Number = 0;  // ICON_FLAG
    private var iconWaypW  as Number = 0;  // ICON_WAYPOINT
    private var labelKmW   as Number = 0;  // "km" en FONT_XTINY
    // Cache lapCount string — mis à jour uniquement sur événement lap
    private var lapCountStr as String = "1";
    // v1.9.21 : Pattern vibration pré-alloué (évite 6 new à chaque alarme)
    private var vibePattern as Array or Null = null;
    // v1.9.21 : Mise à jour périodique batterie / température (pas chaque seconde)
    private var batteryCache     as Float  = 100.0f;
    private var bodyBatteryCache as Number = -1;    // -1 = non disponible
    private var batteryAutonomyH as Number = -1;    // heures restantes estimées (System.Stats.batteryInDays), -1 = indispo
    private var batteryDisplayMode as Number = 0;   // 0=Batterie appareil, 1=Body Battery
    private var batteryTick  as Number = 60;   // = 60 → lecture immédiate au 1er compute()
    private var tempTick     as Number = 30;   // = 30 → calcul immédiat au 1er compute()
    // Cache zones HR — chargé une fois au démarrage (invariant pendant l'activité)
    private var hrZonesCache as Array or Null = null;

    // --- LOGIQUE DE LISSAGE DYNAMIQUE ---
    private const BUFFER_SIZE_MIN = 5;
    private const BUFFER_SIZE_MAX = 60;
    private const BUFFER_SIZE_DEFAULT = 20;
    private var bufferSize = BUFFER_SIZE_DEFAULT;
    private var altBuffer = new [60] as Array<Float>;
    private var distBuffer = new [60] as Array<Float>;
    private var bufferIdx = 0;
    private var isBufferFull = false;
    private var vamSmoothed = 0.0f;       // EMA lissage VAM
    private const VAM_EMA_ALPHA = 0.2f;   // α : 0.2 ≈ τ 4 s — démarrage progressif, convergence rapide
    private var altInitialized = false;   // true après la 1ère mesure d'altitude
    private var distInitialized = false;  // true après la 1ère distance > 0 (post-start)
    private var distBufferAge = 0;        // nombre de frames de vraie distance accumulées

    private var currentVam = 0;
    private var curFlatPace = 0.0f;
    private var avgFlatPace = 0.0f;
    private var avgPaceStd = 0.0f;   // v1.9.4 : moy. effort std (pour affichage rotation)
    private var avgPaceMtn = 0.0f;   // v1.9.4 : moy. effort mtn (pour affichage rotation)
    // v1.9.35 : Distance effort incrémentale
    private var effortDistanceAccum   = 0.0f;  // Accumulation distance effort (km)
    private var prevDistEffort        = 0.0f;  // Distance précédente pour calcul delta
    private var curElevStd            = 1.0f;  // elevStd instantané (réutilisé pour K_inst)
    // v1.9.28 : Métriques rotation
    // v1.9.48 : 2nd métrique — 2 slots indépendants (0=Aucun, 1=Fatigue, 2=Calories, 3=Km Effort)
    private var metricSlotA         = 7;
    private var metricSlotB         = 0;
    private var showClockAutonomy   = true;
    private var showClock           = true;
    private var baselinePace        = 0.0f;  // Allure moyenne premiers 10 min (baseline fatigue)
    private var baselineInitialized = false; // true après 10 min
    private var totalCalories       = 0;     // Calories totales (lecture Activity.Info)
    private var curLapFlatPace      = 0.0f;  // Allure plate du circuit en cours
    private var curLapPaceStd       = 0.0f;  // Allure effort std du circuit en cours
    private var curLapPaceMtn       = 0.0f;  // Allure effort mtn du circuit en cours
    private var showCurLapPace      = true;  // Afficher alternance allure circuit en cours
    // v2.2.8 : Menu Circuit — toggles indépendants par donnée (n'ont d'effet que si showCurLapPace est actif)
    private var showCircuitDPlusMoins = true;
    private var showCircuitAllure     = true;
    private var showCircuitDistance   = true;
    private var showCircuitChrono     = true;
    private var lapPressed          = false; // true après le 1er appui sur Lap
    private var lapTriggerPending   = false; // flag : reset circuit à appliquer au prochain compute()
    private var lapCount            = 1;     // Nombre de circuits effectués (1 dès l'ouverture)
    private var curLapDist          = 0.0f;  // Distance circuit en cours (m)
    private var curLapTime          = 0.0f;  // Temps circuit en cours (s) — timer Garmin, se fige en pause
    private var curLapAvgVam        = 0.0f;  // VAM moyenne circuit en cours (m/h)
    private var curLapAscent        = 0.0f;  // v2.2.7 : D+ du circuit en cours (m)
    private var curLapDescent       = 0.0f;  // v2.2.7 : D- du circuit en cours (m)
    private var showLapMode         = false; // true quand affichage mode circuit actif (alternance)
    // v2.2.8 : dérivées de showLapMode, une par donnée, combinées avec les toggles du menu Circuit
    private var showLapDPlusMoins   = false;
    private var showLapPaceAvg      = false;
    private var showLapDist         = false;
    private var showLapChrono       = false;
    private var lapStartDist        = 0.0f;  // Distance au début du circuit en cours
    private var lapStartTime        = 0.0f;  // Timer (s) au début du circuit en cours
    private var lapStartAscent      = 0.0f;  // D+ cumulé au début du circuit en cours
    private var lapStartDescent     = 0.0f;  // D- cumulé au début du circuit en cours
    private var lapStartEffortDist  = 0.0f;  // v2.1.2 : effortDistanceAccum au début du circuit en cours (ID 9 FIT)
    private var curLapEffortDist    = 0.0f;  // v2.1.2 : distance effort du circuit en cours (km)
    private var lapStartInitialized = false; // true après la 1ère initialisation des marqueurs
    // v2.2.10 : Bug B — capture optionnelle de l'horodatage/distance/D+/D- au moment exact du
    // callback onTimerLap()/onTimerLap2() (plus proche de l'appui réel sur Lap que le prochain
    // compute(), jusqu'à ~1s plus tard). Restent `null` si Activity.getActivityInfo() échoue ou
    // renvoie des champs incomplets à cet instant précis — compute() retombe alors sur son
    // ancien comportement (capture depuis le `info` du tick suivant), sans régression possible.
    // À VALIDER SUR DEVICE RÉEL : un commentaire antérieur (voir onTimerLap) indique que cette
    // lecture peut être périmée à l'instant du callback — c'est précisément ce que ce guard
    // défensif neutralise si l'hypothèse se révèle fausse.
    private var lapTriggerCapturedTime    as Float or Null = null;
    private var lapTriggerCapturedDist    as Float or Null = null;
    private var lapTriggerCapturedAscent  as Float or Null = null;
    private var lapTriggerCapturedDescent as Float or Null = null;
    private var clockSec            = 0;     // Secondes horloge du cycle onUpdate() courant
    // Allures affichées (arrondi 5 s + hystérésis + intervalle)
    private var dispFlatPace = 0.0f;
    private var dispEffortPaceStd = 0.0f;
    private var dispEffortPaceMtn = 0.0f;
    private var paceUpdateCounter = 0;
    private const PACE_UPDATE_INTERVAL = 1; // rafraîchissement toutes les 1 s
    private const ICON_GAP = 3;             // gap en px entre icône et valeur (partagé)

    private function updateBuffers(info as Activity.Info or Null) as Void {
        if (info == null || info.altitude == null) { return; }
        var curAlt = info.altitude.toFloat();

        // Première mesure : remplir le buffer pour éviter les pics au démarrage
        if (!altInitialized) {
            for (var i = 0; i < BUFFER_SIZE_MAX; i++) {
                altBuffer[i] = curAlt;
            }
            altInitialized = true;
        }

        var curDist = (info.elapsedDistance != null) ? info.elapsedDistance.toFloat() : 0.0f;

        // Première distance non nulle : pré-remplir le buffer pour éviter un pic d'allure au démarrage
        if (!distInitialized && curDist > 0.0f) {
            for (var i = 0; i < BUFFER_SIZE_MAX; i++) {
                distBuffer[i] = curDist;
            }
            distInitialized = true;
        }

        altBuffer[bufferIdx] = curAlt;
        distBuffer[bufferIdx] = curDist;
        bufferIdx = (bufferIdx + 1) % bufferSize;
        if (bufferIdx == 0 && !isBufferFull) {
            isBufferFull = true;
        }
    }

    private function resetBuffers() as Void {
        bufferIdx = 0;
        isBufferFull = false;
        vamSmoothed = 0.0f;
        altInitialized = false;
        distInitialized = false;
        distBufferAge = 0;
        for (var i = 0; i < BUFFER_SIZE_MAX; i++) {
            altBuffer[i] = 0.0f;
            distBuffer[i] = 0.0f;
        }
    }

    function initialize() {
        layout = new LayoutManager();
        if (Attention has :vibrate) {
            vibePattern = [
                new Attention.VibeProfile(100, 250),
                new Attention.VibeProfile(0,   125),
                new Attention.VibeProfile(100, 250),
                new Attention.VibeProfile(0,   125),
                new Attention.VibeProfile(100, 250),
            ];
        }
        resetBuffers();
        hrZonesCache = UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_RUNNING);
        updateAllSettings();

        // v1.9.36 : Restauration de l'état des laps après rechargement (changement de settings)
        // Uniquement si une activité est en cours (timer > 0) — évite la restauration au démarrage à froid
        var initActInfo = Activity.getActivityInfo();
        var storedLc = Application.Storage.getValue("lc") as Number or Null;
        if (storedLc != null && storedLc > 1
            && initActInfo != null && initActInfo.timerTime != null && initActInfo.timerTime > 0) {
            lapCount            = storedLc;
            lapCountStr         = lapCount.toString();
            lapPressed          = true;
            lapStartInitialized = true;
            var v;
            v = Application.Storage.getValue("lsd");  if (v != null) { lapStartDist    = v.toFloat(); }
            v = Application.Storage.getValue("lst");   if (v != null) { lapStartTime    = v.toFloat(); }
            v = Application.Storage.getValue("lsa");   if (v != null) { lapStartAscent  = v.toFloat(); }
            v = Application.Storage.getValue("lsde");  if (v != null) { lapStartDescent = v.toFloat(); }
            v = Application.Storage.getValue("lsed");  if (v != null) { lapStartEffortDist = v.toFloat(); }
        }

    }

    // Appli : champs FIT créés sur la session d'enregistrement, avant son départ (Run.start).
    function createFitFields(session as ActivityRecording.Session) as Void {
        // v2.1.2 : REFONTE COMPLÈTE DES CHAMPS FIT (20 champs, voir matrice fournie). Chaque
        // champ n'est créé que si son toggle (Application.Properties, réglable uniquement
        // depuis Garmin Connect avant le lancement de l'activité) est actif ; sinon il reste
        // `null` et les .setData() dans compute()/updateLapFitData() (déjà protégés par
        // `if (champ != null)`) sont simplement ignorés — aucun contrôle supplémentaire requis.
        // Le picker Vitesse/Allure existant (pace_unit_prop) sélectionne, pour chaque paire,
        // lequel des deux champs de type fixe est créé (jamais de changement de type sur un
        // même ID une fois créé : c'est ce qui causait les crashs "écran blanc IQ" précédents).

        // --- RECORD --- v2.2.9 : tentative allure ET vitesse toujours ensemble → deux crashs
        // successifs (STRING interdit sur RECORD, puis "Out of memory" une fois combiné aux
        // autres champs optionnels). ID 1 ne peut de toute façon pas passer en STRING (mm:ss) —
        // contrainte de plateforme confirmée par le firmware sur MESG_TYPE_RECORD. Rétabli le
        // choix d'unité (fit_pace_unit_prop) : un seul des deux champs est créé, comme en v2.2.8.
        if (Properties.getValue("fit_pace_speed_prop") == true) {
            if (fitPaceUnitKmh) {
                fitVitesseEffortField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_eff_speed_kmh) as String,
                    2, FitContributor.DATA_TYPE_FLOAT,
                    {:mesgType => FitContributor.MESG_TYPE_RECORD, :units => "km/h"}
                );
                fitVitesseEffortField.setData(0.0);
            } else {
                fitAllureEffortField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_eff_generic) as String,
                    1, FitContributor.DATA_TYPE_FLOAT,
                    {:mesgType => FitContributor.MESG_TYPE_RECORD, :units => "min/km"}
                );
                fitAllureEffortField.setData(0.0);
            }
        }

        if (Properties.getValue("fit_temp_bag_corr_prop") == true) {
            fitTempBagCorrField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_temp_bag_corr) as String,
                3, FitContributor.DATA_TYPE_FLOAT,
                {:mesgType => FitContributor.MESG_TYPE_RECORD, :units => "%"}
            );
            fitTempBagCorrField.setData(0.0);
        }

        if (Properties.getValue("fit_bag_weight_prop") == true) {
            fitBagWeightRecField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_bag_kg) as String,
                4, FitContributor.DATA_TYPE_UINT8,
                {:mesgType => FitContributor.MESG_TYPE_RECORD, :units => "kg"}
            );
            fitBagWeightRecField.setData(bagWeight);

            fitLapBagWeightField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_bag_kg) as String,
                10, FitContributor.DATA_TYPE_UINT8,
                {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "kg"}
            );
            fitLapBagWeightField.setData(bagWeight);
            // ID 18 (Poids du sac SESSION) supprimé v2.2.11 : redondant avec RECORD (ID4)
            // et LAP (ID10) — la valeur est déjà lisible par cycle dans Garmin Connect/Nolio.
        }

        // --- CYCLE (LAP) + SESSION : Allure/vitesse moyenne — v2.2.9 : tentative de créer
        // Standard ET Montagne, allure (STRING) ET vitesse (FLOAT), ensemble (8 champs au lieu
        // de 4) → contributeur direct du crash "Out of memory". Rétabli le branchement sur
        // fitPaceUnitKmh : seule la paire pace-STRING OU la paire speed-FLOAT est créée.
        if (Properties.getValue("fit_avg_pace_speed_prop") == true) {
            if (fitPaceUnitKmh) {
                fitLapVitesseStdField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_speed_std) as String,
                    7, FitContributor.DATA_TYPE_FLOAT,
                    {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "km/h"}
                );
                fitLapVitesseStdField.setData(0.0);
                fitLapVitesseMtnField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_speed_mtn) as String,
                    8, FitContributor.DATA_TYPE_FLOAT,
                    {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "km/h"}
                );
                fitLapVitesseMtnField.setData(0.0);

                fitSesVitesseStdField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_speed_std) as String,
                    14, FitContributor.DATA_TYPE_FLOAT,
                    {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "km/h"}
                );
                fitSesVitesseStdField.setData(0.0);
                fitSesVitesseMtnField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_speed_mtn) as String,
                    15, FitContributor.DATA_TYPE_FLOAT,
                    {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "km/h"}
                );
                fitSesVitesseMtnField.setData(0.0);
            } else {
                fitLapAllureStdField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_pace_std) as String,
                    5, FitContributor.DATA_TYPE_STRING,
                    {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "min/km", :count => 6}
                );
                fitLapAllureStdField.setData(formatPace(0.0));
                fitLapAllureMtnField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_pace_mtn) as String,
                    6, FitContributor.DATA_TYPE_STRING,
                    {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "min/km", :count => 6}
                );
                fitLapAllureMtnField.setData(formatPace(0.0));

                fitSesAllureStdField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_pace_std) as String,
                    12, FitContributor.DATA_TYPE_STRING,
                    {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "min/km", :count => 6}
                );
                fitSesAllureStdField.setData(formatPace(0.0));
                fitSesAllureMtnField = session.createField(
                    WatchUi.loadResource(Rez.Strings.label_fit_avg_pace_mtn) as String,
                    13, FitContributor.DATA_TYPE_STRING,
                    {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "min/km", :count => 6}
                );
                fitSesAllureMtnField.setData(formatPace(0.0));
            }
        }

        // --- CYCLE (LAP) + SESSION : Distance effort ---
        if (Properties.getValue("fit_effort_dist_prop") == true) {
            fitLapDistField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_effort_dist) as String,
                9, FitContributor.DATA_TYPE_FLOAT,
                {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "km"}
            );
            fitLapDistField.setData(0.0);

            fitSesDistField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_effort_dist) as String,
                16, FitContributor.DATA_TYPE_FLOAT,
                {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "km"}
            );
            fitSesDistField.setData(0.0);
        }

        // --- CYCLE (LAP) : VAM moyenne circuit ---
        if (Properties.getValue("fit_vam_lap_prop") == true) {
            fitLapVamField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_lap_vam) as String,
                11, FitContributor.DATA_TYPE_SINT32,
                {:mesgType => FitContributor.MESG_TYPE_LAP, :units => "m/h"}
            );
            fitLapVamField.setData(0);
        }

        // --- SESSION : Coeff température ON/OFF ---
        if (Properties.getValue("fit_temp_coeff_prop") == true) {
            fitSesTempCoeffField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_temp_corr) as String,
                17, FitContributor.DATA_TYPE_STRING,
                {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "", :count => 4}
            );
            fitSesTempCoeffField.setData(tempEnabled ? "ON" : "OFF");
        }

        // --- SESSION : Coefficients montée/descente ---
        if (Properties.getValue("fit_coefficients_prop") == true) {
            fitSesClimbCoeffField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_climb_coeff) as String,
                19, FitContributor.DATA_TYPE_FLOAT,
                {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "m"}
            );
            fitSesClimbCoeffField.setData(climbGradeMKm);
            fitSesDescentCoeffField = session.createField(
                WatchUi.loadResource(Rez.Strings.label_fit_descent_coeff) as String,
                20, FitContributor.DATA_TYPE_FLOAT,
                {:mesgType => FitContributor.MESG_TYPE_SESSION, :units => "m"}
            );
            fitSesDescentCoeffField.setData(descentGradeMKm);
        }
    }

    function updateAllSettings() as Void {
        try {
            var appProps = Toybox.Application.Properties;


            var pCible = appProps.getValue("target_pace_prop");
            if (pCible != null) { TARGET_PACE = pCible.toNumber(); }

            var pMode = appProps.getValue("pace_mode_prop");
            if (pMode != null) {
                paceMode = pMode.toNumber();
                if (paceMode < 0 || paceMode > 2) { paceMode = 1; }
            }

            var savedDark = Application.Properties.getValue("dark_mode_prop");
            isDarkMode = (savedDark == true || savedDark == 1);

            var pBuffer = appProps.getValue("buffer_size_prop");
            if (pBuffer != null) {
                var newSize = pBuffer.toNumber();
                if (newSize < BUFFER_SIZE_MIN) { newSize = BUFFER_SIZE_MIN; }
                if (newSize > BUFFER_SIZE_MAX) { newSize = BUFFER_SIZE_MAX; }
                if (newSize != bufferSize) {
                    bufferSize = newSize;
                    resetBuffers();
                }
            }
            var pVamMode = appProps.getValue("vam_display_mode_prop");
            if (pVamMode != null) {
                vamDisplayMode = pVamMode.toNumber();
                if (vamDisplayMode < 0 || vamDisplayMode > 6) { vamDisplayMode = 0; }
            }

            // 7. Zones VAM (v1.5.0 → v1.8.0)
            var pVamZones = appProps.getValue("vam_zones_enabled_prop");
            if (pVamZones != null) {
            vamZonesEnabled = pVamZones.toNumber();
            if (vamZonesEnabled < 0 || vamZonesEnabled > 3) { vamZonesEnabled = 2; }
            }

            var pZ1 = appProps.getValue("vam_zone1_max");
            if (pZ1 != null) { vamZones[0] = pZ1.toNumber(); }
            var pZ2 = appProps.getValue("vam_zone2_max");
            if (pZ2 != null) { vamZones[1] = pZ2.toNumber(); }
            var pZ3 = appProps.getValue("vam_zone3_max");
            if (pZ3 != null) { vamZones[2] = pZ3.toNumber(); }
            var pZ4 = appProps.getValue("vam_zone4_max");
            if (pZ4 != null) { vamZones[3] = pZ4.toNumber(); }
            var pZ1min = appProps.getValue("vam_zone1_min");
            if (pZ1min != null) { vamZoneMinThreshold = pZ1min.toNumber(); }

            // 8. Colorisation FC (v1.9.2)
            // 0=Off, 1=Valeur, 2=Cercle, 3=Barre, 4=Valeur+Cercle, 5=Valeur+Barre, 6=Cercle+Barre, 7=Tout
            var pHRMode = appProps.getValue("hr_display_mode_prop");
            if (pHRMode != null) {
                var hrMode = pHRMode.toNumber();
                if (hrMode < 0 || hrMode > 7) { hrMode = 7; }
                colorizeHRValue   = (hrMode == 1 || hrMode == 4 || hrMode == 5 || hrMode == 7);
                showHRCircle      = (hrMode == 2 || hrMode == 4 || hrMode == 6 || hrMode == 7);
                showHRZoneBar     = (hrMode == 3 || hrMode == 5 || hrMode == 6 || hrMode == 7);
                colorizeHRZoneBar = showHRZoneBar;
            }

             // 11. Colorisation allure (v1.8.0) — v2.2.4 : 2 réglages indépendants
            var pColorizePaceInst = appProps.getValue("colorize_pace_inst_prop");
            if (pColorizePaceInst != null) {
                colorizePaceInstMode = pColorizePaceInst.toNumber();
                if (colorizePaceInstMode < 0 || colorizePaceInstMode > 3) { colorizePaceInstMode = 2; }
            }
            var pColorizePaceAvg = appProps.getValue("colorize_pace_avg_prop");
            if (pColorizePaceAvg != null) {
                colorizePaceAvgMode = pColorizePaceAvg.toNumber();
                if (colorizePaceAvgMode < 0 || colorizePaceAvgMode > 3) { colorizePaceAvgMode = 3; }
            }
            var pColorizeDPlusDMoins = appProps.getValue("colorize_dplus_dmoins_prop");
            if (pColorizeDPlusDMoins != null) { colorizeDPlusDMoins = (pColorizeDPlusDMoins == true); }

            var pPaceFast = appProps.getValue("pace_fast_threshold_prop");
            if (pPaceFast != null) {
                paceFastThreshold = pPaceFast.toNumber();
                if (paceFastThreshold < 1) { paceFastThreshold = 1; }
                if (paceFastThreshold > 30) { paceFastThreshold = 30; }
            }

            // 12. Alarme (v1.8.0)
            var pAlarmMode = appProps.getValue("alarm");
            if (pAlarmMode != null) {
                alarmMode = pAlarmMode.toNumber();
                if (alarmMode < 0 || alarmMode > 7) { alarmMode = 0; }
            }
            // v1.9.21 OPT 7 : Pré-calculer tests alarmes
            vamAlarmEnabled  = (alarmMode == 1 || alarmMode == 4 || alarmMode == 5 || alarmMode == 7);
            paceAlarmEnabled = (alarmMode == 2 || alarmMode == 4 || alarmMode == 6 || alarmMode == 7);
            fcAlarmEnabled   = (alarmMode == 3 || alarmMode == 5 || alarmMode == 6 || alarmMode == 7);
            var pVamAlarmType = appProps.getValue("vam_alarm_type_prop");
            if (pVamAlarmType != null) {
                vamAlarmType = pVamAlarmType.toNumber();
                if (vamAlarmType < 1) { vamAlarmType = 1; }
                if (vamAlarmType > 3) { vamAlarmType = 3; }
            }
            var pPopupDur = appProps.getValue("alarm_popup_duration_prop");
            alarmPopupDurationSec = (pPopupDur != null) ? pPopupDur.toNumber() : 0;
            alarmEnabled = alarmPopupDurationSec > 0;
            var pDisplayType = appProps.getValue("alarm_display_type_prop");
            alarmDisplayType = (pDisplayType != null) ? pDisplayType.toNumber() : 0;
            // 18. Allure circuit en cours
            var pCurLap = appProps.getValue("cur_lap_pace_prop");
            if (pCurLap != null) { showCurLapPace = pCurLap as Boolean; }
            // v2.2.8 : Menu Circuit — toggles indépendants par donnée
            var pCircuitDD = appProps.getValue("circuit_dplus_dmoins_prop");
            if (pCircuitDD != null) { showCircuitDPlusMoins = (pCircuitDD == true); }
            var pCircuitAllure = appProps.getValue("circuit_allure_prop");
            if (pCircuitAllure != null) { showCircuitAllure = (pCircuitAllure == true); }
            var pCircuitDist = appProps.getValue("circuit_distance_prop");
            if (pCircuitDist != null) { showCircuitDistance = (pCircuitDist == true); }
            var pCircuitChrono = appProps.getValue("circuit_chrono_prop");
            if (pCircuitChrono != null) { showCircuitChrono = (pCircuitChrono == true); }
            // v1.9.36 : Unité allure — affichage montre, modifiable en cours d'activité
            // (réglage on-watch dans le dossier "Propriétés")
            var pPaceUnit = appProps.getValue("pace_unit_prop");
            if (pPaceUnit != null) { paceUnitKmh = (pPaceUnit.toNumber() == 1); }
            // v2.1.3 : Unité allure/vitesse — enregistrement FIT (figée pendant l'activité)
            var pFitPaceUnit = appProps.getValue("fit_pace_unit_prop");
            if (pFitPaceUnit != null) { fitPaceUnitKmh = (pFitPaceUnit.toNumber() == 1); }
            // v1.9.48 : 2nd métrique — 2 slots indépendants
            var pMetricA = appProps.getValue("metric_slot_a_prop");
            if (pMetricA != null) {
                metricSlotA = pMetricA.toNumber();
                if (metricSlotA < 0 || metricSlotA > 7) { metricSlotA = 0; }
            }
            var pMetricB = appProps.getValue("metric_slot_b_prop");
            if (pMetricB != null) {
                metricSlotB = pMetricB.toNumber();
                if (metricSlotB < 0 || metricSlotB > 7) { metricSlotB = 0; }
            }
            // v2.2.5 : Métrique horloge — on/off (autonomie batterie uniquement)
            var pClockMetricEnabled = appProps.getValue("clock_metric_enabled_prop");
            if (pClockMetricEnabled != null) { showClockAutonomy = pClockMetricEnabled as Boolean; }
            var pShowClock = appProps.getValue("show_clock_prop");
            if (pShowClock != null) { showClock = pShowClock as Boolean; }
            // 14-17. Facteurs allure effort (v1.9.4)
            var pTempEnabled = appProps.getValue("temp_enabled_prop");
            if (pTempEnabled != null) { tempEnabled = pTempEnabled as Boolean; }
            var pSolarEnabled = appProps.getValue("solar_enabled_prop");
            if (pSolarEnabled != null) { solarEnabled = pSolarEnabled as Boolean; }
            var pBagWeight = appProps.getValue("bag_weight_prop");
            if (pBagWeight != null) {
                var w = pBagWeight.toNumber();
                bagWeight = (w != null && w > 0) ? w : 0;
            }
            var pClimbGradeMKm = appProps.getValue("climb_grade_mkm_prop");
            if (pClimbGradeMKm != null && pClimbGradeMKm > 0) { climbGradeMKm = pClimbGradeMKm.toFloat(); }
            var pDescentGradeMKm = appProps.getValue("descent_grade_mkm_prop");
            if (pDescentGradeMKm != null && pDescentGradeMKm > 0) { descentGradeMKm = pDescentGradeMKm.toFloat(); }

            // 14. Distance to (v1.9.0)
            var pDistTo = appProps.getValue("dist_to_type_prop");
            if (pDistTo != null) {
                distToType = pDistTo.toNumber();
                if (distToType < 0) { distToType = 0; }
                if (distToType > 3) { distToType = 3; }
            }

            // Affichage batterie (0=Appareil, 1=Body Battery)
            var pBatDisp = appProps.getValue("battery_display_prop");
            if (pBatDisp != null) { batteryDisplayMode = pBatDisp.toNumber(); }

            // Valeurs dérivées pré-calculées (mis à jour une seule fois après lecture des settings)
            var bagWeightMode = 0;
            var pBagMode = appProps.getValue("bag_weight_mode_prop");
            if (pBagMode != null) { bagWeightMode = pBagMode.toNumber(); }

            if (bagWeightMode == 1) {
                var bodyKg = 70.0f;  // fallback si profil incomplet/aberrant
                var profile = UserProfile.getProfile();
                if (profile != null && profile.weight != null) {
                    var w = profile.weight.toFloat() / 1000.0f;  // grammes -> kg
                    if (w >= 30.0f) { bodyKg = w; }
                }
                bagFactor = 1.0f + (bagWeight.toFloat() / bodyKg);
            } else {
                bagFactor = 1.0f + bagWeight * 0.01f;  // comportement forfaitaire inchangé
            }
            // v2.4.0 : VC et bornes des zones (réglables sur la montre / le téléphone, ou
            // synchronisées depuis Trail Planner — voir TrailSync.mc)
            var pCs = appProps.getValue("cs_pace_prop");
            if (pCs != null && pCs.toNumber() != null && pCs.toNumber() > 0) { csPaceSec = pCs.toNumber().toFloat(); }
            vcBounds = parseVcBounds(appProps.getValue("vc_zones_prop"));
            // v2.7.0 : cible d'allure — brute, zone VC ou % de VC ; même colorisation et même
            // alarme dans les trois cas (voir getPaceColor() et l'alarme allure de compute()).
            var pRef = appProps.getValue("pace_ref_prop");
            paceRef = (pRef != null && pRef.toNumber() != null) ? pRef.toNumber() : 0;
            // Zone cible commune (Z1-Z5) : allure en référence Zone VC, et toujours alarmes FC et VAM.
            var pZone = appProps.getValue("vc_target_zone_prop");
            if (pZone != null && pZone.toNumber() != null) { vcTargetZone = pZone.toNumber(); }
            if (vcTargetZone > 5) { vcTargetZone = 5; }
            if (vcTargetZone > vcBounds.size() - 1) { vcTargetZone = vcBounds.size() - 1; }
            if (vcTargetZone < 1) { vcTargetZone = 1; }
            var pPct = appProps.getValue("vc_target_pct_prop");
            if (pPct != null && pPct.toNumber() != null) { vcTargetPct = pPct.toNumber(); }
            if (vcTargetPct < 30) { vcTargetPct = 30; }
            if (vcTargetPct > 150) { vcTargetPct = 150; }
            targetPace = TARGET_PACE.toFloat();
            if (paceRef == 1 && csPaceSec > 0.0f) {
                // Zone VC : la cible couvre la zone — allure la plus lente = borne basse,
                // seuil rapide = borne haute (au-delà : orange et alarme, comme l'allure cible).
                targetPace    = csPaceSec / vcBounds[vcTargetZone - 1];
                fastPaceLimit = csPaceSec / vcBounds[vcTargetZone];
            } else {
                if (paceRef == 2 && csPaceSec > 0.0f) { targetPace = csPaceSec * 100.0f / vcTargetPct; }
                fastPaceLimit = targetPace * (100.0f - paceFastThreshold) / 100.0f;
            }

        } catch (e) {
            System.println("Erreur Sync : " + e.getErrorMessage());
        }
    }

    // v1.9.36 : Persistance état laps (survit au rechargement du DataField lors d'un settings change)
    private function saveLapState() as Void {
        Application.Storage.setValue("lc",   lapCount);
        Application.Storage.setValue("lsd",  lapStartDist);
        Application.Storage.setValue("lst",  lapStartTime);
        Application.Storage.setValue("lsa",  lapStartAscent);
        Application.Storage.setValue("lsde", lapStartDescent);
        Application.Storage.setValue("lsed", lapStartEffortDist);
    }

    function onSettingsChanged() as Void {
        updateAllSettings();
        WatchUi.requestUpdate();
    }

    function onTimerReset() as Void {
        Application.Storage.deleteValue("lc");
        Application.Storage.deleteValue("lsd");
        Application.Storage.deleteValue("lst");
        Application.Storage.deleteValue("lsa");
        Application.Storage.deleteValue("lsde");
        Application.Storage.deleteValue("lsed");
        lapCount            = 1;
        lapCountStr         = "1";
        lapPressed          = false;
        lapStartInitialized = false;
        curLapAscent        = 0.0f;
        curLapDescent       = 0.0f;
    }

    // --- Allure circuit en cours : signale un reset à appliquer au prochain compute() ---
    // Historique : on ne lisait pas Activity.getActivityInfo() ici car sur montre réelle les
    // données pouvaient être périmées au moment exact du callback — le reset était appliqué
    // uniquement dans compute() avec le info frais passé en paramètre (jusqu'à ~1s de décalage
    // avec l'appui réel sur Lap, cause probable du bug d'écart de chrono vs écran natif).
    // v2.2.10 : Bug B — tentative de capture ICI via captureLapTriggerTiming(), entièrement
    // défensive (voir déclaration des lapTriggerCaptured* plus haut) : si la lecture échoue ou
    // est incomplète, les variables restent `null` et compute() retombe exactement sur l'ancien
    // comportement. À CONFIRMER SUR DEVICE RÉEL — c'est justement le risque documenté ci-dessus
    // que ce garde-fou est censé neutraliser si l'hypothèse "données périmées" se vérifie.
    // v2.2.7 : chemin de repli pour les firmwares < 5.2.2 (onTimerLap2 non appelé)
    function onTimerLap() as Void {
        captureLapTriggerTiming();
        lapTriggerPending = true;
    }

    // v2.2.7 : variante API 5.2.2 — fournit le type de déclencheur du tour.
    // Renvoyer true = événement traité, onTimerLap() ne sera pas appelé en plus.
    function onTimerLap2(trigger) as Boolean {
        var t = trigger[:lapTrigger];
        // 7 = LAP_TRIGGER_SESSION_END : fin d'activité, aucun nouveau circuit ne démarre
        if (t != null && t == 7) { return true; }
        captureLapTriggerTiming();
        lapTriggerPending = true;
        return true;
    }

    // v2.2.10 : Bug B — capture défensive de l'horodatage/distance/D+/D- au moment exact du
    // callback lap. Toute exception ou champ manquant laisse les lapTriggerCaptured* à `null`
    // (état déjà garanti par compute() qui les remet à null après usage) : aucune régression
    // possible, compute() utilise alors le info du tick suivant comme avant v2.2.10.
    private function captureLapTriggerTiming() as Void {
        try {
            var capInfo = Activity.getActivityInfo();
            if (capInfo != null && capInfo.timerTime != null && capInfo.elapsedDistance != null) {
                lapTriggerCapturedTime    = capInfo.timerTime.toFloat() / 1000.0f;
                lapTriggerCapturedDist    = capInfo.elapsedDistance.toFloat();
                lapTriggerCapturedAscent  = (capInfo.totalAscent  != null) ? capInfo.totalAscent.toFloat()  : null;
                lapTriggerCapturedDescent = (capInfo.totalDescent != null) ? capInfo.totalDescent.toFloat() : null;
            }
        } catch (e) {
            // défensif : ne jamais faire planter le callback lap sur une lecture périmée/absente
        }
    }

    // Démarrage de l'activité — circuit 1 actif dès le départ
    // timerTime == 0 → nouvelle activité (même après save sans reset)
    // timerTime > 0  → reprise après pause ou rechargement DataField (settings change)
    function onTimerStart() as Void {
        var actInfo = Activity.getActivityInfo();
        var isNewActivity = (actInfo == null || actInfo.timerTime == null || actInfo.timerTime == 0);
        if (isNewActivity) {
            lapCount            = 1;
            lapCountStr         = "1";
            lapPressed          = false;
            lapStartInitialized = false;
            curLapAscent        = 0.0f;
            curLapDescent       = 0.0f;
            Application.Storage.deleteValue("lc");
            Application.Storage.deleteValue("lsd");
            Application.Storage.deleteValue("lst");
            Application.Storage.deleteValue("lsa");
            Application.Storage.deleteValue("lsde");
            Application.Storage.deleteValue("lsed");
        }
        if (!lapPressed) {
            lapPressed = true;
        }
    }

    // Fin d'une étape ou d'un entrainement structuré — nouveau circuit automatique
    function onWorkoutStepComplete() as Void {
        lapTriggerPending = true;
    }


    // v1.8.0 : Zone VAM (couleur selon currentVam) — extraite pour être réutilisable par le
    // mode "Police" (drawVamValue) en plus du mode Barre/Fond (drawVamZoneBar).
    private function vamZoneColor() as Number {
        if (currentVam < vamZones[0]) { return themed(Graphics.COLOR_LT_GRAY, Graphics.COLOR_DK_GRAY); }
        if (currentVam < vamZones[1]) { return themed(Graphics.COLOR_BLUE, Graphics.COLOR_DK_BLUE); }
        if (currentVam < vamZones[2]) { return themed(Graphics.COLOR_GREEN, Graphics.COLOR_DK_GREEN); }
        if (currentVam < vamZones[3]) { return Graphics.COLOR_ORANGE; }
        return Graphics.COLOR_RED;
    }

    // v2.2.4 : Rectangle de zone partagé (Barre 5px / Fond 100px) — utilisé par VAM et par
    // l'allure/vitesse instantanée et moyenne. mode : 1=Barre, 2=Fond.
    private function drawZoneRect(dc, y as Number, color as Number, mode as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        var rectW = (mode == 1) ? layout.zoneRectBarW : layout.zoneRectBgW;
        dc.fillRectangle(layout.zoneRectX, y - layout.zoneRectH, rectW, layout.zoneRectH);
    }


    // v1.8.0 : Barre VAM avec modes d'affichage Barre/Fond (Police géré dans drawVamValue)
    private function drawVamZoneBar(dc) as Void {
    if ((vamZonesEnabled != 1 && vamZonesEnabled != 2) || currentVam <= 0 || currentVam < vamZoneMinThreshold) { return; }
    drawZoneRect(dc, layout.zoneRectTopY, vamZoneColor(), vamZonesEnabled);
    }


    // v2.4.0 : "60,70,80,88,96,105,115,150" (% de VC) → bornes croissantes en fraction de VC.
    // Valeur absente ou invalide → zones du bilan VC par défaut.
    private function parseVcBounds(raw) as Array<Float> {
        var out = [] as Array<Float>;
        if (raw instanceof String) {
            var rest = raw as String;
            while (rest.length() > 0 && out.size() < 8) {
                var j = rest.find(",");
                var part = (j == null) ? rest : rest.substring(0, j as Number) as String;
                var v = part.toFloat();
                if (v == null || v <= 0.0f || (out.size() > 0 && v / 100.0f <= out[out.size() - 1])) {
                    out = [] as Array<Float>;
                    break;
                }
                out.add(v / 100.0f);
                if (j == null) { break; }
                rest = rest.substring((j as Number) + 1, rest.length()) as String;
            }
        }
        if (out.size() < 2) {
            out = [0.60f, 0.70f, 0.80f, 0.88f, 0.96f, 1.05f, 1.15f, 1.50f] as Array<Float>;
        }
        return out;
    }

    // v1.8.0 : Colorisation allure unifiée (1 seule fonction = économie de stack)
    // Calcule toujours la couleur sémantique (vert si cible atteinte, orange si trop rapide) ;
    // c'est à l'appelant de décider s'il l'applique (Police/Barre/Fond) selon son propre mode.
    // v2.7.0 : la cible peut venir de la VC (zone ou %), les couleurs restent les mêmes.
    private function getPaceColor(pace as Float, defColor as Number) as Number {
        if (pace <= 0 || pace > 3600) { return defColor; }
        if (pace < fastPaceLimit)  { return Graphics.COLOR_ORANGE; }
        if (pace <= targetPace)    { return themed(Graphics.COLOR_GREEN, Graphics.COLOR_DK_GREEN); }
        return defColor;
    }

    function compute(info as Activity.Info) as Void {
    updateBuffers(info);

    // --- LAP TRIGGER : traité en priorité, avant tout early return ---
    // Sur montre réelle, altitude peut être null au moment du Lap → on doit traiter le flag ici
    // Pas de guard timerState : lapTriggerPending n'est jamais mis à true par un callback de pause,
    // donc inutile — et un guard bloquerait le circuit en fin d'entraînement (timer STOPPED).
    if (info != null && lapTriggerPending) {
        // v2.2.10 : Bug C — commiter les valeurs FINALES du circuit qui se termine AVANT de les
        // écraser pour le nouveau circuit. Avant ce fix, updateLapFitData() n'était appelé
        // qu'après ce bloc (dans "if (lapPressed)" plus bas, exécuté au même tick) : à ce
        // moment-là curLapPaceStd/Mtn valaient déjà 0.0 (remis à zéro ci-dessous) et
        // formatPace(0.0) renvoie littéralement "--:--" — d'où les colonnes Avg Pace Std./Mtn.
        // vides dans le tableau des circuits Garmin Connect. lapPressed est déjà vrai dès
        // onTimerStart() donc ce premier appel utilise encore les valeurs du circuit qui se
        // termine (pas encore réinitialisées) — voir updateLapFitData().
        if (lapPressed) { updateLapFitData(info); }

        // v2.2.10 : Bug B — utiliser l'horodatage/distance/D+/D- capturés au moment du callback
        // (plus proches de l'appui réel sur Lap) s'ils sont disponibles ; sinon repli identique
        // au comportement pré-v2.2.10 (valeurs du `info` de ce compute(), potentiellement à
        // ~1s de décalage). Voir captureLapTriggerTiming() pour le détail du garde-fou.
        lapStartDist    = (lapTriggerCapturedDist != null) ? lapTriggerCapturedDist
                          : ((info.elapsedDistance != null) ? info.elapsedDistance.toFloat() : 0.0f);
        lapStartTime    = (lapTriggerCapturedTime != null) ? lapTriggerCapturedTime
                          : ((info.timerTime       != null) ? info.timerTime.toFloat() / 1000.0f : 0.0f);
        lapStartAscent  = (lapTriggerCapturedAscent != null) ? lapTriggerCapturedAscent
                          : ((info.totalAscent  != null) ? info.totalAscent.toFloat()  : 0.0f);
        lapStartDescent = (lapTriggerCapturedDescent != null) ? lapTriggerCapturedDescent
                          : ((info.totalDescent != null) ? info.totalDescent.toFloat() : 0.0f);
        lapTriggerCapturedTime    = null;
        lapTriggerCapturedDist    = null;
        lapTriggerCapturedAscent  = null;
        lapTriggerCapturedDescent = null;
        lapStartEffortDist = effortDistanceAccum;
        curLapFlatPace  = 0.0f;
        curLapPaceStd   = 0.0f;
        curLapPaceMtn   = 0.0f;
        curLapDist      = 0.0f;
        curLapTime      = 0.0f;
        curLapAvgVam    = 0.0f;
        curLapEffortDist = 0.0f;
        curLapAscent    = 0.0f;
        curLapDescent   = 0.0f;
        lapCount++;
        lapCountStr     = lapCount.toString();
        lapPressed      = true;
        lapTriggerPending = false;
        saveLapState();
    }

    if (info == null || info.altitude == null) { return; }

    var curAlt = info.altitude.toFloat();
    var oldAlt = altBuffer[bufferIdx];

    var timeRange = isBufferFull ? bufferSize : bufferIdx;
    if (timeRange < 1) { timeRange = 1; }

    // --- VAM (toujours, même avant START) ---
    var diffAlt = curAlt - oldAlt;
    var timeRangeF = timeRange.toFloat();
    var rawVam = diffAlt * (3600.0f / timeRangeF);
    if (rawVam > 50000.0f || rawVam < -50000.0f) { rawVam = vamSmoothed; }
    vamSmoothed = VAM_EMA_ALPHA * rawVam + (1.0f - VAM_EMA_ALPHA) * vamSmoothed;
    var roundedVam = (Math.round(vamSmoothed / 50.0) * 50).toNumber();
    if ((roundedVam - currentVam).abs() >= 50) { currentVam = roundedVam; }

    // --- ALLURES INSTANTANÉES ---
    var curDist = (info.elapsedDistance != null) ? info.elapsedDistance.toFloat() : 0.0f;
    var diffDist = curDist - distBuffer[bufferIdx];
    if (diffDist < 0.0f) { diffDist = 0.0f; }

    if (distInitialized && diffDist > 0.5f && distBufferAge < bufferSize) { distBufferAge++; }
    var distTimeRange = (distInitialized && distBufferAge > 0 && distBufferAge < bufferSize)
        ? distBufferAge : timeRange;

    // Altitude effort pré-calculée (commune aux 2 branches)
    var paceAlt = roundedVam.toFloat() * timeRangeF / 3600.0f;
    var gain  = (paceAlt > 0.0f) ? paceAlt : 0.0f;
    var perte = (paceAlt < 0.0f) ? -paceAlt : 0.0f;

if (diffDist > 0.5f) {
    var basePace = distTimeRange.toFloat() / (diffDist / 1000.0f);
    var elevStd = 1.0f + (gain * 1000.0f) / (climbGradeMKm * diffDist);
    curElevStd = elevStd;  // v1.9.35 : sauvegarder pour distance effort
    var elevMtn = elevStd + (perte * 1000.0f) / (descentGradeMKm * diffDist);

    curFlatPace = basePace / tempFactor;
    curEffortPaceStd = basePace / (elevStd * bagFactor * tempFactor);
    curEffortPaceMtn = basePace / (elevMtn * bagFactor * tempFactor);

    if (curFlatPace > 3600.0f) { curFlatPace = 0.0f; }
    if (curEffortPaceStd > 3600.0f) { curEffortPaceStd = 0.0f; }
    if (curEffortPaceMtn > 3600.0f) { curEffortPaceMtn = 0.0f; }
} else if (info.currentSpeed != null && info.currentSpeed > 0.5f) {
    var speedMs = info.currentSpeed.toFloat();
    var basePace = 1000.0f / speedMs;
    var speedDist = speedMs * timeRangeF;
    var elevStd = (speedDist > 0.0f) ? 1.0f + (gain * 1000.0f) / (climbGradeMKm * speedDist) : 1.0f;
    var elevMtn = (speedDist > 0.0f) ? elevStd + (perte * 1000.0f) / (descentGradeMKm * speedDist) : elevStd;

    curFlatPace = basePace / tempFactor;
    curEffortPaceStd = basePace / (elevStd * bagFactor * tempFactor);
    curEffortPaceMtn = basePace / (elevMtn * bagFactor * tempFactor);

    if (curFlatPace > 3600.0f) { curFlatPace = 0.0f; }
    if (curEffortPaceStd > 3600.0f) { curEffortPaceStd = 0.0f; }
    if (curEffortPaceMtn > 3600.0f) { curEffortPaceMtn = 0.0f; }
} else {
    curFlatPace = 0.0f;
    curEffortPaceStd = 0.0f;
    curEffortPaceMtn = 0.0f;
}

    // Arrondi à 5 s + hystérésis + intervalle de rafraîchissement
    paceUpdateCounter++;
    if (paceUpdateCounter >= PACE_UPDATE_INTERVAL) {
        paceUpdateCounter = 0;
        var newFlat = (curFlatPace > 0.0f) ? (Math.round(curFlatPace / 5.0) * 5).toFloat() : 0.0f;
        var newStd  = (curEffortPaceStd > 0.0f) ? (Math.round(curEffortPaceStd / 5.0) * 5).toFloat() : 0.0f;
        var newMtn  = (curEffortPaceMtn > 0.0f) ? (Math.round(curEffortPaceMtn / 5.0) * 5).toFloat() : 0.0f;
        if ((newFlat - dispFlatPace).abs() >= 10.0f) { dispFlatPace = newFlat; }
        if ((newStd  - dispEffortPaceStd).abs() >= 10.0f) { dispEffortPaceStd = newStd; }
        if ((newMtn  - dispEffortPaceMtn).abs() >= 10.0f) { dispEffortPaceMtn = newMtn; }
    }

    // --- BATTERIE : lecture toutes les 60 s (avant guard timer) ---
    batteryTick++;
    if (batteryTick >= 60) {
        batteryTick = 0;
        var stats = System.getSystemStats();
        batteryCache = stats.battery;
        var days = stats.batteryInDays;
        batteryAutonomyH = (days != null && days > 0) ? (days * 24).toNumber() : -1;
        // Body Battery : lecture si utilisée par l'affichage principal ou par un slot de métrique secondaire
        if ((batteryDisplayMode == 1 || metricSlotA == 4 || metricSlotB == 4)
            && (SensorHistory has :getBodyBatteryHistory)) {
            var it = SensorHistory.getBodyBatteryHistory({:period => 1});
            var sample = it.next();
            if (sample != null && sample.data != null) {
                bodyBatteryCache = sample.data.toNumber();
            }
        }
    }

    // --- FACTEUR TEMPÉRATURE : recalcul toutes les 30 s (avant guard timer) ---
    tempTick++;
    if (tempTick >= 30) {
        tempTick = 0;
        tempFactor = 1.0f;
        // Lecture température : Weather (précis) > Tempe externe > SensorHistory interne
        var rawTemp = null;
        if (Toybox has :Weather) {
            var wx = Weather.getCurrentConditions();
            if (wx != null && wx.temperature != null) {
                rawTemp = wx.temperature;
                currentHumidity = (wx has :relativeHumidity && wx.relativeHumidity != null) ? wx.relativeHumidity : -1;
            }
        }
        if (rawTemp == null) {
            currentHumidity = -1;
            if (info has :currentTemperature) { rawTemp = info.currentTemperature; }
            if (rawTemp == null) { rawTemp = readInternalTemp(); }
        }
        currentSolar = -1;
        if (solarEnabled && (System has :getSystemStats)) {
            var stats = System.getSystemStats();
            if (stats has :solarIntensity && stats.solarIntensity != null) {
                currentSolar = stats.solarIntensity;
            }
        }
        if (rawTemp != null) {
            var t = rawTemp.toFloat();
            currentTempC = t.toNumber();
            if (tempEnabled) {
                tempFactor = computeThermoFactor(t, currentHumidity, currentSolar);
            }
        }
    }

    // --- Tout le reste : uniquement timer actif ---
    if (info.timerState != Activity.TIMER_STATE_ON) { return; }

    // --- % INCLINAISON ---
    if (diffDist > 1.0f) {
        currentGrade = (diffAlt / diffDist) * 100.0f;
        if (currentGrade > 100.0f) { currentGrade = 100.0f; }
        if (currentGrade < -100.0f) { currentGrade = -100.0f; }
    }

    // --- v1.9.35 : DISTANCE EFFORT INCRÉMENTALE ---
    if (curDist > prevDistEffort && curDist > 10.0f) {
        var distSegment = curDist - prevDistEffort;
        var K_inst = curElevStd * bagFactor * tempFactor;
        effortDistanceAccum += (distSegment / 1000.0f) * K_inst;
        prevDistEffort = curDist;
    }

    // --- ALARME ---
    if (alarmMode != 0) {
        if (globalAlarmCooldown > 0) { globalAlarmCooldown--; }
        if (alarmPopupTicks > 0) { alarmPopupTicks--; }

        // v2.2.11 : entraînement structuré en cours (paliers programmés sur la montre)
        // → alarmes EnduranceApp coupées, Garmin gère déjà ses propres alertes de palier.
        var workoutStepActive = false;
        if ((Activity has :getCurrentWorkoutStep) && (Activity.getCurrentWorkoutStep() != null)) {
            workoutStepActive = true;
        }

        if (!workoutStepActive) {
            // VAM : au-dessus de la zone cible (borne haute de Z1-Z4 ; Z5 n'a pas de borne haute,
            // donc pas d'alarme VAM en Z5). Déclenchement immédiat puis rappel toutes les ALARM_REPEAT sec.
            if (vamAlarmEnabled && vcTargetZone <= 4) {
                if (currentVam >= vamZones[vcTargetZone - 1]) {
                    if (globalAlarmCooldown == 0) { if (alarmEnabled) { showAlarmVisual(NOTIF_VAM, currentVam.toNumber().toString(), "VAM " + currentVam.toNumber().toString() + " " + (WatchUi.loadResource(Rez.Strings.unite_m_h) as String)); triggerAlarm(); } globalAlarmCooldown = ALARM_REPEAT; }
                }
            }

            if (paceAlarmEnabled && targetPace > 0.0f && curFlatPace > 0.0f) {
                // Allure cible : délai PACE_ALARM_DELAY sec avant 1ère alarme, puis rappel toutes les ALARM_REPEAT sec
                // v2.7.0 : seuil = fastPaceLimit (cible brute, zone VC ou % de VC)
                var paceThreshold = fastPaceLimit;
                if (curFlatPace < paceThreshold) {
                    paceAlarmDelay++;
                    if (paceAlarmDelay >= PACE_ALARM_DELAY && globalAlarmCooldown == 0) { if (alarmEnabled) { var dispP = (paceMode == 2) ? dispEffortPaceMtn : (paceMode == 1) ? dispEffortPaceStd : dispFlatPace; var paceUnitSuffix = paceUnitKmh ? (" " + (WatchUi.loadResource(Rez.Strings.unite_km_h) as String)) : ""; var paceDisp = formatDisp(dispP); showAlarmVisual(NOTIF_PACE, paceDisp, alarmPaceLabel() + " " + paceDisp + paceUnitSuffix); triggerAlarm(); } globalAlarmCooldown = ALARM_REPEAT; }
                } else { paceAlarmDelay = 0; }
            }

            // FC : au-dessus de la zone cible (borne haute de la zone dans les zones FC Garmin de la
            // course ; Z5 = FC max). Déclenchement immédiat puis rappel toutes les ALARM_REPEAT sec.
            if (fcAlarmEnabled) {
                var hr = (info.currentHeartRate != null) ? info.currentHeartRate : 0;
                if (hr > 0) {
                    var hrZonesA = hrZonesCache;
                    var fcThreshold = (hrZonesA != null && hrZonesA.size() > vcTargetZone) ? hrZonesA[vcTargetZone] : 0;
                    if (fcThreshold > 0 && hr >= fcThreshold && globalAlarmCooldown == 0) { if (alarmEnabled) { showAlarmVisual(NOTIF_HR, hr.toString(), (WatchUi.loadResource(Rez.Strings.opt_alarm_hr) as String) + " " + hr.toString() + " bpm"); triggerAlarm(); } globalAlarmCooldown = ALARM_REPEAT; }
                }
            }
        }
    }

    // --- MOYENNES + FIT ---
    if (info.timerTime == null || info.timerTime <= 0) { return; }

    var totalDPlus = (info.totalAscent != null) ? info.totalAscent.toFloat() : 0.0f;
    var totalDMoins = (info.totalDescent != null) ? info.totalDescent.toFloat() : 0.0f;
    var totalDistKM = curDist / 1000.0f;
    var timerSec = info.timerTime / 1000.0f;

    if (totalDistKM > 0.01f) {
    var bap = timerSec / totalDistKM;
    var eStd = 1.0f + (totalDPlus * 1000.0f) / (climbGradeMKm * curDist);
    var eMtn = eStd + (totalDMoins * 1000.0f) / (descentGradeMKm * curDist);

    avgFlatPace = bap / tempFactor;
    avgPaceStd  = bap / (eStd * bagFactor * tempFactor);
    avgPaceMtn  = bap / (eMtn * bagFactor * tempFactor);

    // v1.9.28 : Baseline fatigue (allure moyenne premiers 10 min)
    if (!baselineInitialized && timerSec >= 600.0f && totalDistKM >= 1.0f) {
        baselinePace = (paceMode == 2) ? avgPaceMtn : (paceMode == 1) ? avgPaceStd : avgFlatPace;
        baselineInitialized = true;
    }
}

    // --- ALLURE CIRCUIT EN COURS : calcul temps réel ---
    if (!lapStartInitialized && curDist > 0.0f) {
        lapStartDist        = curDist;
        lapStartTime        = timerSec;
        lapStartAscent      = (info.totalAscent  != null) ? info.totalAscent.toFloat()  : 0.0f;
        lapStartDescent     = (info.totalDescent != null) ? info.totalDescent.toFloat() : 0.0f;
        lapStartEffortDist  = effortDistanceAccum;
        lapStartInitialized = true;
        saveLapState();
    }
    if (lapPressed) {
        // v2.2.7 : Chrono circuit basé sur le timer Garmin — se fige pendant les pauses,
        // comme l'allure et la VAM du circuit (mêmes deltas, même source)
        var lTime = timerSec - lapStartTime;
        if (lTime < 0.0f) { lTime = 0.0f; }
        curLapTime = lTime;

        // v2.1.2 : Distance effort du circuit en cours (ID 9 FIT) — indépendant du seuil
        // lDist > 10.0f ci-dessous, mis à jour dès que le circuit est actif
        curLapEffortDist = effortDistanceAccum - lapStartEffortDist;
        if (curLapEffortDist < 0.0f) { curLapEffortDist = 0.0f; }

        // v2.2.7 : D+/D- du circuit — hors du seuil lDist ci-dessous, valides dès le départ
        curLapAscent  = ((info.totalAscent  != null) ? info.totalAscent.toFloat()  : 0.0f) - lapStartAscent;
        curLapDescent = ((info.totalDescent != null) ? info.totalDescent.toFloat() : 0.0f) - lapStartDescent;
        if (curLapAscent  < 0.0f) { curLapAscent  = 0.0f; }
        if (curLapDescent < 0.0f) { curLapDescent = 0.0f; }

        var lDist = curDist - lapStartDist;
        if (lDist > 10.0f && lTime > 0.0f) {
            var bap  = lTime / (lDist / 1000.0f);
            var eStd = 1.0f + (curLapAscent * 1000.0f) / (climbGradeMKm * lDist);
            var eMtn = eStd + (curLapDescent * 1000.0f) / (descentGradeMKm * lDist);
            curLapFlatPace = bap / tempFactor;
            curLapPaceStd  = bap / (eStd * bagFactor * tempFactor);
            curLapPaceMtn  = bap / (eMtn * bagFactor * tempFactor);
            if (curLapFlatPace > 3600.0f) { curLapFlatPace = 0.0f; }
            if (curLapPaceStd  > 3600.0f) { curLapPaceStd  = 0.0f; }
            if (curLapPaceMtn  > 3600.0f) { curLapPaceMtn  = 0.0f; }
            curLapDist   = lDist;
            curLapAvgVam = (curLapAscent >= curLapDescent)
                ? ( curLapAscent / lTime) * 3600.0f
                : (-curLapDescent / lTime) * 3600.0f;
        }
        // v1.9.27 : Mise à jour CONTINUE des champs FIT LAP — setData() doit précéder onTimerLap()
        updateLapFitData(info);
    }


    // --- FIT RECORD + SESSION (IDs 1-4, 12-20 — voir updateLapFitData() pour les IDs 5-11) ---
    // v2.1.3 : le toggle global fit_enabled_prop est retiré — redondant avec les 8 toggles
    // dédiés (un par groupe de champs) qui gardent déjà chaque .setData() via `!= null`.
    // v1.9.28 : Lecture calories — indépendante du FIT, alimente aussi la 2nd métrique à l'écran
    totalCalories = (info.calories != null) ? info.calories : 0;

    // v2.1.2 : filet de sécurité — toute exception FIT ne doit plus jamais planter tout le
    // datafield (écran blanc "IQ"), seulement sauter la mise à jour FIT de ce tick.
    try {
        if (paceMode != 0) {
            var curPaceSec = (paceMode == 2) ? curEffortPaceMtn : curEffortPaceStd;
            // v2.2.9 : IDs 1 et 2 toujours actifs ensemble (FLOAT décimal min/km + FLOAT km/h) —
            // ID 1 ne peut pas passer en STRING (mm:ss) : RECORD n'accepte pas ce type (crash).
            if (fitAllureEffortField  != null) { fitAllureEffortField.setData(curPaceSec > 0 ? curPaceSec / 60.0 : 0.0); }
            if (fitVitesseEffortField != null) { fitVitesseEffortField.setData(curPaceSec > 0 ? 3600.0/curPaceSec : 0.0); }
        }
        // ID 3 : correction combinée température + poids du sac appliquée (%)
        if (fitTempBagCorrField != null) { fitTempBagCorrField.setData(((tempFactor * bagFactor) - 1.0) * 100.0); }

        // IDs 12-15 : allure/vitesse moyenne SESSION (Standard + Montagne, unité figée à la création)
        if (fitSesAllureStdField  != null) { fitSesAllureStdField.setData(formatPace(avgPaceStd)); }
        if (fitSesAllureMtnField  != null) { fitSesAllureMtnField.setData(formatPace(avgPaceMtn)); }
        if (fitSesVitesseStdField != null) { fitSesVitesseStdField.setData(avgPaceStd > 0 ? 3600.0 / avgPaceStd : 0.0); }
        if (fitSesVitesseMtnField != null) { fitSesVitesseMtnField.setData(avgPaceMtn > 0 ? 3600.0 / avgPaceMtn : 0.0); }

        // Données peu variables : mise à jour périodique uniquement (économie batterie)
        if (batteryTick == 0) {
            if (fitSesTempCoeffField    != null) { fitSesTempCoeffField.setData(tempEnabled ? "ON" : "OFF"); }
            if (fitBagWeightRecField    != null) { fitBagWeightRecField.setData(bagWeight); }
            if (fitSesClimbCoeffField   != null) { fitSesClimbCoeffField.setData(climbGradeMKm); }
            if (fitSesDescentCoeffField != null) { fitSesDescentCoeffField.setData(descentGradeMKm); }
        }
        // ID 16 : distance effort SESSION (mise à jour continue)
        if (fitSesDistField != null && effortDistanceAccum > 0.0f) {
            fitSesDistField.setData(effortDistanceAccum);
        }
    } catch (e) {
        System.println("Erreur FIT pace/vitesse : " + e.getErrorMessage());
    }
    }



    function onLayout(dc as Dc) as Void {
        paceIcons = WatchUi.loadResource(Rez.Fonts.EnduranceIconsPace);
        iconsMed = WatchUi.loadResource(Rez.Fonts.EnduranceIconsMed);
        paramIcons = WatchUi.loadResource(Rez.Fonts.EnduranceIconsParam);
        notifIcons = WatchUi.loadResource(Rez.Fonts.EnduranceIconsNotif);
        if (SHOW_CALIBRATION_GUIDE) {
            bgIcon = WatchUi.loadResource(Rez.Drawables.BgIcon);
        }
        layout.update();
        var w = dc.getWidth();
        var h = dc.getHeight();
        screenW = w;  screenH = h;
        centerX = w / 2;  centerY = h / 2;
        // Positions Y fixes
        yDist  = layout.DistY;
        yTimer = layout.TimerY;
        // Largeurs d'icônes constantes
        iconLapW   = dc.getTextWidthInPixels(ICON_LAP,      iconsMed);
        iconLapXLW = dc.getTextWidthInPixels(ICON_LAP_XL,   notifIcons);
        iconFlagW  = dc.getTextWidthInPixels(ICON_FLAG,     iconsMed);
        iconWaypW  = dc.getTextWidthInPixels(ICON_WAYPOINT, iconsMed);
        labelKmW   = dc.getTextWidthInPixels("km",          layout.fontSmall);
    }




    // Appli : horloge et phases d'alternance de la trame (début d'onUpdate d'EP, partagé avec drawBands).
    function prepareFrame() as Void {
        // Horloge + phase alternance (1 seul appel système par frame)
        var clockNow = System.getClockTime();
        clockSec = clockNow.sec;
        clockDiv5 = clockSec / 5;
        if (clockNow.min != cachedClockMin) {
            cachedClockMin = clockNow.min;
            cachedClockStr = clockNow.hour.format("%02d") + ":" + clockNow.min.format("%02d");
        }
        showLapMode = lapPressed && showCurLapPace && lapCount >= 2
                   && clockDiv5 % 2 == 1;
        showLapDPlusMoins = showLapMode && showCircuitDPlusMoins;
        showLapPaceAvg    = showLapMode && showCircuitAllure;
        showLapDist       = showLapMode && showCircuitDistance;
        showLapChrono     = showLapMode && showCircuitChrono;
    }

    // Appli : bandeaux d'EP gardés sur les autres écrans de l'appli (Trail Planner, profil, carte) : en
    // haut FC (valeur et anneau), 2e métrique, tour et barre de zone FC ; en bas trait coloré FC,
    // autonomie, mode d'allure et heure ; popup d'alarme par-dessus. À dessiner après le contenu.
    function drawBands(dc as Graphics.Dc) as Void {
        var info = Activity.getActivityInfo();
        var bgColor = isDarkMode ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;
        var txtColor = isDarkMode ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        prepareFrame();
        var hrData = drawHRSection(dc, info, bgColor, txtColor);
        drawHRCircle(dc, hrData[1], bgColor);
        drawSecondMetric(dc, info, txtColor);
        drawHRZoneBar(dc, hrData, txtColor);
        drawClockTab(dc, bgColor, txtColor, hrData[1]);
    }

    // Appli : colonne centrale d'EP (alarme, sac, soleil, température, humidité), pour l'écran Trail Planner.
    function drawCenterColumn(dc as Graphics.Dc) as Void {
        drawParamIcons(dc, isDarkMode ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK);
    }

    // Appli : mise en page de la montre (positions d'EP) et polices d'icônes [icônes, paramètres].
    function lay() as LayoutManager {
        return layout;
    }

    function iconFonts() as Array {
        return [iconsMed, paramIcons];
    }

    // Appli : zone libre entre les bandeaux (y du haut et du bas).
    function contentTop() as Number {
        return layout.hrZoneBarY + layout.hrZoneBarTickH + 3;
    }

    function contentBottom() as Number {
        return layout.clocktabY - 2;
    }

    // Appli : popup d'EP pour un rappel Trail Planner (icône de iconsMed, ou de paramIcons si param),
    // texte en police texte, pendant `secs` secondes (décompté par tickPopup, même sans alarmes d'EP).
    function showPopup(param as Boolean, icon as String, text as String, secs as Number) as Void {
        alarmPopupFont = param ? paramIcons : iconsMed;
        alarmPopupValueFont = Graphics.FONT_MEDIUM;
        alarmPopupLabel = icon;
        alarmPopupValue = text;
        popupOwnTicks = secs;
    }

    function tickPopup() as Void {
        if (popupOwnTicks > 0) {
            popupOwnTicks--;
        }
    }

        function onUpdate(dc as Graphics.Dc) as Void {
    var info = Activity.getActivityInfo();

    var bgColor = isDarkMode ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;
    var txtColor = isDarkMode ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;

    dc.setColor(bgColor, bgColor);
    dc.clear();

    if (SHOW_CALIBRATION_GUIDE) {
        dc.drawBitmap(0, 0, bgIcon);
    }

    prepareFrame();
    var hrData = drawHRSection(dc, info, bgColor, txtColor);
    drawBattery(dc, txtColor);
    drawParamIcons(dc, txtColor);
    drawDataColumnsBackgrounds(dc, txtColor);
    drawHRCircle(dc, hrData[1], bgColor);
    drawDataColumnsValues(dc, info, txtColor);
    drawSecondMetric(dc, info, txtColor);
    drawBottomSection(dc, info, txtColor);
    drawClockTab(dc, bgColor, txtColor, hrData[1]);
    drawHRZoneBar(dc, hrData, txtColor);
}

// ============================================================
// 1. FC : cercle + valeur
// Retourne [hr, zoneColor, hrZones] pour réutilisation
// ============================================================
private function drawHRSection(dc, info, bgColor, txtColor) as Array {
    var hr = (info != null && info.currentHeartRate != null) ? info.currentHeartRate : 0;
    var zoneColor = themed(Graphics.COLOR_LT_GRAY, Graphics.COLOR_DK_GRAY);
    var hrZones = null;

    hrZones = hrZonesCache;
    if (hr > 0 && hrZones != null) {
        if (hr < hrZones[1])      { zoneColor = themed(Graphics.COLOR_LT_GRAY, Graphics.COLOR_DK_GRAY); }
        else if (hr < hrZones[2]) { zoneColor = themed(Graphics.COLOR_BLUE, Graphics.COLOR_DK_BLUE); }
        else if (hr < hrZones[3]) { zoneColor = themed(Graphics.COLOR_GREEN, Graphics.COLOR_DK_GREEN); }
        else if (hr < hrZones[4]) { zoneColor = Graphics.COLOR_ORANGE; }
        else                      { zoneColor = Graphics.COLOR_RED; }
    }

    // Valeur FC
    dc.setColor(colorizeHRValue ? zoneColor : txtColor, Graphics.COLOR_TRANSPARENT);
    dc.drawText(centerX, layout.hrValueY, layout.fontPrimary, hr.toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

    var lapY = layout.lapY;
    // Compteur de circuits — icône centrée sur lapIconX, valeur alignée à gauche sur lapValueX
    if (showCurLapPace && lapCount > 0) {
        dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(layout.lapIconX, lapY + layout.iconParamOffsetY, paramIcons, ICON_LAP_S, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(layout.lapValueX, lapY, layout.fontSmall, lapCountStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    return [hr, zoneColor, hrZones];
}

// Cercle coloré FC — dessiné séparément, après drawDataColumns(), pour passer au-dessus des fonds de zone
private function drawHRCircle(dc, zoneColor, bgColor) as Void {
    if (!showHRCircle) { return; }
    var cw = layout.hrCircleW;
    var tabY = layout.clocktabY;

    dc.setPenWidth(cw);
    dc.setColor(zoneColor, Graphics.COLOR_TRANSPARENT);
    dc.drawCircle(centerX -1 , centerY , ((screenW - cw) / 2) + 1);
    //dc.drawArc(centerX, centerY , ((screenW - cw) / 2), Graphics.ARC_CLOCKWISE, 235, 305);

     // Masquer l'anneau de zone FC sous le trait, sur toute la largeur
    //dc.setColor(bgColor, bgColor);
    //dc.fillRectangle(0, tabY, screenW, screenH - tabY);

    // Séparation : simple trait droit de part en part du cadran
    dc.setPenWidth(1);
    dc.setColor(zoneColor, Graphics.COLOR_TRANSPARENT);
    dc.drawLine(0, tabY, screenW, tabY);


}

// v1.9.28 : Rotation metriques - bloc [icone + gap + valeur] centre sur metric2AxisX
// Dessinee separement, apres drawHRCircle(), pour passer au-dessus du cercle FC
private function drawSecondMetric(dc, info, txtColor) as Void {
    var lapY = layout.lapY;
    var metricData = getRotatingMetric(info);
    var valStr = metricData[0];
    var iconStr = metricData[1];
    if (!valStr.equals("")) {
        dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
        var valW = dc.getTextWidthInPixels(valStr, layout.fontSmall);
        var iconW = iconStr.equals("") ? 0 : dc.getTextWidthInPixels(iconStr, paramIcons);
        var grpW = valW + (iconW > 0 ? iconW + ICON_GAP : 0);
        var grpX = layout.metric2AxisX - (grpW / 2);
        if (!iconStr.equals("")) {
            dc.drawText(grpX, lapY + layout.iconParamOffsetY, paramIcons, iconStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        dc.drawText(grpX + iconW + (iconW > 0 ? ICON_GAP : 0), lapY, layout.fontSmall, valStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}

// ============================================================
// 2. Onglet horloge en bas
// ============================================================
private function drawClockTab(dc, bgColor, txtColor,zoneColor) as Void {
    var tabY = layout.clocktabY;

    // Masquer l'anneau de zone FC sous le trait, sur toute la largeur
    // (désactivé en mode calibration pour garder le guide visible sous les données)
    if (!SHOW_CALIBRATION_GUIDE) {
        dc.setColor(bgColor, bgColor);
        dc.fillRectangle(0, tabY+1, screenW, screenH - tabY);
    }

    // Séparation : simple trait droit de part en part du cadran
    dc.setPenWidth(1);
    dc.setColor(zoneColor, Graphics.COLOR_TRANSPARENT);
    //dc.drawLine(0, tabY, screenW, tabY);

    // Texte horloge
    if (showClock) {
        dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(layout.clockTextX, layout.clockTextY, layout.fontSmall, cachedClockStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // v2.2.5 : Métrique horloge — autonomie batterie uniquement, sans icône, si activée
    if (showClockAutonomy) {
        dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
        var autonomyStr = (batteryAutonomyH < 0) ? "--h" : batteryAutonomyH.toString() + "h";
        dc.drawText(layout.clockMetricValueX, layout.clockTextY, layout.fontSmall, autonomyStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // v2.2.7 : Icône indicateur du mode d'allure (plat/std/mtn), à droite de l'heure —
    // premier plan coloré selon la même logique que cPaceIcon (drawRightColumn)
    var cPaceIcon = (paceMode == 1) ? 0x7570B3
                  : (paceMode == 2) ? 0xA65628
                  : 0x1B9E77;
    var fgIcon = (paceMode == 1) ? ICON_STD   : (paceMode == 2) ? ICON_MNT   : ICON_FLAT;
    var iconX = layout.paceiconX;
    var iconTopY = layout.paceiconY;
    dc.setColor(cPaceIcon, Graphics.COLOR_TRANSPARENT);
    dc.drawText(iconX, iconTopY, paceIcons, fgIcon, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    //dc.fillCircle(iconX-1, iconTopY, layout.paceIconRingR);

    // v2.2.5 : Anneau autour de l'icône mode (24px, contour 1px, sans remplissage)
    //dc.setPenWidth(1);
    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
    //dc.drawCircle(iconX, iconTopY, layout.paceIconRingR);
    //dc.drawText(iconX, iconTopY, paceIcons, fgIcon, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

    // v2.2.11 : popup alarme — dessiné en dernier pour rester au-dessus de tout le reste
    drawAlarmPopup(dc);
}

    // ============================================================
    // 3. Ligne séparatrice FC + curseur zone
    // ============================================================
    private function drawHRZoneBar(dc, hrData as Array, txtColor) as Void {
    var hr = hrData[0] as Number;
    var zoneColor = hrData[1] as Number;
    var hrZones = hrData[2];

    var uplineY = layout.hrZoneBarY;
    var bsX = layout.hrBarStartX;
    var beX = bsX + layout.hrBarWidth;
    var bW  = layout.hrBarWidth;
    var mH  = layout.hrZoneBarTickH;
    dc.setPenWidth(1);
    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
    dc.drawLine(bsX, uplineY, beX, uplineY);

    if (!showHRZoneBar) { return; }

    dc.drawLine(bsX, uplineY - mH, bsX, uplineY + mH);
    dc.drawLine(bsX + bW / 4, uplineY - mH, bsX + bW / 4, uplineY + mH);
    dc.drawLine(bsX + bW / 2, uplineY - mH, bsX + bW / 2, uplineY + mH);
    dc.drawLine(bsX + bW * 3 / 4, uplineY - mH, bsX + bW * 3 / 4, uplineY + mH);
    dc.drawLine(beX, uplineY - mH, beX, uplineY + mH);

    if (hr <= 0 || hrZones == null) { return; }

    var zone = 0;
    if (hr >= hrZones[1] && hr < hrZones[2])      { zone = 1; }
    else if (hr >= hrZones[2] && hr < hrZones[3]) { zone = 2; }
    else if (hr >= hrZones[3] && hr < hrZones[4]) { zone = 3; }
    else if (hr >= hrZones[4])                     { zone = 4; }

    var zMin = (zone == 0) ? 0 : hrZones[zone];
    var zMax = (zone >= 4) ? hrZones[4] + 50 : hrZones[zone + 1];
    var prog = ((hr - zMin).toFloat() / (zMax - zMin).toFloat());
    if (prog < 0.0f) { prog = 0.0f; }
    if (prog > 1.0f) { prog = 1.0f; }

    dc.setColor(colorizeHRZoneBar ? zoneColor : txtColor, Graphics.COLOR_TRANSPARENT);
    dc.fillCircle(bsX + (bW * prog).toNumber() - 1, uplineY, layout.hrZoneBarTickH);
    }

    // ============================================================
    // 4. Batterie (ou Body Battery selon batteryDisplayMode)
    // ============================================================
    private function drawBattery(dc, txtColor) as Void {
    var level;
    var batColor;
    var batIcon;

    if (batteryDisplayMode == 1 && bodyBatteryCache >= 0) {
        // Body Battery : remplissage orange, niveau 0-100
        level    = bodyBatteryCache.toFloat();
        batColor = Graphics.COLOR_ORANGE;
        batIcon  = ICON_BODY_BAT;
    } else {
        // Batterie appareil : colorisation habituelle
        level    = batteryCache;
        batColor = themed(Graphics.COLOR_GREEN, Graphics.COLOR_DK_GREEN);
        if (batteryCache < 10) { batColor = Graphics.COLOR_RED; }
        else if (batteryCache < 25) { batColor = Graphics.COLOR_YELLOW; }
        batIcon  = ICON_BAT;
    }

    var fillW = (layout.batBarW * (level / 100.0)).toNumber();
    if (fillW > 0) {
        dc.setColor(batColor, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(layout.batBarX, layout.batteryBarY, fillW, layout.batBarH, layout.batBarR);
    }

    dc.setPenWidth(1);
    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
    dc.drawRoundedRectangle(layout.batBarX, layout.batteryBarY, layout.batBarW, layout.batBarH, layout.batBarR);

    dc.drawText(layout.battIconX, layout.battIconY + layout.iconParamOffsetY, paramIcons, batIcon, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
}

    // ============================================================
    // Lignes verticales centrale + 4 icônes paramètres
    // ============================================================
    private function drawParamIcons(dc, txtColor) as Void {
        // Ligne verticale centrale entre barre HR et batterie
      dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(layout.PiconX1, layout.ParamBarY1, layout.PiconX1, layout.ParamBarY2);
        dc.drawLine(layout.PiconX2, layout.ParamBarY1, layout.PiconX2, layout.ParamBarY2);
        dc.drawLine(layout.PiconX1, layout.ParamBarBagY, layout.PiconX2, layout.ParamBarBagY);
        dc.drawLine(layout.PiconX1, layout.ParamBarTempY, layout.PiconX2, layout.ParamBarTempY);

        // 4 icônes centrées sur X, réparties entre pY1 et pY1+pY3
        var offColor = isDarkMode ? PARAM_ICON_OFF_DARK : PARAM_ICON_OFF_LIGHT;
        var onColor = themed(Graphics.COLOR_GREEN, Graphics.COLOR_DK_GREEN);
        dc.setColor(alarmMode != 0 ? onColor : offColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(centerX, layout.alarmIconY + layout.iconParamOffsetY, paramIcons, ICON_ALARM, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(bagWeight > 0 ? onColor : offColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(centerX, layout.bagIconY + layout.iconParamOffsetY, paramIcons, ICON_BAG,   Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(bagWeight > 0 ? txtColor : offColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(centerX, layout.bagValueY, layout.fontSmall, bagWeight.toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var sunColor = offColor;
        if (tempEnabled) {
            if      (currentWbgt >= 8.0f  && currentWbgt <= 12.0f) { sunColor = Graphics.COLOR_GREEN; }
            else if (currentWbgt >= 3.0f  && currentWbgt <   8.0f) { sunColor = Graphics.COLOR_BLUE; }
            else if (currentWbgt <   3.0f)                          { sunColor = Graphics.COLOR_DK_BLUE; }
            else if (currentWbgt >  12.0f && currentWbgt <= 17.0f) { sunColor = Graphics.COLOR_YELLOW; }
            else if (currentWbgt >  17.0f && currentWbgt <= 22.0f) { sunColor = Graphics.COLOR_ORANGE; }
            else if (currentWbgt >  22.0f)                          { sunColor = Graphics.COLOR_RED; }
        }
        dc.setColor(sunColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(centerX, layout.sunIconY + layout.iconParamOffsetY, paramIcons, ICON_SUN,   Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(tempEnabled ? Graphics.COLOR_YELLOW : offColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(centerX, layout.TempValueY, layout.fontSmall, currentTempC.toString(), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        var humStr = (currentHumidity >= 0) ? currentHumidity.toString() : "--";
        dc.setColor(tempEnabled ? themed(Graphics.COLOR_BLUE, Graphics.COLOR_DK_BLUE) : offColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(centerX, layout.HumidityValueY, layout.fontSmall, humStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // ============================================================
    // 5. Colonnes gauche + droite (D+, D-, Alt, VAM, Allures)
    // ============================================================
    // Fonds (zone rects VAM/allures) — dessinés avant le cercle FC
    private function drawDataColumnsBackgrounds(dc, txtColor) as Void {
    drawVamZoneBar(dc);

    var paceSlot = paceMode;
    var dispInst; var dispAvg;
    if (paceSlot == 0) {
        dispInst = dispFlatPace;
        dispAvg  = avgFlatPace;
    } else if (paceSlot == 1) {
        dispInst = dispEffortPaceStd;
        dispAvg  = avgPaceStd;
    } else {
        dispInst = dispEffortPaceMtn;
        dispAvg  = avgPaceMtn;
    }

    var yMoins = layout.zoneRectMidY;
    var yAlt = layout.zoneRectBotY;

    var instRawColor = getPaceColor(dispInst, txtColor);
    if ((colorizePaceInstMode == 1 || colorizePaceInstMode == 2) && instRawColor != txtColor) {
        drawZoneRect(dc, yMoins, instRawColor, colorizePaceInstMode);
    }

    var curLapPace  = (paceSlot == 2) ? curLapPaceMtn : (paceSlot == 1) ? curLapPaceStd : curLapFlatPace;
    var avgPaceDisp = showLapPaceAvg ? curLapPace : dispAvg;
    var avgRawColor = getPaceColor(avgPaceDisp, txtColor);
    if ((colorizePaceAvgMode == 1 || colorizePaceAvgMode == 2) && avgRawColor != txtColor) {
        drawZoneRect(dc, yAlt, avgRawColor, colorizePaceAvgMode);
    }

    // v2.2.8 : encadré 1px D+ (montée) ou D- (descente) selon le signe de la VAM
    if (colorizeDPlusDMoins && currentVam != 0) {
        var yRect = (currentVam > 0) ? layout.dataRowTopY : layout.dataRowMidY;
        // +1 avant division entière : arrondit vers le haut (hauteurs impaires) pour éviter
        // le décalage de ~1px vers le bas qu'une division tronquée introduirait.
        var halfH = (layout.zoneRectH + 1) / 2;
        dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        dc.drawRectangle(layout.dPlusMoinsRectX, yRect - halfH,
                          layout.zoneRectBgW, layout.zoneRectH);
    }
    }

    // Valeurs (D+, D-, Alt, VAM, Allures) — dessinées après le cercle FC, pour passer au-dessus
    private function drawDataColumnsValues(dc, info, txtColor) as Void {
    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
    drawLeftColumn(dc, info, txtColor);
    drawRightColumnValues(dc, txtColor);
    }

    // --- Colonne gauche : D+, D-, Alt ---
    private function drawLeftColumn(dc, info, txtColor) as Void {
    // v2.2.7 : en alternance circuit, D+/D- passent sur le circuit en cours
    // (l'altitude reste celle de la session : valeur absolue, non cumulée)
    var dPlus = showLapDPlusMoins ? curLapAscent.toNumber()
              : ((info != null && info.totalAscent != null) ? info.totalAscent.toNumber() : 0);
    var dMoins = showLapDPlusMoins ? curLapDescent.toNumber()
               : ((info != null && info.totalDescent != null) ? info.totalDescent.toNumber() : 0);
    var alt = (info != null && info.altitude != null) ? info.altitude.toNumber() : 0;
    if (SHOW_TEST_VALUES) { dPlus = 44444; dMoins = 44444; }

    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);

    // D+
    var dpStr = dPlus.toString();
    var dpW = dc.getTextWidthInPixels(dpStr, layout.fontSecondary);
    var dpX = layout.axisLeftX - (dpW / 2);
    var yDP = layout.dataRowTopY;
    dc.drawText(dpX, yDP, layout.fontSecondary, dpStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    var dpIcon = showLapDPlusMoins ? ICON_LAP : ICON_UP_R;
    dc.drawText(dpX - 5, yDP + layout.iconSmallOffsetY, iconsMed, dpIcon, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);

    // D-
    var dmStr = dMoins.toString();
    var dmW = dc.getTextWidthInPixels(dmStr, layout.fontSecondary);
    var dmX = layout.axisLeftX - (dmW / 2);
    var yDM = layout.dataRowMidY;
    dc.drawText(dmX, yDM, layout.fontSecondary, dmStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    var dmIcon = showLapDPlusMoins ? ICON_LAP : ICON_DOWN_R;
    dc.drawText(dmX - 5, yDM + layout.iconSmallOffsetY, iconsMed, dmIcon, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);

    // Altitude
    var altStr = alt.toString();
    var altW = dc.getTextWidthInPixels(altStr, layout.fontSecondary);
    var altX = layout.axisLeftX - (altW / 2);
    var yAltC = layout.dataRowBotY;
    dc.drawText(altX, yAltC, layout.fontSecondary, altStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    dc.drawText(altX - 5, yAltC + layout.iconSmallOffsetY, iconsMed, ICON_MOUNTAIN, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // --- Colonne droite : VAM, Allure inst., Allure moy. (valeurs uniquement) ---
    private function drawRightColumnValues(dc, txtColor) as Void {
    // A. VAM
    drawVamValue(dc, txtColor);

    // B. Allure instantanée — slot direct (0=Normale, 1=Effort Std, 2=Effort Mtn)
    var paceSlot = paceMode;

    // Sélection des valeurs selon le slot actif (icônes remplacées par du texte)
    var dispInst; var dispAvg;
    if (paceSlot == 0) {
        dispInst = dispFlatPace;
        dispAvg  = avgFlatPace;
    } else if (paceSlot == 1) {
        dispInst = dispEffortPaceStd;
        dispAvg  = avgPaceStd;
    } else {
        dispInst = dispEffortPaceMtn;
        dispAvg  = avgPaceMtn;
    }

    // B. Allure instantanée (haut)
    var kmStr = formatDisp(dispInst);
    if (SHOW_TEST_VALUES) { kmStr = "14:44"; }
    var kmW = dc.getTextWidthInPixels(kmStr, layout.fontSecondary);
    var kmX = layout.axisRightX - (kmW / 2);

    // v2.2.4 : mode Barre/Fond/Police indépendant (colorize_pace_inst_prop). v2.2.6 : le
    // rectangle et texte (mode Police) reprennent la couleur d'alerte allure ; l'icône reste
    // toujours neutre (txtColor), comme les autres icônes de l'écran.
    var instRawColor = getPaceColor(dispInst, txtColor);
    var instColor = txtColor;
    if (colorizePaceInstMode == 3) {
        instColor = instRawColor;
    }
    var yInstC = layout.dataRowMidY;
    dc.setColor(instColor, Graphics.COLOR_TRANSPARENT);
    dc.drawText(kmX, yInstC, layout.fontSecondary, kmStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
    dc.drawText(kmX - 5, yInstC + layout.iconSmallOffsetY, iconsMed, ICON_PACE, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);

    // C. Allure moyenne (bas) — alterne toutes les 5 s : session / circuit en cours
    var curLapPace  = (paceSlot == 2) ? curLapPaceMtn : (paceSlot == 1) ? curLapPaceStd : curLapFlatPace;
    var avgPaceDisp = showLapPaceAvg ? curLapPace : dispAvg;
    var avgRawColor = getPaceColor(avgPaceDisp, txtColor);
    var cAvg = txtColor;
    if (colorizePaceAvgMode == 3) {
        cAvg = avgRawColor;
    }
    var avgStr = formatDisp(avgPaceDisp);
    if (SHOW_TEST_VALUES) { avgStr = "14:44"; }
    var avgW = dc.getTextWidthInPixels(avgStr, layout.fontSecondary);
    var avgX = layout.axisRightX - (avgW / 2);
    var yAvgC = layout.dataRowBotY;
    dc.setColor(cAvg, Graphics.COLOR_TRANSPARENT);
    dc.drawText(avgX, yAvgC, layout.fontSecondary, avgStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    // Icône gauche : ICON_LAP si dernier circuit, sinon ICON_AVGPACE
    var avgIconStr = showLapPaceAvg ? ICON_AVGLAP : ICON_AVGPACE;
    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);
    dc.drawText(avgX - 5, yAvgC + layout.iconSmallOffsetY, iconsMed, avgIconStr, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);

}

// --- VAM : valeur + icône ---
// Mode 0 : VAM seule
// Mode 1 : % Pente seule
// Mode 2 — sans circuit : alternance VAM ↔ % Pente (5 s chacun)
//         — avec circuit : cycle VAM → moy.circuit → % Pente → moy.circuit (5 s chacun)
//           ICON_POURCENT pour la moyenne VAM circuit
private function drawVamValue(dc, txtColor) as Void {
    var absVam    = (currentVam < 0) ? -currentVam : currentVam;
    if (SHOW_TEST_VALUES) { absVam = 2000; }
    var lapAvg    = (Math.round(curLapAvgVam / 50.0) * 50).toNumber();
    var absLapAvg = (lapAvg < 0) ? -lapAvg : lapAvg;
    var gradeIcon = (currentGrade >= 0.0f) ? ICON_UP : ICON_DOWN;
    var vamIcon   = (currentVam >= 0) ? ICON_UP : ICON_DOWN;
    var lapIcon   = (lapAvg >= 0) ? ICON_AVGUP : ICON_AVGDOWN;
    var gradeStr  = null;
    var phase2    = clockDiv5 % 2;

    var vStr; var vIcon;

    if (vamDisplayMode == 1) {
        gradeStr = ((currentGrade < 0.0f ? -currentGrade : currentGrade).toNumber()).toString() + "%";
        vStr = gradeStr; vIcon = gradeIcon;

    } else if (vamDisplayMode == 2) {
        vStr = absLapAvg.toString(); vIcon = lapIcon;

    } else if (vamDisplayMode == 3) {
        if (phase2 == 0) { vStr = absVam.toString(); vIcon = vamIcon; }
        else { gradeStr = ((currentGrade < 0.0f ? -currentGrade : currentGrade).toNumber()).toString() + "%"; vStr = gradeStr; vIcon = gradeIcon; }

    } else if (vamDisplayMode == 4) {
        if (phase2 == 0) { vStr = absVam.toString(); vIcon = vamIcon; }
        else { vStr = absLapAvg.toString(); vIcon = lapIcon; }

    } else if (vamDisplayMode == 5) {
        if (phase2 == 0) { vStr = absLapAvg.toString(); vIcon = lapIcon; }
        else { gradeStr = ((currentGrade < 0.0f ? -currentGrade : currentGrade).toNumber()).toString() + "%"; vStr = gradeStr; vIcon = gradeIcon; }

    } else if (vamDisplayMode == 6) {
        if (lapPressed) {
            var phase = clockDiv5 % 4;
            if (phase == 0)      { vStr = absVam.toString(); vIcon = vamIcon; }
            else if (phase == 2) { gradeStr = ((currentGrade < 0.0f ? -currentGrade : currentGrade).toNumber()).toString() + "%"; vStr = gradeStr; vIcon = gradeIcon; }
            else                 { vStr = absLapAvg.toString(); vIcon = lapIcon; }
        } else {
            if (phase2 == 0) { vStr = absVam.toString(); vIcon = vamIcon; }
            else { gradeStr = ((currentGrade < 0.0f ? -currentGrade : currentGrade).toNumber()).toString() + "%"; vStr = gradeStr; vIcon = gradeIcon; }
        }

    } else {
        vStr = absVam.toString(); vIcon = vamIcon;
    }

    var vW = dc.getTextWidthInPixels(vStr, layout.fontSecondary);
    var vX = layout.axisRightX - (vW / 2);
    var vTxtColor = (vamZonesEnabled == 3 && currentVam > 0 && currentVam >= vamZoneMinThreshold) ? vamZoneColor() : txtColor;
    var yVamC = layout.dataRowTopY;
    dc.setColor(vTxtColor, Graphics.COLOR_TRANSPARENT);
    dc.drawText(vX, yVamC, layout.fontSecondary, vStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    dc.drawText(vX - 5, yVamC + layout.iconSmallOffsetY, iconsMed, vIcon, Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
}

// ============================================================
// 6. Bas d'écran : Distance + Temps
// ============================================================
// Distance restante affichée : 0 = prochain point, 1 = fin de parcours, selon le réglage (alternance
// toutes les 5 s).
private function distPhase() as Number {
    if (distToType == 1) { return 0; }
    if (distToType == 2) { return 1; }
    return clockDiv5 % 2;
}

private function drawBottomSection(dc, info, txtColor) as Void {
    var fLabel = layout.fontSmall;
    var w = screenW;
    var iLapW = showLapDist ? iconLapW : 0;

    var dist = (showLapDist
        ? curLapDist / 1000.0f
        : (info != null && info.elapsedDistance != null) ? (info.elapsedDistance / 1000.0f) : 0.0f).format("%.2f");
    if (SHOW_TEST_VALUES) { dist = "100.44"; }

    var hasRoute = false;
    var distRest = "";
    var routeIcon = ICON_FLAG;
    if (info != null && (info has :distanceToDestination) && info.distanceToDestination != null && info.distanceToDestination > 0 && distToType != 0) {
        hasRoute = true;
        var dDestM = info.distanceToDestination;
        // Droite : phase 0 = dist prochain WP (waypoint), phase 1 = dist fin de parcours
        if (distPhase() == 0) {
            // Icône selon le type du prochain point de passage
            routeIcon = ICON_WAYPOINT;
            if ((info has :nextCoursePoint) && info.nextCoursePoint != null) {
                var cpType = info.nextCoursePoint.type;
                if      (cpType == 3) { routeIcon = ICON_WATER; }   // Water
                else if (cpType == 4) { routeIcon = ICON_FOOD;  }   // Food
            }
            var dWpM = dDestM;
            if ((info has :distanceToNextPoint) && info.distanceToNextPoint != null) {
                dWpM = info.distanceToNextPoint;
            }
            distRest = (dWpM / 1000.0f).format("%.2f");
        } else {
            routeIcon = ICON_FLAG;
            distRest = (dDestM / 1000.0f).format("%.2f");
        }
    } else if (distToType != 0) {
        // Trail Planner Companion : sans parcours Garmin suivi, distance restante du plan Trail Planner
        // (prochain point du plan, arrivée), recalée sur le tracé comme l'écran Trail Planner.
        var tp = getRun().tp;
        var toFinish = distPhase() == 1;
        var rest = tp.remainingTo(toFinish);
        if (rest >= 0) {
            hasRoute = true;
            routeIcon = toFinish ? ICON_FLAG : (tp.nextIsRavito() ? ICON_FOOD : ICON_WAYPOINT);
            distRest = (rest / 1000.0f).format("%.2f");
        }
    }

    dc.setColor(txtColor, Graphics.COLOR_TRANSPARENT);

    var yD = yDist;
    var gapUnit = ICON_GAP;
    var yIconD = yD + layout.iconSmallOffsetY;

    var routeIconW = routeIcon.equals(ICON_WAYPOINT) ? iconWaypW
                   : routeIcon.equals(ICON_FLAG)     ? iconFlagW
                   : dc.getTextWidthInPixels(routeIcon, iconsMed);

    if (hasRoute) {
        // Gauche : distance parcourue
        var dW = dc.getTextWidthInPixels(dist, layout.fontSecondary);
        if (showLapDist) {
            var sX1 = layout.axisLeftX - ((iLapW + gapUnit + dW) / 2);
            dc.drawText(sX1, yIconD, iconsMed, ICON_LAP, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(sX1 + iLapW + gapUnit, yD, layout.fontSecondary, dist, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(sX1 + iLapW + gapUnit + dW + gapUnit, yD, fLabel, "km", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            var sX1 = layout.axisLeftX - (dW / 2);
            dc.drawText(sX1, yD, layout.fontSecondary, dist, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(sX1 + dW + gapUnit, yD, fLabel, "km", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        // Droite : icone + distance
        var rW = dc.getTextWidthInPixels(distRest, layout.fontSecondary);
        var sX2 = layout.axisRightX - (rW / 2);
        dc.drawText(sX2 - routeIconW - gapUnit, yIconD, iconsMed, routeIcon, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(sX2, yD, layout.fontSecondary, distRest, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    } else {
        var dW = dc.getTextWidthInPixels(dist, layout.fontSecondary);
        var lW = labelKmW;
        if (showLapDist) {
            var sX = (w - iLapW - gapUnit - dW - gapUnit - lW) / 2;
            dc.drawText(sX, yIconD, iconsMed, ICON_LAP, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(sX + iLapW + gapUnit, yD, layout.fontSecondary, dist, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(sX + iLapW + gapUnit + dW + gapUnit, yD, fLabel, "km", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            var sX = (w - dW - lW - gapUnit) / 2;
            dc.drawText(sX, yD, layout.fontSecondary, dist, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.drawText(sX + dW + gapUnit, yD, fLabel, "km", Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    // Temps écoulé
    var t = showLapChrono
        ? curLapTime.toNumber()
        : (info != null && info.timerTime != null) ? info.timerTime / 1000 : 0;
    if (SHOW_TEST_VALUES) { t = 30 * 3600; }
    var tStr = formatTime(t);
    var yT = yTimer;
    if (showLapChrono) {
        var tW = dc.getTextWidthInPixels(tStr, layout.fontPrimary);
        var tX = (w - iconLapXLW - gapUnit - tW) / 2;
        dc.drawText(tX, yT + layout.iconXLOffsetY, notifIcons, ICON_LAP_XL, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(tX + iconLapXLW + gapUnit, yT, layout.fontPrimary, tStr, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    } else {
        dc.drawText(centerX, yT, layout.fontPrimary, tStr, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}


    // v1.9.27 : Mise à jour CONTINUE des champs FIT LAP dans compute() (setData doit précéder onTimerLap)
    // v2.1.2 : IDs 5-11 (CYCLE/LAP) — Standard + Montagne de l'unité active, distance effort,
    // poids du sac et VAM moyenne du circuit en cours
    private function updateLapFitData(info as Activity.Info or Null) as Void {
        if (!lapPressed) { return; }
        try {
        if (fitLapAllureStdField  != null) { fitLapAllureStdField.setData(formatPace(curLapPaceStd)); }
        if (fitLapAllureMtnField  != null) { fitLapAllureMtnField.setData(formatPace(curLapPaceMtn)); }
        if (fitLapVitesseStdField != null) { fitLapVitesseStdField.setData(curLapPaceStd > 0 ? 3600.0 / curLapPaceStd : 0.0); }
        if (fitLapVitesseMtnField != null) { fitLapVitesseMtnField.setData(curLapPaceMtn > 0 ? 3600.0 / curLapPaceMtn : 0.0); }
        if (fitLapDistField       != null) { fitLapDistField.setData(curLapEffortDist); }
        if (fitLapBagWeightField  != null) { fitLapBagWeightField.setData(bagWeight); }
        if (fitLapVamField        != null) { fitLapVamField.setData(curLapAvgVam.toNumber()); }
        } catch (e) {
            System.println("Erreur FIT lap : " + e.getErrorMessage());
        }
    }

    // v2.2.11 : Affichage visuel de l'alarme — Popup (dessiné par l'app, durée garantie par
    // alarmPopupDurationSec) ou Notification (WatchUi.showToast natif montre — durée hors
    // contrôle de l'app, voir alarm_display_type_prop et trail_datafield_notes.md)
    private function showAlarmVisual(iconLabel as String, value as String, toastText as String) as Void {
        if (alarmDisplayType == 1) {
            WatchUi.showToast(toastText, null);
        } else {
            alarmPopupLabel = iconLabel;
            alarmPopupValue = value;
            alarmPopupTicks = alarmPopupDurationSec;
            alarmPopupFont = null;
            alarmPopupValueFont = Graphics.FONT_NUMBER_MILD;
        }
    }

    // v1.8.0 : Déclenchement alarme (vibration / son / les deux)
    private function triggerAlarm() as Void {
        if ((vamAlarmType == 1 || vamAlarmType == 3) && vibePattern != null) {
            Attention.vibrate(vibePattern);
        }
        if (vamAlarmType == 2 || vamAlarmType == 3) {
            if (Attention has :playTone) {
                Attention.playTone(Attention.TONE_ALERT_HI);
            }
        }
    }

    // v2.2.11 : Popup alarme centré à l'écran, entièrement dessiné par l'app — alternative à
    // WatchUi.showToast dont la durée n'est pas garantie (voir showAlarmVisual). Se ferme seul
    // dès que alarmPopupTicks retombe à 0 (décrémenté 1×/s dans compute()), sans interaction.
    function drawAlarmPopup(dc as Graphics.Dc) as Void {
        if (alarmPopupTicks <= 0 && popupOwnTicks <= 0) { return; }
        var lf = alarmPopupFont != null ? alarmPopupFont : notifIcons;
        var vf = alarmPopupValueFont;

        var iconW  = dc.getTextWidthInPixels(alarmPopupLabel, lf);
        var valW   = dc.getTextWidthInPixels(alarmPopupValue, vf);
        var gap    = 8;
        var padX   = 16;
        var popW   = iconW + gap + valW + (padX * 2);
        var popH   = dc.getFontHeight(vf) + 12;
        var popX   = centerX - popW / 2;
        var popY   = centerY - popH / 2;
        var radius = 10;

        var popBg  = isDarkMode ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
        var popTxt = isDarkMode ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;

        dc.setColor(popBg, popBg);
        dc.fillRoundedRectangle(popX, popY, popW, popH, radius);
        dc.setColor(popTxt, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        dc.drawRoundedRectangle(popX, popY, popW, popH, radius);

        var startX = centerX - (iconW + gap + valW) / 2;
        dc.drawText(startX, centerY, lf, alarmPopupLabel, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(startX + iconW + gap, centerY, vf, alarmPopupValue, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function formatPace(sec as Float) as String {
        if (sec <= 0 || sec > 3600) { return "--:--"; }
        var s = (Math.round(sec / 5.0) * 5).toNumber();
        return (s / 60).format("%d") + ":" + (s % 60).format("%02d");
    }

    // v1.9.36 : Formatage allure selon unité choisie (min/km ou km/h)
    function formatDisp(sec as Float) as String {
        if (!paceUnitKmh) { return formatPace(sec); }
        if (sec <= 0 || sec > 3600) { return "--.-"; }
        return (3600.0 / sec).format("%.1f");
    }

    // v1.9.48 : 2nd métrique — 2 slots indépendants (0=Aucun, 1=Fatigue, 2=Calories, 3=Km Effort)
    // Identiques (non nuls) → affichage fixe ; différents (les deux non nuls) → alternance 5s ;
    // un seul non nul → celui-ci fixe ; les deux à 0 → rien affiché
    private function renderMetricIdx(idx as Number) as Array<String> {
        if (idx == 1) {
            if (!baselineInitialized || baselinePace <= 0.0f) { return ["--", ICON_FLASH]; }
            var curPace = (paceMode == 2) ? avgPaceMtn : (paceMode == 1) ? avgPaceStd : avgFlatPace;
            if (curPace <= 0.0f) { return ["--", ICON_FLASH]; }
            var pct = ((curPace - baselinePace) / baselinePace * 100.0f).toNumber();
            var sign = (pct >= 0) ? "+" : "-";
            return [sign + pct.abs().toString() + "%", ICON_FLASH];
        }
        if (idx == 2) { return [totalCalories.toString(), ICON_CAL]; }
        if (idx == 3) { return [effortDistanceAccum.format("%.1f"), ICON_RUN]; }
        if (idx == 7) {
            var pct = ((tempFactor * bagFactor) - 1.0) * 100.0;
            return [pct.format("%.1f") + "%", ICON_BAG_SUN];
        }
        if (idx == 4) {
            if (bodyBatteryCache < 0) { return ["--", ICON_BODY_BAT]; }
            return [bodyBatteryCache.toString(), ICON_BODY_BAT];
        }
        return ["", ""];
    }

    private function getRotatingMetric(info as Activity.Info or Null) as Array<String> {
        if (info == null) { return ["", ""]; }
        if (metricSlotA == 0 && metricSlotB == 0) { return ["", ""]; }
        if (metricSlotA == metricSlotB) { return renderMetricIdx(metricSlotA); }
        if (metricSlotA == 0) { return renderMetricIdx(metricSlotB); }
        if (metricSlotB == 0) { return renderMetricIdx(metricSlotA); }
        var phase = clockDiv5 % 2;
        return renderMetricIdx(phase == 0 ? metricSlotA : metricSlotB);
    }

    // Calcul facteur allure thermo-hygrique (Ely et al. via WBGT simplifié)
    // Si humidité disponible : WBGT = 0.7×Twb + 0.3×T  (Twb via Stull 2011)
    // Sinon : WBGT ≈ T (fallback température seule)
    // Zone neutre : 8–12°C WBGT (facteur = 1.0)
    // Froid  : <8°C   +0.3%/°C | <3°C   +0.5%/°C
    // Chaleur: >12°C  +0.3%/°C | >17°C  +0.4%/°C | >22°C  +0.5%/°C
    // v2.4.0 : capteur solaire (montres solaires uniquement) — approxime le terme radiatif du WBGT
    // complet (absent ici faute de capteur de globe noir) en ajoutant jusqu'à +3°C au WBGT à pleine
    // intensité (solar=100), 0°C à intensité nulle ou capteur indisponible (solar<0).
    private function computeThermoFactor(t as Float, rh as Number, solar as Number) as Float {
        var wbgt;
        if (rh >= 0) {
            // Wet-bulb (Stull 2011) puis WBGT indoor (sans globe)
            var rh_f = rh.toFloat();
            var twb = t * Math.atan(0.151977f * Math.sqrt(rh_f + 8.313659f)).toFloat()
                    + Math.atan(t + rh_f).toFloat()
                    - Math.atan(rh_f - 1.676331f).toFloat()
                    + 0.00391838f * Math.pow(rh_f, 1.5f).toFloat() * Math.atan(0.023101f * rh_f).toFloat()
                    - 4.686035f;
            wbgt = 0.7f * twb + 0.3f * t;
        } else {
            wbgt = t;  // fallback sans humidité
        }
        if (solar > 0) {
            wbgt += (solar.toFloat() / 100.0f) * 3.0f;
        }
        currentWbgt = wbgt;

        var factor = 1.0f;
        if (wbgt >= 8.0f && wbgt <= 12.0f) {
            // Zone optimale — aucune correction
            factor = 1.0f;
        } else if (wbgt < 3.0f) {
            // Grand froid : raccord continu à 1.015 (valeur de la branche 3-8°C à wbgt=3) + 0.5%/°C supplémentaire
            factor = 1.015f + (3.0f - wbgt) * 0.005f;
        } else if (wbgt < 8.0f) {
            // Froid modéré : +0.3%/°C en dessous de 8°C
            factor = 1.0f + (8.0f - wbgt) * 0.003f;
        } else if (wbgt <= 17.0f) {
            // Chaleur modérée : +0.3%/°C au-dessus de 12°C (Ely)
            factor = 1.0f + (wbgt - 12.0f) * 0.003f;
        } else if (wbgt <= 22.0f) {
            // Chaleur importante : +0.4%/°C (Ely)
            factor = 1.015f + (wbgt - 17.0f) * 0.004f;
        } else {
            // Chaleur extrême : +0.5%/°C (Ely)
            factor = 1.035f + (wbgt - 22.0f) * 0.005f;
        }
        return factor;
    }

    (:typecheck(false))
    private function readInternalTemp() as Float or Null {
        if (Toybox has :SensorHistory && SensorHistory has :getTemperatureHistory) {
            var it = SensorHistory.getTemperatureHistory({:period => 1, :order => SensorHistory.ORDER_NEWEST_FIRST});
            var sample = it.next();
            if (sample != null && sample.data != null) { return sample.data; }
        }
        return null;
    }

    function formatTime(s as Number) as String {
        if (s == cachedTimeValue) { return cachedTimeStr; }
        cachedTimeValue = s;
        var h = s / 3600;
        var m = (s % 3600) / 60;
        var sec = s % 60;
        cachedTimeStr = h > 0 ? h + ":" + m.format("%02d") + ":" + sec.format("%02d") : m + ":" + sec.format("%02d");
        return cachedTimeStr;
    }
}
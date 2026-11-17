# Appli montre « Trail Planner Companion »

Appli Connect IQ pour montres Garmin (une **appli**, pas un champ de données) qui **enregistre ta sortie
Trail** avec :
- l'**écran et les calculs d'EndurancePro 2.7.3**, à l'identique (allure effort, VAM, zones, alarmes,
  données FIT, menu de réglages, 6 langues, thèmes clair et sombre) ;
- l'**écran du champ Trail Planner**, à l'identique (écart au plan, prochain point, barrières horaires,
  rappels nutrition, écran du ravito) ;
- le **profil de la course qui te suit**, zoomable, avec l'écart au plan ;
- la **carte** : ton parcours Trail Planner sur le fond de carte Garmin de la montre, centrée sur toi ;
- le **suivi pour l'assistance** (passages, position, batterie), comme le champ Trail Planner.

Le champ de données Trail Planner (`garmin/TrailPlannerField`) continue de s'utiliser dans l'activité
Trail de Garmin ; l'appli en reprend l'écran et les calculs pour qui lance la sortie depuis elle (profil
zoomable, carte, EndurancePro sur la même activité).

**État :** version 0.4.0, à compiler et à tester sur la montre (pas de SDK Connect IQ dans les sessions
Claude). Gratuite pendant la bêta. Le passage au payant viendra plus tard : rien dans l'appli pour l'instant.

![Aperçu approximatif de l'écran du profil sur Enduro 3 (écran rond 280 px)](apercu-profil.png)

*Aperçu approximatif de l'écran du profil (polices Garmin simulées), dessiné à partir d'une course de
42 km et du même calcul que l'appli. L'écran EndurancePro est celui du champ.*

![Aperçu approximatif de l'écran Carte, tracé seul](apercu-carte.png)

*Écran Carte en tracé seul (montres sans cartes) ; sur les montres à cartes, le même tracé et les mêmes
repères sont posés sur le fond de carte Garmin, qui ne peut pas être simulé ici.*

## Écrans (Haut / Bas pour passer de l'un à l'autre)

**1. EndurancePro** : l'écran du champ EndurancePro 2.7.3, sans changement. FC dans un cercle et sa
barre de zones, D+, D- et altitude, VAM, allure effort instantanée et moyenne colorées par zone, sac,
météo, batterie, distance, chrono, heure, 2e métrique, circuits, alarmes (popup ou notification).

**2. Trail Planner** : l'écran du champ Trail Planner, à l'identique (voir `garmin/README.md`) :
- avant le départ : nom, distance, D+, temps prévu, heure de départ, avec quoi partir ;
- en course : prochain point (distance, D+ et D- restants, heures prévue et estimée), **écart au plan**,
  barre du tronçon (points de passage, produits à prendre), marge sur la prochaine **barrière horaire**
  (alerte sous 30 min), en option « Jusqu'à l'arrivée » ;
- **rappels nutrition** (produit prévu, eau à boire) ; **écran du ravito** à l'arrivée (pause, tronçon
  suivant, à manger sur place, sac « À emporter », note du point) jusqu'au départ ;
- textes en français, comme le champ.

C'est aussi le **moteur de suivi de toute l'appli** : position calée sur le tracé, passages (position ou
Lap), estimations ; le profil, la carte et l'envoi à l'assistance lisent ses données.

**Bascule automatique** : un rappel nutrition, l'arrivée à un ravito (ou à un point avec une note) et une
alerte de barrière horaire affichent l'écran Trail Planner (avec vibration), quel que soit l'écran en
cours, puis l'appli revient à l'écran d'avant : 30 s pour un rappel, jusqu'au départ du ravito, 10 s pour
une barrière. Pas de bascule par-dessus un menu ni pendant l'exploration de la carte ; changer d'écran à
la main annule le retour.

**3. Profil de la course** (sans km ni nom de point) :
- en haut, l'**écart au plan** à l'endroit où tu es (`+6'` = 6 min de retard, en rouge ; avance en
  vert). À la place, pendant 5 s : « Passage · nom », « Départ · nom » ou « Tour N » après un tour ;
  « Hors parcours · N m » si tu t'écartes du tracé ; « Pause » ; le nom de la course avant le départ ;
- la portion de parcours du **zoom choisi** (parcours entier, 20, 10, 5 ou 2 km), toi au **tiers gauche**
  comme sur la page assistance : tu vois surtout ce qui t'attend ;
- **altitudes ajustées à la portion affichée** (100 m d'écart au moins, pour ne pas grossir le plat), avec
  la plus haute et la plus basse à gauche ;
- partie faite et partie à venir en deux gris, ou à venir en **couleurs des pentes** (option) ;
- points de passage sans nom : ravito (rond orange), base de vie (carré rouge), autres (petit rond),
  grisés une fois passés ;
- ta position : trait vertical, point sur le profil, triangle sous la ligne de base, d'après le GPS
  **calé sur le tracé** du plan, comme le champ ;
- une alarme d'EndurancePro en mode popup s'affiche aussi sur cet écran.

**Couleurs des pentes** (désactivées par défaut). Montée : vert < 5 %, jaune 5–10 %, orange 10–15 %,
rouge 15–25 %, violet 25 % et plus. Descente : bleu clair de −5 à −15 %, bleu foncé au-delà. Entre −5 et
5 % : vert. La pente est une moyenne sur 1/20 au moins de la portion affichée (100 m au zoom 2 km, 500 m
au zoom 10 km), pour que les petites bosses ne zèbrent pas une montée.

**4. Carte** : carte orientée nord, centrée sur toi (flèche bleue = cap GPS) :
- **ton parcours Trail Planner** en magenta (tracé fin envoyé par l'app web, à 3 m près sur une course
  normale), les ravitos, bases de vie et l'arrivée en repères ;
- **fond de carte Garmin** de la montre (chemins, relief, noms) sur les montres à cartes ; sur les autres
  (Forerunner 255 et 265), **tracé seul** sur le fond du thème, partie faite en gris, ravito rond orange,
  base de vie carré rouge ;
- **échelle** choisie dans le menu (largeur de l'écran : 200 m, 500 m, 1 km par défaut, 2 km, 5 km),
  rappelée en bas ;
- **Explorer la carte** (menu, montres à cartes) : la carte passe en mode exploration Garmin pour la
  déplacer et zoomer avec les boutons ; BACK revient au suivi ;
- en haut, comme sur le profil : écart au plan, passages, « Hors parcours ».

**Thème** : celui d'EndurancePro (réglage *Mode sombre*, dossier Affichage), sur tous les écrans.

**Anneau d'état** au bord de l'écran, avant le départ et en pause : rouge = GPS en recherche, vert =
prêt (START), orange = pause.

## Boutons

| Bouton | Avant le départ | Pendant la sortie | En pause |
|---|---|---|---|
| START | Démarrer | Pause (menu Reprendre / Enregistrer / Supprimer) | Reprendre |
| BACK (Lap) | Quitter l'appli | Nouveau tour et passage au point | Menu de pause |
| Haut / Bas | Écran suivant (EP, Trail Planner, profil, carte) | Écran suivant | Écran suivant |
| Appui long sur Haut | Menu | Menu | Menu |

Écran tactile : balayages pour changer d'écran. Un balayage « retour » ne coupe pas la sortie, et un tap
ne fait rien : START et BACK restent sur les boutons. « Supprimer » demande une confirmation.

**Tour = passage au point** (comme le champ, réglage activé par défaut). Chaque tour crée un tour dans le
fichier FIT et un nouveau circuit EndurancePro. Il valide aussi le passage au point le plus proche pas
encore validé : à 150 m au plus devant toi ou 300 m derrière avec le GPS calé sur le tracé, 500 m sinon.
Ta position est alors recalée sur le point. Au ravito, le **2e tour = départ** du ravito ; sans 2e tour,
le départ est noté tout seul 150 m après le ravito (300 m après une base de vie). Les points sont aussi
validés tout seuls par la position. Un passage est annulé si le GPS calé te place ensuite à plus de 200 m
avant le point. Désactive le réglage si tu utilises le tour automatique (Auto Lap).

## Menu (appui long sur Haut)

Le menu d'EndurancePro, réglable en course comme dans le champ, avec en tête le dossier
**Trail Planner** :
- **Zoom du profil** ;
- **Couleurs des pentes** ;
- **Tour = passage au point** ;
- **Jusqu'à l'arrivée** (distance, D+ et D- restants jusqu'à l'arrivée sur l'écran Trail Planner) ;
- **Échelle de la carte** ;
- **Explorer la carte** (montres à cartes) ;
- **Code Trail Planner** : le code montre à 8 chiffres, le même que pour EndurancePro et le champ ;
- **Recharger le plan** (nom de la course chargée, ou message d'erreur).

Dans Garmin Connect (appli installée depuis le Store) : les réglages d'EndurancePro (code, référence
d'allure, zones VC, données FIT), plus le zoom, les couleurs des pentes, le tour = passage, l'échelle de la carte, et les réglages du
champ Trail Planner : rappel nutrition (-1 = produits du plan, N = toutes les N minutes, 0 = aucun),
vibrations, jusqu'à l'arrivée.

## Plan de la course et réglages EndurancePro

L'appli lit le **document du code montre** (onglet Montre de l'app web), via le téléphone, au lancement
puis toutes les 5 minutes. Envoie une course à la montre avec la touche ⌚. Quatre champs :
- `w`, le plan compact du champ (format TP1, `src/lib/watch.ts`) : nom, points de passage, temps prévus,
  tracé pour caler le GPS ;
- `wp`, le **profil fin** de l'appli (format TPP1, `watchProfile`) : altitudes le long du parcours à 2 m
  près sur une course normale, jusqu'à 6 000 caractères. Sur un ultra d'essai de 170 km, il garde plus de
  700 points, contre 50 à 150 sommets pour la ligne de dénivelé du plan du champ (qui laisse la place au
  tracé GPS). Ajouté la première fois que tu ouvres l'app web après sa mise à jour ; avant, le profil est
  tiré du plan seul (plus grossier, sans altitudes affichées) ;
- `wr`, le **tracé de la carte** (format TPR1, `watchRoute`, même codage que la ligne G du plan) : à
  3 m près sur une course normale, jusqu'à 10 000 caractères. Lu dans une requête à part, seulement
  quand le plan change. Sans lui (avant l'ouverture de l'app web mise à jour), la carte prend le tracé du
  plan, plus grossier sur les ultras ;
- `ep`, les **réglages EndurancePro** (VC, zones VC et VAM, équivalences montée / descente, zone de la
  séance envoyée), comme la synchro du champ EndurancePro : à activer dans l'onglet Montre (synchro
  EndurancePro). Le menu affiche l'heure de la dernière synchro (dossier Allure › Trail Planner).

## Suivi pour l'assistance

Comme le champ : le document `live/{code}` reçoit l'heure, le départ réel, la distance le long du
parcours, les passages (`indice:arrivée:départ`), la position et la batterie. Il est envoyé peu après
chaque passage (30 s au moins entre deux envois), sinon toutes les 5 minutes, et à la pause et à
l'enregistrement. Le lien assistance et le debrief de la course les lisent comme ceux du champ.

## Ce qui change par rapport à l'activité Trail de Garmin

- La sortie est enregistrée en **course à pied / trail** (fichier FIT avec GPS, cardio, tours et les
  champs d'EndurancePro), envoyée à Garmin Connect et à Strava comme une activité Trail.
- **Pas de guidage (virages), de ClimbPro ni de PacePro** de Garmin pendant cette activité : la carte de
  l'appli montre le parcours et ta position, et « Hors parcours » prévient d'un écart, mais le parcours
  n'est pas importé dans les parcours Garmin de la montre (pour la navigation Garmin, export FIT du plan
  à importer dans Garmin Connect, comme avant). La **distance restante** d'EndurancePro (prochain point, fin du
  parcours) vient de la navigation Garmin : elle reste vide dans l'appli.
- Le champ Trail Planner lui-même ne s'affiche pas dans une appli Connect IQ : son écran et ses calculs y
  sont repris (écran 2). Ses notifications de rappel sont remplacées par la bascule automatique.

## Code repris du champ Trail Planner

`source/TrailPlannerScreen.mc` et `source/Plan.mc` viennent du champ (`garmin/TrailPlannerField/source`,
commit 074f467). Changements, signalés « Appli : » dans le code : classe simple pilotée par l'appli (plan
donné par `Run`, `compute()` chaque seconde, `onTimerLap()` au Lap), plein écran au thème
d'EndurancePro, bascule automatique (`focusKey`) au lieu de l'alerte de champ de données, relevé du suivi
envoyé par l'appli au lieu de la tâche de fond ; profil fin (`wp`) ajouté au plan. Une évolution du champ
se reporte ici à la main.

## Code repris d'EndurancePro

`source/EnduranceProView.mc`, `EnduranceProSettingsMenu.mc`, `LayoutManager.mc`, `TrailSync.mc`,
`layouts/` et les ressources (`resources*/`, sauf `strings/companion.xml`, propres à l'appli) viennent
d'EndurancePro 2.7.3 (dépôt EnduranceProDatafield, commit 529d8a4). Changements, tous signalés en tête
de fichier :
- la vue n'est plus un champ de données : l'appli appelle `compute()` chaque seconde, `onLayout()` /
  `onUpdate()` depuis son écran, et `onTimerStart()` / `onTimerLap()` / `onTimerReset()` au départ, aux
  tours et à la fin ;
- les champs FIT sont créés sur la session d'enregistrement (`createFitFields`, au départ) ;
- la synchro passe par le téléchargement du plan (pas de tâche de fond) ;
- le menu a le dossier Trail Planner ; un nouveau code relance le téléchargement du plan ;
- `AppName` et `app_version` (« 0.2.0 (EndurancePro 2.7.3) ») propres à l'appli.

Une nouvelle version d'EndurancePro se reporte à la main dans ces fichiers.

## Compiler et installer

Comme le champ (voir `garmin/README.md`, sections 2 et 3) :
1. Dans VS Code avec l'extension Monkey C, ouvre le dossier `garmin/TrailPlannerCompanion`.
2. « Monkey C: Build for Device », choisis ta montre : un `.prg` est créé dans `bin/`.
3. Copie-le dans `GARMIN/APPS/` (montre branchée en USB). L'appli apparaît dans la liste des activités et
   applis.
4. Saisis le code montre dans le menu de l'appli (appui long sur Haut › Trail Planner › Code Trail Planner).

**Montres** (API Connect IQ 3.4 au moins, comme EndurancePro), chacune avec la mise en page EndurancePro
de sa résolution (`monkey.jungle`) :
- déjà visées par EndurancePro : Enduro 3, epix 2, epix 2 Pro 51 mm, fēnix 6X Pro, fēnix 7S, 7S Pro, 7X,
  7X Pro, 7 Pro, fēnix 8 Solar 47 et 51 mm, fēnix E, Forerunner 965 ;
- ajoutées, mise en page de la même résolution **à vérifier au simulateur** : fēnix 6 Pro et 6S Pro,
  fēnix 7 et 7 Pro sans Wi-Fi, fēnix 8 AMOLED 43 et 47 mm, fēnix 8 Pro 47 mm, Forerunner 255, 265 et 955.

Retirées par rapport au champ Trail Planner : fēnix 5 Plus (API 3.3), fēnix 9 (pas encore de mise en page
EndurancePro) ; et Venu 3 / Venu 4 d'EndurancePro (deux boutons seulement : START, BACK, Haut et Bas
n'y existent pas).

**Carte :** le fond de carte Garmin (`WatchUi.MapView`) est compilé pour toutes les montres sauf les
Forerunner 255 et 265 (`excludeAnnotations = map` dans `monkey.jungle`), qui ont l'écran Carte en tracé
seul. Si la compilation d'une autre montre échoue sur `MapView` (modèle sans cartes), lui ajouter la même
ligne.

**À vérifier à la première compilation :**
- sport de l'activité (`Activity.SPORT_RUNNING` / `Activity.SUB_SPORT_TRAIL` dans `Run.mc`) ; si le
  compilateur ne les trouve pas, remplacer par `ActivityRecording.SPORT_RUNNING` et
  `ActivityRecording.SUB_SPORT_TRAIL` ;
- mémoire avec EndurancePro et le plan d'un ultra (simulateur : *File › View Memory*) ;
- champs FIT d'EndurancePro dans l'activité enregistrée (Garmin Connect) ;
- au simulateur, charge un parcours (*Simulation › Activity Data*) et démarre la sortie avec START :
  le profil doit défiler avec toi, l'écran EndurancePro se remplir comme dans le champ ;
- écran Carte : tracé et repères posés sur le fond Garmin, carte recentrée sur toi, échelle respectée ;
  « Explorer la carte » : boutons de la carte Garmin pour déplacer et zoomer, BACK pour revenir (la
  répartition exacte des boutons en exploration dépend de la montre) ; mémoire avec la carte et le
  tracé d'un ultra.

# Trail Planner

Webapp de préparation de plans de course trail : temps de passage calculés à partir de ta
**vitesse critique (VC)**, de ton **D′**, de ta **vitesse ascensionnelle** et de ta **durabilité**.

## Fonctionnalités

**Profil et calibration**
- Profil athlète : VC (min/km), D′, seuil de marche, VAM selon la pente, coefficients de descente,
  durabilité (courbe log %VC₁ₕ − k·ln T, ou perte linéaire), produits de nutrition.
- Calculateur de VC : test 3′/7′/12′ (régression distance-temps), R², prédictions, historique.
- **Analyse de n'importe quelle séance** (GPX ou FIT de montre) : temps par zone (allure ramenée au plat),
  tours de la montre, meilleurs efforts comparés à VC + D′ (VC relevée si dépassée), détection d'un test VC ;
  prévu vs réalisé, intensité au fil des heures,
  VAM et descente mesurées par tranche de pente, comparaison point par point avec un plan,
  calibration du profil et historique des courses.

- **Séances d'étalonnage** : sortie longue, navettes tempo en côte, seuil en côte et sur le plat (20 min),
  **test VC 3′ / 7′ / 12′ en trois séances séparées** (échauffement de l'entraîneur, distance lue dans le tour
  « Corps de séance » de la montre, tests conservés d'un jour à l'autre), descentes. Cibles tirées du profil, entraînement structuré **FIT** pour la montre
  (`GARMIN/NewFiles`), analyse dédiée de l'enregistrement, mise à jour du profil et **graphiques d'évolution**.

**Plan de course**
- Import GPX, profil et **carte** (OpenTopoMap / OSM) synchronisés, ravitos d'un clic.
- Modes : VC + vitesse ascensionnelle, vitesse plat équivalente (Minetti), km-effort, comparaison.
- Facteurs : nuit (soleil), chaleur, **météo heure par heure** le long du parcours avec pluie
  (Open-Meteo), altitude, **technicité OpenStreetMap** (échelle SAC…) ou manuelle.
- **Bibliothèque de parcours d'entraînement** (onglet Parcours) : parcours modèles réutilisables (import GPX
  ou depuis une course), étiquettes et recherche, zones d'allure enregistrées ; « Planifier » crée une séance
  datée sans toucher au modèle ; liste des séances planifiées.
- **Traceur plein écran façon appli mobile** : carte entière, feuille du bas (téléphone) ou panneau (ordinateur)
  avec distance, D+/D−, temps, profil et points de repère (km, altitude, temps prévu à chaque point) ; barre
  réglages / annuler / rétablir / supprimer / OK. Sur téléphone, la feuille se glisse entre trois hauteurs : chiffres
  seuls, avec la barre d'édition et le profil, ou dépliée. Seuls le départ, les **points de repère** (A, B… posés sur
  un point, le tracé ou le profil, nommables) et l'arrivée sont listés ; les repères deviennent des points de passage
  de la course. Un point se pose par un appui maintenu un instant (clic à la
  souris) ; un toucher bref laisse déplacer la carte. **Hors-route automatique** : sur un chemin (à ~24 px près
  au zoom courant) le tracé le suit et s'y accroche, hors chemin il passe en ligne droite. Toucher un point ou
  un tronçon pour le supprimer, y insérer un point ou forcer son mode.
- **Icônes** (Lucide) dans la navigation et sur les boutons de toute l'appli.
- **Traceur de parcours sur carte** (onglet « Tracer ») : clic = point, l'itinéraire suit les sentiers
  d'OpenStreetMap (routeur public BRouter, profil randonnée montagne), le chemin le plus court ou une ligne
  droite hors sentier (altitude du modèle de terrain Open-Meteo) ; glisser un point, cliquer sur le tracé pour
  en insérer un, boucle, aller-retour, sens inverse, annuler (Ctrl+Z), recherche de lieu, bornes kilométriques,
  profil, distance, D+/D− et temps estimé selon le profil, à l'allure de course ou dans une zone choisie
  (Z1…Z7 : temps au milieu de la zone, fourchette haut/bas de zone ; la zone est enregistrée avec le parcours). Enregistré comme parcours d'entraînement ou comme
  course, export GPX ; « Modifier le tracé » rouvre un tracé (ou découpe une trace importée en points à déplacer).
  Import d'un GPX ou d'un FIT dans le traceur (bouton ou glisser-déposer), en remplacement ou à la suite du
  tracé en cours ; altitude complétée si le fichier n'en a pas.
- **Synchronisation EndurancePro** (datafield Garmin) : depuis le profil, VC, zones, équivalence montée
  (déduite de la VAM à VC) et zone de la séance envoyée à la montre sont publiés dans le document du code
  montre (champ `ep`) ; EndurancePro les lit en arrière-plan pour colorer l'allure et sonner par zone de VC.
- **Fonds de carte** : Plan IGN et photos aériennes IGN (France), OpenStreetMap (mis à jour en continu),
  OpenStreetMap France, carte nationale suisse, satellite, relief OpenTopoMap ; surcouches sentiers balisés
  (Waymarked Trails) et chemins de randonnée suisses. Le choix est mémorisé.
- **7 zones d'entraînement** en % de VC, celles du bilan VC (Z1 60–70 % récupération … Z5 96–105 %
  voisinage de VC, Z6 105–115 % supra-VC, Z7 > 115 % haute intensité), avec utilisation et durée tenable,
  réglables dans le profil. Couleurs Garmin (Z6 et Z7 : couleurs des zones de puissance), modifiables par zone.
- **Zones cardiaques en %** : méthode Grappe (échelle ESIE, i1 à i5 en % de FC max), Karvonen (% de la FC de
  réserve, avec la FC repos) ou perso (% de FC max ou de réserve) ; les bpm en sont déduits. Temps par zone
  cardiaque et FC moyenne des tours à l'analyse ; séances sur la montre guidées à l'allure ou à la FC.
- **Poids du sac** dans les coefficients de calcul de chaque course : temps allongé de 1 % par kg, ou au prorata
  du poids corporel du profil.
- **Zones d'allure en portions contiguës** (couleurs Garmin) : clic = fin de cycle, poignées à glisser pour
  déplacer une limite, barre de zones cliquable ; mode « Ravito » sur les compétitions.
- **Zones d'allure** : glisser sur le profil pour sélectionner une portion et lui donner une cible
  (zones d'entraînement en % de VC, % libre, allure plat équivalente ou allure imposée) ; export en
  entraînement Garmin découpé par distance — pour planifier aussi les allures d'entraînement.
- **D′** : relances en montée tant que le D′ le permet (bilan W′bal).
- **Fourchette** bonne journée / prévu / journée difficile pour chaque point.
- Points automatiques (distance, sommets, ruptures de pente, km-e, temps), barrières horaires,
  **plan nutrition** par tronçon (eau selon la chaleur, glucides, sodium, nombre de produits).
- Impression : A4 (profil, temps, sacs de ravito), bande, fiche assistance.
- Export Garmin **FIT** ou GPX horodaté (Garmin Connect → PacePro).

**Le jour J**
- **Mode course** sur téléphone : chrono, prochain point, passages d'un appui, avance/retard,
  recalcul de la suite, position GPS, écran maintenu allumé, hors ligne.
- **Lien assistance** public en lecture seule, mis à jour en direct.

**Montre Garmin**
- Champ de données Connect IQ (`garmin/`) : écart au plan, prochain point, barrières horaires,
  rappels nutrition ; la course choisie (« Mettre sur la montre ») se télécharge avec un code unique ;
  passages et position renvoyés au lien assistance toutes les 5 min (via le téléphone).
  Voir `garmin/README.md`.

**Compte et appareils**
- Multi-utilisateurs Firebase (Google ou lien e-mail), synchronisation temps réel, hors ligne,
  déconnexion propre, suppression du compte. Application installable (PWA).
- Firebase et la carte sont chargés à la demande (premier affichage ≈ 110 Ko compressés).

## Développement

```bash
npm install
npm run dev     # serveur de dev
npm test        # tests unitaires (calculs)
npm run build   # build de production dans dist/
```

Tests sur des GPX réels (affiche distance, D+, temps prévus) :

```bash
TP_GPX=chemin/course1.gpx,chemin/course2.gpx npx vitest run real
```

## Stockage et comptes (Firebase)

Sans configuration, les données restent dans le navigateur (export/import JSON possible).
Le projet Firebase `trail-planner-814f6` est déjà branché (configuration dans `src/lib/storage.ts`).
Pour utiliser un autre projet :

1. Sur [console.firebase.google.com](https://console.firebase.google.com), créer un projet (offre gratuite Spark).
2. *Authentication* → *Sign-in method* : activer **Google** et **E-mail/Lien (connexion sans mot de passe)**.
   Dans *Settings* → *Authorized domains*, ajouter le domaine GitHub Pages (`<utilisateur>.github.io`).
3. *Firestore Database* → créer la base (mode production), puis coller le contenu de `firestore.rules`
   dans l'onglet *Règles* : chaque utilisateur n'accède qu'à ses propres données ; les liens
   d'assistance (`shares`) sont lisibles par lien et modifiables par leur seul propriétaire.
4. *Paramètres du projet* → *Vos applications* → ajouter une app Web, puis reporter `apiKey`, `authDomain`,
   `projectId` et `appId` dans `VITE_FIREBASE_*` (fichier `.env` en local, *Variables* du dépôt GitHub
   pour le déploiement). Ces valeurs ne sont pas secrètes : la sécurité repose sur les règles Firestore.

Les GPX sont compressés (gzip) et découpés si besoin pour respecter la limite de 1 Mio par document.

## Déploiement

Le workflow `.github/workflows/deploy.yml` publie sur GitHub Pages à chaque push sur `main`
(activer Pages avec la source « GitHub Actions » dans les paramètres du dépôt).

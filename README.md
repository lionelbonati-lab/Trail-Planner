# Trail Planner

Webapp de préparation de plans de course trail : temps de passage calculés à partir de ta
**vitesse critique (VC)**, de ton **D′**, de ta **vitesse ascensionnelle** et de ta **durabilité**.

## Fonctionnalités

**Profil et calibration**
- Profil athlète : VC (min/km), D′, seuil de marche, VAM selon la pente, coefficients de descente,
  durabilité (courbe log %VC₁ₕ − k·ln T, ou perte linéaire), produits de nutrition.
- Calculateur de VC : test 3′/7′/12′ (régression distance-temps), R², prédictions, historique.
- **Analyse d'activités** (GPX ou FIT de montre) : prévu vs réalisé, intensité au fil des heures,
  VAM et descente mesurées par tranche de pente, comparaison point par point avec un plan,
  calibration du profil et historique des courses.

- **Séances d'étalonnage** : sortie longue, navettes tempo en côte, seuil en côte et sur le plat (20 min),
  test 3′/7′/12′, descentes. Cibles tirées du profil, entraînement structuré **FIT** pour la montre
  (`GARMIN/NewFiles`), analyse dédiée de l'enregistrement, mise à jour du profil et **graphiques d'évolution**.

**Plan de course**
- Import GPX, profil et **carte** (OpenTopoMap / OSM) synchronisés, ravitos d'un clic.
- Modes : VC + vitesse ascensionnelle, vitesse plat équivalente (Minetti), km-effort, comparaison.
- Facteurs : nuit (soleil), chaleur, **météo heure par heure** le long du parcours avec pluie
  (Open-Meteo), altitude, **technicité OpenStreetMap** (échelle SAC…) ou manuelle.
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

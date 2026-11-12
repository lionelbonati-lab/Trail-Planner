# Trail Planner

Webapp de préparation de plans de course trail : temps de passage calculés à partir de ta
**vitesse critique (VC)**, de ton **D′**, de ta **vitesse ascensionnelle** et de ta **durabilité**.

## Fonctionnalités

- **Synchronisation** Firebase en temps réel entre appareils (connexion Google ou lien e-mail), avec
  envoi automatique des données locales à la première connexion et fonctionnement hors ligne.
- **Multi-utilisateurs** : chacun se connecte avec son propre compte et ne voit que ses données
  (règles Firestore par utilisateur). Déconnexion avec effacement du cache local (appareil partagé),
  import facultatif des données saisies sans compte, suppression du compte et des données.
- **Application installable** (PWA) sur ordinateur et téléphone, utilisable sans réseau.
- **Météo** : prévision Open-Meteo à 15 jours, sinon normales des 5 dernières années aux mêmes dates.
- **Profil athlète** : VC (min/km), D′, seuil de marche, VAM selon la pente, coefficients de descente,
  durabilité au choix :
  - *courbe log* : %VC moyen tenable sur T heures = %VC₁ₕ − k·ln(T) ;
  - *perte linéaire* : %VC de départ, puis −X %/h après un seuil.
- **Calculateur de VC** : test 3′/7′/12′ (ou N essais), régression distance-temps → VC, D′, R²,
  prédictions et historique.
- **Courses** : import GPX (trace + waypoints), profil interactif, clic sur le profil pour ajouter un ravito.
- **Modes de calcul** : VC + vitesse ascensionnelle (physiologique), vitesse à plat équivalente (Minetti),
  km-effort (coefficients réglables), comparaison côte à côte.
- **Facteurs** : nuit (soleil calculé selon la position et l'heure), chaleur (cycle jour/nuit + gradient
  d'altitude), altitude, technicité (estimée par la pente, corrigeable par tronçon).
- **Points automatiques** : tous les X km, sommets/points bas, ruptures de pente, tous les X km-e ou X minutes.
- **Ravitos** : temps d'arrêt, barrières horaires (marge et alerte), eau/glucides calculés entre ravitos, notes.
- **Impression** : feuille A4 (profil + tableau), bande compacte à découper, fiche assistance avec fenêtre de passage.
- **Export Garmin** : parcours **FIT** (ou GPX) horodaté selon le plan, avec points de ravito / sommets, à importer
  dans Garmin Connect puis à transformer en stratégie PacePro.
- **Calibration** : ajuste ta durabilité pour retrouver un temps réellement réalisé.

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
   dans l'onglet *Règles* : chaque utilisateur n'accède qu'à ses propres données.
4. *Paramètres du projet* → *Vos applications* → ajouter une app Web, puis reporter `apiKey`, `authDomain`,
   `projectId` et `appId` dans `VITE_FIREBASE_*` (fichier `.env` en local, *Variables* du dépôt GitHub
   pour le déploiement). Ces valeurs ne sont pas secrètes : la sécurité repose sur les règles Firestore.

Les GPX sont compressés (gzip) et découpés si besoin pour respecter la limite de 1 Mio par document.

## Déploiement

Le workflow `.github/workflows/deploy.yml` publie sur GitHub Pages à chaque push sur `main`
(activer Pages avec la source « GitHub Actions » dans les paramètres du dépôt).

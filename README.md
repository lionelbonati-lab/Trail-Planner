# Trail Planner

Webapp de préparation de plans de course trail : temps de passage calculés à partir de ta
**vitesse critique (VC)**, de ton **D′**, de ta **vitesse ascensionnelle** et de ta **durabilité**.

## Fonctionnalités

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
- **Export Garmin** : GPX de parcours horodaté avec waypoints (heures de passage) à importer dans Garmin Connect,
  puis à transformer en stratégie PacePro.
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

## Stockage et comptes (Supabase)

Sans configuration, les données restent dans le navigateur (export/import JSON possible).
Pour la synchronisation multi-appareils :

1. Créer un projet Supabase et exécuter `supabase/migrations/20261112000000_init.sql`.
2. Activer l'authentification par e-mail (lien magique) et ajouter l'URL du site dans *Redirect URLs*.
3. Renseigner `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (fichier `.env` en local, *variables*
   du dépôt GitHub pour le déploiement).

## Déploiement

Le workflow `.github/workflows/deploy.yml` publie sur GitHub Pages à chaque push sur `main`
(activer Pages avec la source « GitHub Actions » dans les paramètres du dépôt).

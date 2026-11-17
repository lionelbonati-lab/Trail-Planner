# Partage public de parcours — plan (mis de côté)

État : **en attente**, rien n'est codé. Plan proposé le 17 novembre 2026 ; à reprendre plus tard.

## Principe

Le créateur rend **public** un parcours ou une course. N'importe qui peut chercher par nom, **autour de soi**
ou **autour d'un lieu dans un rayon de X km**, puis l'**ajouter à sa bibliothèque** (une copie). Tout reste
dans Firebase (Firestore) : on ne touche pas au projet Supabase.

## Décisions prises

- **Copie indépendante** : une copie ne se met jamais à jour toute seule.
- **Original modifié** : si le créateur change l'original après la copie, l'appli le signale sur la copie
  (bandeau « L'original a été modifié le … ») avec deux choix :
  - **Mettre à jour** : reprend le tracé et les points de course de l'original.
  - **Ignorer** : garde la copie telle quelle jusqu'à la prochaine modification de l'original.
- **Mise à jour à tout moment** : en plus du bandeau, un bouton « Mettre à jour depuis l'original » reste
  disponible sur la copie, que l'original ait changé ou non (tant qu'il est encore public).
- **Original supprimé** (ou retiré du public) : les copies ne sont **pas** supprimées. La copie indique que
  l'original n'est plus disponible, et le bouton de mise à jour disparaît.

## Ce qui est publié

- Tracé, distance, D+, profil, lieu de départ (commune trouvée via Nominatim / OpenStreetMap), points de
  course (ravitos, bases de vie, barrières horaires), date de départ pour une course.
- **Jamais** : heures prévues, nutrition, debriefs, suivi en direct, lien assistance, profil de l'athlète.
- La version publique suit l'original automatiquement (comme les liens assistance). « Retirer du public »
  la supprime immédiatement ; les copies déjà faites restent chez ceux qui les ont.

## Recherche

- **Texte** : nom, commune, étiquettes (« côte », « boucle »…).
- **Autour de moi** (GPS du téléphone) ou **d'un lieu tapé** (même recherche que dans Tracer), rayon réglable
  de 5 à 100 km, mesuré depuis le point de départ du parcours.
- **Filtres** : course ou parcours, distance, D+ ; pour les courses, une période (par défaut : à venir).
- **Résultats** en liste et sur une carte ; fiche d'un résultat avec profil, carte, points et le bouton
  « Ajouter à ma bibliothèque ».

## Technique

- Nouvelle collection Firestore publique (ex. `public/{id}` + GPX compressé en morceaux comme
  `users/{uid}/races/{id}/gpx`) : lecture pour tous, écriture par le seul créateur (`owner`).
  **Règles Firestore à redéployer.**
- Pas de recherche plein texte dans Firestore : liste de **mots-clés** normalisés par parcours
  (`array-contains`), affinée côté appli.
- Recherche par rayon : **geohash** du départ, requêtes par plages de zones puis filtrage à la distance
  exacte (méthode geofire). Gratuit à notre échelle (quota Firestore).
- Copie : garder l'identifiant de l'original et la date de sa version copiée, pour détecter une
  modification et proposer la mise à jour.

## Où dans l'appli

- Page Parcours : sélecteur « Mes parcours | Publics » (pas de nouvel onglet : la barre du téléphone est pleine).
- Sur chaque parcours ou course : interrupteur « Public ».

## Découpage proposé

1. Publication (interrupteur, copie publique, retrait), page « Publics » avec recherche par texte, copie dans
   sa bibliothèque, détection d'un original modifié et mise à jour de la copie (bandeau + bouton).
2. Recherche autour de moi ou d'un lieu à X km, carte des résultats, filtres.
3. Plus tard : « passe à moins de X km » (n'importe quel point du tracé), nombre de copies, signalement d'un
   parcours.

## Questions encore ouvertes

1. Compte nécessaire pour chercher ? Proposé : recherche sans compte, ajout à sa bibliothèque avec compte.
2. Vie privée : un parcours d'entraînement part souvent de chez soi. Proposé : avertissement à la publication
   et option « masquer les 500 premiers et derniers mètres » ; autre option : ne publier que les courses.
3. Nom affiché du créateur : pseudo, prénom ou anonyme ?
4. Rayon mesuré depuis le départ seulement (proposé pour commencer) ou depuis n'importe quel point du tracé ?
5. Mise à jour d'une copie : que deviennent les modifications faites sur la copie (points ajoutés, arrêts
   changés) ? À trancher : tout remplacer, ou garder les ajouts de la copie.

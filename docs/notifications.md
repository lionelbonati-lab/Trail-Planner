# Notifications push — mise en route

Les notifications arrivent sur le téléphone même quand la page ou l'appli est fermée. Elles sont envoyées par
deux fonctions Cloud (dossier `functions/`) qui surveillent Firestore :

| Quoi | Pour qui | Déclencheur |
| --- | --- | --- |
| Passage à un point (heure, km, écart au plan) | assistance abonnée au lien | relevé de la montre (`live/{code}`) ou passage noté en mode course (`shares/{id}`) |
| Retard : à chaque quart d'heure de plus sur le plan | assistance | relevé de la montre |
| Barrière horaire menacée : moins de 30 min de marge estimée | assistance | relevé de la montre |
| Debrief prêt (arrivée, temps, écart) | coureur connecté, « Me prévenir à l'arrivée » activé | arrivée relevée |

Les règles (quoi envoyer, et quand) sont dans `src/lib/pushRules.ts`. Un même passage n'est envoyé qu'une fois,
même si la montre et le mode course le relèvent tous les deux.

Tant que le serveur n'est pas en place, rien ne change dans l'appli : la page assistance prévient elle-même
tant qu'elle reste ouverte, et le « Me prévenir » du serveur n'apparaît pas.

## À faire une fois (environ 15 min)

### 1. Passer le projet Firebase au forfait Blaze

Les fonctions Cloud demandent le forfait Blaze (paiement à l'usage). À notre échelle, elles restent dans la
part gratuite (2 millions d'appels par mois ; un relevé de montre toutes les 5 min en course donne quelques
centaines d'appels).

1. [Console Firebase](https://console.firebase.google.com) → projet **trail-planner-814f6** → en bas à gauche
   **Spark** → **Mettre à niveau** → **Blaze**, et rattacher un compte de facturation.
2. Recommandé : dans la même fenêtre, ou dans Google Cloud → *Facturation* → *Budgets et alertes*, créer un
   budget de 1 € avec une alerte par e-mail.

### 2. Clé de déploiement pour GitHub

Elle permet à GitHub de déployer les fonctions et les règles Firestore à chaque modification.

1. [Google Cloud → IAM → Comptes de service](https://console.cloud.google.com/iam-admin/serviceaccounts?project=trail-planner-814f6)
   → **Créer un compte de service**, nom `github-deploy`.
2. Lui donner ces rôles :
   - Administrateur Firebase (`Firebase Admin`)
   - Administrateur Cloud Functions (`Cloud Functions Admin`)
   - Utilisateur du compte de service (`Service Account User`)
   - Administrateur de l'IAM du projet (`Project IAM Admin`) : le premier déploiement donne lui-même les
     droits nécessaires aux services de Google (déclencheurs Firestore).
   - Si un déploiement échoue sur une permission, le journal de l'action GitHub nomme le rôle qui manque :
     l'ajouter ici, puis relancer l'action.
3. Sur le compte créé : **Clés** → **Ajouter une clé** → **JSON**. Un fichier se télécharge.
4. GitHub → dépôt **Trail-Planner** → *Settings* → *Secrets and variables* → *Actions* → onglet **Secrets** →
   **New repository secret** : nom `FIREBASE_SERVICE_ACCOUNT`, valeur : tout le contenu du fichier JSON.
5. Supprimer le fichier téléchargé de l'ordinateur.

Puis *Actions* → **Deploy Firebase (notifications, règles)** → **Run workflow**. Le premier déploiement prend
quelques minutes (il active aussi les services Google nécessaires). La région des fonctions suit celle de la base
Firestore ; pour la forcer, ajouter une variable `FUNCTIONS_REGION` (onglet **Variables**, ex. `europe-west1`).

À savoir : ce déploiement publie aussi `firestore.rules`. Les règles modifiées directement dans la console
Firebase seraient remplacées : les reporter d'abord dans le fichier.

### 3. Clé Web Push (une fois les fonctions déployées)

1. Console Firebase → ⚙️ *Paramètres du projet* → onglet **Cloud Messaging** → *Configuration Web* →
   *Certificats Web Push* → **Générer une paire de clés**.
2. Copier la clé affichée (elle est publique, ce n'est pas un secret).
3. GitHub → *Settings* → *Secrets and variables* → *Actions* → onglet **Variables** → **New repository variable** :
   nom `VITE_FIREBASE_VAPID_KEY`, valeur : la clé.
4. Relancer *Actions* → **Deploy to GitHub Pages** (ou attendre la prochaine modification).

Le bouton **Me prévenir** apparaît alors sur les pages assistance et le lien permanent, et « Me prévenir à
l'arrivée » (carte *Sorties et debriefs*) passe par le serveur pour un coureur connecté.

## Essayer

1. Sur le téléphone de l'assistance : ouvrir le lien assistance d'une course envoyée à la montre →
   **Me prévenir** → autoriser.
   Sur iPhone : ajouter d'abord la page à l'écran d'accueil (Partager → *Sur l'écran d'accueil*) et l'ouvrir
   depuis l'icône (iOS 16.4 ou plus).
2. Fermer la page, lancer une activité avec le champ Trail Planner et passer le premier point : la notification
   arrive au relevé suivant de la montre (toutes les 5 min au mieux).
3. Journal des envois : Google Cloud → *Cloud Run* → fonctions `onwatchreport` et `onshareupdate` → *Journaux*.

## Données

- `push/{id}` : abonnements d'un téléphone à un lien (`target` : `share:<id>` ou `suivi:<code montre>`). Écrits
  sans compte (comme les relevés de la montre), lus par le serveur seul ; supprimés quand le téléphone se
  désabonne ou que son jeton n'est plus valable.
- `users/{uid}/push/{id}` : téléphones du coureur pour « Debrief prêt ».
- `push_state/{id}` : ce qui a déjà été notifié pour un lien (serveur seul).
- `live/{code}/track/current` : trace de la sortie libre en cours ou récente (rien sur la montre), un point
  par relevé de la montre. Écrite par la même fonction, lisible par le lien permanent.

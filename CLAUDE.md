# Trail Planner — consignes pour Claude

## Façon de travailler (préférences de Lionel)

- **Toujours poser des questions pour affiner** avant de coder une demande (choix d'affichage, seuils,
  cas limites), avec des options et une recommandation ; puis, une fois livré, proposer les
  ajustements possibles sous forme de questions.
- **Toujours pousser sur `main`** en plus de la branche de travail, sans redemander : avance rapide ;
  si `main` a bougé, rebaser d'abord, relancer les vérifications, puis pousser.
- Répondre en français.

## Vérifications avant de pousser

```bash
npx tsc -b
```

```bash
npx vitest run
```

```bash
npx oxlint src
```

Contrôle visuel des écrans modifiés (vue téléphone) quand c'est de l'interface.

## À savoir

- Le champ de données Garmin (`garmin/TrailPlannerField`, Monkey C) ne peut pas être compilé ici
  (pas de SDK Connect IQ) : changements minimes, dans le style du fichier, et à faire compiler et
  tester sur la montre par Lionel.
- Les règles Firestore (`firestore.rules`) n'acceptent qu'une liste fixe de champs dans `live/{code}`
  (relevés de la montre) : un nouveau champ bloque tous les envois tant que les règles ne sont pas
  redéployées. Préférer étendre un champ existant de façon compatible (ex. `p` :
  `indice:arrivée:départ`).
- Notifications push : fonctions Cloud dans `functions/` (règles d'envoi partagées dans `src/lib/pushRules.ts`),
  déployées avec les règles Firestore par `.github/workflows/firebase.yml` une fois le secret
  `FIREBASE_SERVICE_ACCOUNT` en place (voir `docs/notifications.md`). Vérifier aussi `npx tsc -p functions`.
- Le plan envoyé à la montre (format TP1, `src/lib/watch.ts`) est lu par d'anciennes versions du
  champ : n'ajouter que des champs optionnels en fin de ligne.

# Site sur Infomaniak — mise en route

L'appli est un site statique (dossier `dist/` produit par `npm run build`) : elle tourne sur n'importe quel
hébergement Web en HTTPS. Les données restent chez Firebase (Google), rien ne change pour les montres.
L'action GitHub `.github/workflows/infomaniak.yml` construit le site et l'envoie à la racine du site
Infomaniak à chaque modification sur `main`. Sans les réglages ci-dessous, elle ne fait rien.

## 1. Accès FTP / SSH chez Infomaniak

Manager Infomaniak → **Hébergement Web** → ton hébergement → **FTP / SSH** (menu de gauche) → ajouter un
compte. Note :
- l'**adresse du serveur** affichée sur cette page (de la forme `xxxx.ftp.infomaniak.com`) ;
- le **nom d'utilisateur** (de la forme `xxxx_nom`) et son **mot de passe**.

Protocole selon l'offre :
- **Hébergement Web (payant)** : **SFTP**, port 22 (recommandé), ou **FTPES** (FTP chiffré), port 21.
- **Starter (gratuit, avec le domaine)** : seulement du **FTP non chiffré**, port 21 (le mot de passe circule
  en clair) ; pas de SSH. Sur Starter, l'adresse du serveur peut être l'adresse IP indiquée par le Manager.

## 2. Dossier du site

Sur un hébergement Web, chaque site a son dossier, en général `sites/ton-domaine.ch` (le Manager l'indique
dans les réglages du site). Sur Starter, c'est la racine de l'hébergement.

**Avant le premier envoi**, vide ce dossier ou enregistre ailleurs ce que tu veux garder (ancien site,
page d'accueil posée par Infomaniak) : l'appli prend sa place. Les fichiers déjà présents ne sont pas
supprimés par l'envoi (seul le dossier `assets/` de l'appli est nettoyé) ; le fichier `.htaccess` de
l'appli fait passer sa page `index.html` avant un ancien `index.php`.

## 3. Réglages dans GitHub

Dépôt **Trail-Planner** → *Settings* → *Secrets and variables* → *Actions* :

| Onglet | Nom | Valeur |
| --- | --- | --- |
| Secrets | `INFOMANIAK_PASSWORD` | mot de passe du compte FTP / SSH |
| Variables | `INFOMANIAK_HOST` | adresse du serveur |
| Variables | `INFOMANIAK_USER` | nom d'utilisateur FTP / SSH |
| Variables | `INFOMANIAK_DIR` | dossier du site, ex. `sites/ton-domaine.ch` (vide sur Starter) |
| Variables | `INFOMANIAK_PROTOCOL` | `sftp` (par défaut), `ftpes` ou `ftp` (Starter) |
| Variables | `INFOMANIAK_PORT` | facultatif : 22 en SFTP, 21 en FTP / FTPES |

Puis *Actions* → **Deploy to Infomaniak** → **Run workflow**. Ensuite, chaque modification sur `main` est
envoyée toute seule.

## 4. HTTPS

Manager → ton site → certificat **SSL Let's Encrypt** (gratuit) et **forcer HTTPS**. Obligatoire : sans
HTTPS, pas d'installation sur le téléphone, ni notifications, ni position.

## 5. Firebase : autoriser le domaine

[Console Firebase](https://console.firebase.google.com) → projet **trail-planner-814f6** → *Authentication* →
*Paramètres* → **Domaines autorisés** → ajouter `ton-domaine.ch` (et `www.ton-domaine.ch` si le site y
répond). Sans ça, la connexion Google et le lien de connexion par e-mail sont refusés.

## 6. Vérifier, puis arrêter GitHub Pages

Sur le nouveau site : connexion, une course, le lien assistance (il pointe maintenant vers ton domaine),
l'onglet Montre. Si tout va bien, demande l'arrêt de GitHub Pages : le workflow `deploy.yml` sera retiré,
et dans GitHub → *Settings* → *Pages*, **Unpublish site** met le site hors ligne. Les liens assistance déjà
donnés (`lionelbonati-lab.github.io/…`) ne marcheront plus : donne à ton assistance le nouveau lien
permanent (onglet Montre). Les notifications « Me prévenir » sont à réactiver sur le nouveau site.

## Détails

- `public/.htaccess` (copié dans le site) : `index.html`, `sw.js` et le manifeste toujours revérifiés (mises
  à jour visibles tout de suite), fichiers `assets/` (noms à empreinte) gardés en cache un an.
- Ordre d'envoi : nouveaux fichiers `assets/`, puis la page et le reste, puis les anciens `assets/` retirés,
  et un dernier passage de contrôle qui renvoie un fichier incomplet. La page en ligne ne pointe jamais vers
  un fichier absent.
- SFTP : la clé du serveur est relevée à chaque envoi.

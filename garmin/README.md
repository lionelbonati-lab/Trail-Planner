# Champ de données Garmin « Trail Planner »

Champ de données Connect IQ qui s'affiche dans ton activité Trail habituelle (GPS, navigation,
ClimbPro et PacePro continuent de fonctionner) :

- **écart au plan** à l'endroit exact où tu es (`+6'` = 6 min de retard, en rouge ; avance en vert) ;
- **prochain point** : nom, distance, heure prévue (fixe) et heure estimée (recalculée à chaque passage) ;
- **bouton Lap = passage** au point le plus proche : heure de passage notée, position recalée, heures
  estimées des points suivants recalculées (écran « Passage · nom » 5 s) ;
- **marge sur la prochaine barrière horaire**, avec vibration si elle passe sous 30 min ;
- **rappels nutrition** (vibration + écran « Manger / boire » 30 s) selon ton plan ;
- avant le départ : nom de la course et heure de départ prévue ;
- **suivi pour l'assistance** : passages réels, position et batterie envoyés toutes les 5 min via ton
  téléphone ; ils s'affichent sur le lien assistance de la course (position sur le profil, écart au plan,
  heures estimées recalculées).

![Aperçu approximatif sur Enduro 3 (écran rond 280 px)](apercu-enduro3.png)

*Aperçu approximatif (polices Garmin simulées). Sur écran rond, l'écart — le texte le plus court — se
place du côté du bord arrondi et les textes trop longs sont raccourcis à la largeur disponible.*

**Heures prévues et estimées.** Les heures prévues restent celles du plan pendant toute l'activité. Les
heures estimées des points sont recalculées **à chaque passage** (bouton Lap, ou point atteint d'après la
position) d'après ce qui a déjà été fait : rythme réel au dernier point passé par rapport au plan, prolongé
sur la suite (amorti de 30 %, borné), arrêts prévus non étirés ; entre deux passages elles ne bougent pas.
Avant le premier passage, estimé = prévu. L'écart au plan (`+6'`), lui, suit ta position en continu. Même
règle sur le lien assistance et dans le mode course de l'app.

**Bouton Lap.** Un tour valide le passage au point le plus proche pas encore validé, à moins de 300 m de ta
position (8 % de la distance si le plan n'a pas de tracé) ; un tour loin de tout point est ignoré.
**Désactive le tour automatique (Auto Lap)** de ton activité Trail, sinon un tour auto tombant près d'un
point le validerait. Réglage « Tour = passage au point » sur la montre (appui long › Champs Connect IQ ›
Trail Planner) pour couper cette fonction.

**Position le long du parcours : GPS calé sur le tracé.** Le plan contient le tracé simplifié du
parcours ; à chaque seconde, la position GPS est ramenée sur ce tracé, près de l'endroit attendu (dernier
calage + distance faite depuis). La distance de la montre ne sert qu'entre deux relevés : pas d'erreur
cumulée (distance GPS trop longue ou trop courte), et un raccourci ou un détour se recale dès le retour sur
le tracé. Hors du tracé (5 s de suite), la distance reste figée et le champ affiche **« Hors parcours ·
N m »** en rouge ; sans GPS (tunnel…), elle avance avec la distance de la montre. Un aller-retour ou une
boucle qui repasse au même endroit ne trompe pas le calage (il cherche près de la position attendue).
Si le parcours change (modifié dans l'app web), la montre reçoit le nouveau plan dans les 5 min et se
recale sur tout le parcours, en gardant les passages déjà notés. Plan d'une ancienne version (sans
tracé) : navigation du parcours FIT si elle est active, sinon distance parcourue.

## 1. Envoyer une course à la montre (app web)

Connecté, sur la page d'une course : **⌚ Mettre sur la montre**. L'app affiche ton **code montre à
8 chiffres** (le même pour toutes tes courses, et le même que pour EndurancePro), plus un code long pour
Garmin Connect. Pour changer de course, clique « Mettre sur la montre » sur une autre :
la montre la récupère d'elle-même.

## 2. Compiler le champ

1. Installe le **SDK Connect IQ** : <https://developer.garmin.com/connect-iq/sdk/> (SDK Manager → dernier SDK
   + le profil de ta montre).
2. Installe **VS Code** et l'extension **Monkey C** (Garmin), puis « Monkey C: Generate a Developer Key ».
3. Ouvre le dossier `garmin/TrailPlannerField`.
4. Ta montre doit figurer dans `manifest.xml` (`<iq:products>`, l'Enduro 3 y est : `enduro3`).
   Sinon : « Monkey C: Edit Products ».
5. « Monkey C: Build for Device » → choisis ta montre → un fichier `.prg` est créé dans `bin/`.

Pour essayer sans montre : « Monkey C: Run » lance le simulateur. Charge un parcours (*Simulation →
Activity Data → FIT/GPX*) et règle le code via *File → Edit Persistent Storage / Application Properties*.

## 3. Installer et régler

**Par câble (le plus rapide pour tester)** : branche la montre en USB et copie le `.prg` dans
`GARMIN/APPS/`. Les réglages de l'app Garmin Connect ne sont pas disponibles pour une installation par
câble : **saisis le code à 8 chiffres sur la montre**. Pendant une activité, appui long sur Haut (menu) ›
Champs Connect IQ › Trail Planner › Code montre, règle les 8 chiffres et valide (00000000 efface le code).
Autre possibilité : coller le code long dans `resources/settings/properties.xml`
(`<property id="code" …>TON_CODE</property>`) avant de compiler.

**Par le Connect IQ Store (version « bêta » privée)** : publie le `.iq` (« Monkey C: Export Project ») en
bêta sur <https://apps.garmin.com/developer>. Une fois installé depuis le Store, les réglages sont
modifiables dans l'app Garmin Connect : *Appareils → ta montre → Activités et applications → Trail Planner
→ Paramètres* (code montre, intervalle des rappels nutrition, vibrations).

Puis, sur la montre : activité **Trail → Paramètres → Écrans de données** → ajoute un champ
**Connect IQ → Trail Planner** (idéalement en grand : demi-écran ou plein écran).

## 4. Le jour de la course

1. Dans l'app web, la course est « Sur la montre ✓ ». Le parcours FIT (navigation, flèches) reste utile
   pour te guider, mais le champ n'en a plus besoin : il a son propre tracé.
2. Quelques minutes avant le départ, **ouvre l'activité Trail avec le parcours, téléphone à proximité** :
   le champ télécharge le plan (contrôle toutes les 5 min, minimum imposé par Garmin) et affiche
   « Départ hh:mm ».
3. Démarre l'activité : le champ fonctionne ensuite sans réseau. Si ton téléphone est avec toi, ton
   assistance suit ta progression sur le lien assistance de la course (créé depuis l'app web,
   « 👥 Lien assistance »).

Messages possibles : « Saisis le code montre », « Plan en attente... » (pas encore téléchargé : téléphone
connecté ?), « Code inconnu » (code erroné ou course pas encore envoyée), « Plan : erreur N ».

## Limites connues

- Écrit sans accès au SDK Garmin : la première compilation peut demander de petites corrections
  (signale-les, avec le message d'erreur).
- Mémoire limitée : le plan tient en 7 Ko au plus (limite de la tâche de fond Garmin : 8 Ko). Le tracé
  prend la place restante : simplifié à 8 m près sur un trail court, jusqu'à 100–150 m sur un ultra avec
  beaucoup de points (UTMB) ; dans les lacets simplifiés, la distance de la montre prend le relais à
  l'intérieur du segment, et l'écart reste de l'ordre de 100–200 m au lieu de plusieurs km cumulés.
- Suivi pour l'assistance : toutes les 5 min au mieux (minimum imposé par Garmin), et seulement si le
  téléphone est avec toi, l'app Garmin Connect connectée et du réseau mobile. Sans réseau, les passages
  restent sur la montre et partent au prochain envoi réussi.

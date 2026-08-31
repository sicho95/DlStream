# SichoStream PWA — POC statique GitHub Pages

SichoStream est une PWA **100 % HTML/CSS/JavaScript statique**, sans Node, Docker, FFmpeg ni dépendance npm côté application.

Objectif :

- installer la PWA sur iPhone/iPad depuis GitHub Pages ;
- configurer l'URL de la plateforme de streaming personnelle ;
- naviguer dans cette plateforme depuis l'app ;
- recevoir automatiquement l'URL du média sélectionné ;
- lire un MP4 ou un HLS natif avec le lecteur iOS et AirPlay ;
- lancer un **vrai téléchargement de fichier** pour le retrouver dans Fichiers puis l'ouvrir avec VLC/Infuse.
- rester entièrement statique : tous les fichiers de la PWA sont du texte, y compris l'icône SVG.

## 1. Déployer sur GitHub Pages

Mettre directement les fichiers de ce dossier à la racine d'un dépôt GitHub.

Dans GitHub :

1. `Settings` → `Pages` ;
2. `Deploy from a branch` ;
3. choisir `main` et `/ (root)` ;
4. ouvrir l'URL GitHub Pages obtenue dans Safari sur iPhone/iPad ;
5. `Partager` → `Sur l'écran d'accueil`.

Les chemins du projet sont relatifs, donc il fonctionne aussi sur une URL du type :

`https://sicho95.github.io/DlStream/`

## 2. Configurer la plateforme

Dans SichoStream → `Réglages`, saisir l'URL de la plateforme personnelle.

Le POC utilise `https://didvip.com/` comme URL initiale uniquement pour vérifier la navigation. Il ne tente pas d'extraire les médias de ce site.

### Limite iframe

Un site distant peut interdire l'affichage dans une iframe via :

- `Content-Security-Policy: frame-ancestors ...`
- `X-Frame-Options`

Ta plateforme devra autoriser l'origine de la PWA GitHub Pages, ou être servie sous un domaine qui l'autorise.

## 3. Connecter une page vidéo à SichoStream

Une PWA hébergée sur GitHub Pages ne peut pas lire le DOM d'une iframe située sur un autre domaine : c'est la règle de sécurité `same-origin` du navigateur.

Le dossier `integration/` contient donc un bridge JavaScript de quelques lignes à ajouter à TA plateforme.

Dans `integration/platform-bridge.js`, remplacer :

```js
const PWA_ORIGIN = 'https://sicho95.github.io';
```

par l'origine réelle de la PWA. Pour ce dépôt, la valeur est déjà configurée pour `https://sicho95.github.io`.

Quand une page connaît son média, appeler :

```js
SichoStream.exposeMedia({
  title: 'Ma vidéo',
  streamUrl: 'https://media.mondomaine.fr/video/master.m3u8',
  downloadUrl: 'https://media.mondomaine.fr/download/video.mp4',
  filename: 'Ma-video.mp4'
});
```

La PWA vérifie que le message provient bien de l'origine configurée dans ses réglages.

## 4. Lecture et AirPlay

Le lecteur de la PWA utilise un `<video>` HTML5 natif avec :

```html
playsinline
x-webkit-airplay="allow"
```

iPhone/iPad peut donc lire directement :

- MP4 compatibles Safari ;
- HLS `.m3u8` compatibles Safari.

AirPlay est proposé par le lecteur iOS lorsque le média est compatible.

## 5. Vrai téléchargement iPhone/iPad

Pour un film de plusieurs Go, la PWA **ne doit pas** faire `fetch()` puis construire un `Blob` : cela chargerait potentiellement le film entier en mémoire.

Le bouton `Télécharger le fichier` ouvre donc directement `downloadUrl`.

Pour garantir un vrai téléchargement, l'endpoint de TA plateforme ou de TON NAS/cloud doit renvoyer par exemple :

```http
HTTP/1.1 200 OK
Content-Type: video/mp4
Content-Disposition: attachment; filename="Vacances-2026.mp4"
Content-Length: 4289384932
Accept-Ranges: bytes
```

Safari/iOS gère alors le téléchargement nativement. Le fichier est récupérable dans **Fichiers**, puis ouvrable avec VLC ou Infuse.

### MP4 déjà disponible

Le plus simple est que `downloadUrl` pointe vers une route de ta plateforme qui sert le MP4 en pièce jointe.

### Média HLS uniquement

Une PWA GitHub Pages ne peut pas transformer de manière fiable un HLS de plusieurs Go en MP4 toute seule.

Si ton stockage ne possède que du HLS, ta plateforme/NAS doit fournir soit :

- un MP4 original en téléchargement ;
- soit un endpoint serveur qui remuxe le HLS en MP4 et le renvoie avec `Content-Disposition: attachment`.

Cette conversion appartient au serveur média, pas à la PWA statique.

## 6. Tester sans média embarqué

La PWA ne contient volontairement aucune vidéo binaire. Utiliser le formulaire **Charger manuellement un média** avec :

- une URL MP4/HLS autorisée pour tester la lecture ;
- une URL de téléchargement de ta plateforme pour tester l’enregistrement réel dans Fichiers.

## Structure

```text
.
├── index.html
├── app.js
├── styles.css
├── sw.js
├── manifest.webmanifest
├── .nojekyll
├── icon.svg
└── integration/
    ├── platform-bridge.js
    └── example-video-page.html
```

# Architecture de Foulée

Ce document consigne les **choix par défaut de la phase 0** (critère d’acceptation : « le dépôt existe et les choix par
défaut sont écrits dans son fichier d’architecture ») et l’état de la phase 1. Chaque choix est derrière une interface :
s’il échoue sur le terrain, on le remplace sans toucher au reste.

## Principes

1. **Le cœur ne dépend pas de l’interface.** `core` ne touche ni au DOM ni au navigateur ; Vue peut être remplacé.
2. **Événements d’abord.** Les repères sont des images exactes (index + temps média), source manuelle ou automatique,
   même modèle dans les deux cas.
3. **Honnêteté des mesures.** Toute durée vient des vrais horodatages du fichier ; la marge d’une image
   (± 1000 / cadence ms) est affichée.
4. **Les données t’appartiennent.** Coffre au format ouvert, documenté dans `docs/format-coffre-v1.md`.
5. **Rien ne part sur le réseau.** Aucune vidéo, aucune donnée n’est envoyée ; l’app fonctionne hors-ligne.

## Choix par défaut (phase 0)

| Sujet | Choix par défaut | Interface qui permet d’en changer | Repli ou plan B |
| --- | --- | --- | --- |
| Langage, outillage | TypeScript strict (`noUncheckedIndexedAccess`), Vite, pnpm (espace de travail), Vitest, Playwright | — | — |
| Interface | Vue 3 (`<script setup>`), vue-router en historique « # » | Tout le métier est dans `core`/`media`/`vault` | Autre framework |
| Stockage | Coffre sur **OPFS** (`OpfsProvider`) | `StorageProvider` (lire, écrire, lister, supprimer par clé) | `MemoryProvider` si OPFS absent ; dossier disque, WebDAV, S3, ZIP en phase 5 |
| Écriture OPFS | `createWritable()` en flux | idem | Worker + `createSyncAccessHandle()` (Safari) |
| Index de travail | **En mémoire**, reconstruit depuis le coffre au démarrage | `store/data.ts` | IndexedDB quand le volume le justifiera (voir écarts) |
| Empreintes | SHA-256 en flux (`@noble/hashes`), fichier jamais chargé en entier | `sha256Blob` | WebCrypto si plus rapide |
| Archives | ZIP en flux (`fflate`), vidéos stockées, JSON compressés | `exportArchive` / `importArchive` | ZIP64 à ajouter si besoin (> 4 Go) |
| Démuxage | **Mediabunny** (MP4/MOV/WebM) : horodatages réels de chaque image | `probeVideo` → `FrameTimeline` | Chronologie estimée à 30 i/s si le conteneur est illisible |
| Image par image | **WebCodecs** via Mediabunny (`WebCodecsFrameSource`) | `FrameSource.getFrame(i)` | `<video>` + `requestVideoFrameCallback` (`VideoElementFrameSource`) |
| Lecture fluide | `<video>` sur le **proxy** (ou l’original), image exacte décodée à la pause | `FramePlayer` | Lecture image par image sous 0,1× |
| Proxy | H.264 960 px, sans son, mêmes horodatages, généré dans un Worker | `createProxyInWorker` | Pas de proxy si l’appareil ne sait pas encoder |
| Replay différé | Caméra → `VideoEncoder` → tampon en mémoire → `VideoDecoder` par vue | `DelayedReplay` | Tampon d’images réduites (sans enregistrement) |
| Rapports PDF (phase 4) | Bibliothèque PDF programmatique, graphiques SVG | paquet `report` (à créer) | Moteur typographique WebAssembly |
| Pose (phase 8) | Choix reporté, derrière `PoseEstimator` | paquet `vision` (à créer) | RTMPose (ONNX Runtime Web) ou MediaPipe ; pas d’AGPL |

## Paquets

```
packages/
  core/   domaine pur : modèle, FrameTimeline, timecode, tags, géométrie, annuler/rétablir, validation
  media/  probe, FrameSource (WebCodecs + repli), proxy (Worker), DelayedReplay (coach-loop)
  vault/  StorageProvider (OPFS, mémoire), Vault, SHA-256, migrations, export/import ZIP
  app/    PWA Vue 3 : écrans, lecteur, dessin, comparaison, replay
```

`report` et `vision` seront créés quand leur phase commencera (inutile d’avoir des paquets vides).
Les paquets sont consommés directement en TypeScript (`exports` → `src/index.ts`), sans étape de build intermédiaire.

## Le lecteur image par image

- **Chronologie exacte.** À l’ouverture, on lit les horodatages de *tous* les paquets du conteneur, sans décoder
  (`metadataOnly`). Ils sont triés (ordre d’affichage), dédoublonnés, et donnent `FrameTimeline` : image n ↔ temps
  exact, cadence nominale (médiane), détection de cadence variable (ralentis iPhone).
- **Décodage.** Un itérateur avance image par image pour les pas en avant. Un saut ou un pas en arrière relance le
  décodage depuis l’image clé précédente et met en cache les 12 images avant la cible (elles sont décodées de toute
  façon), d’où des pas arrière instantanés. Cache LRU de 24 images, grand côté plafonné à 1920 px (mémoire iPad).
  Une demande obsolète (touche maintenue) est abandonnée au profit de la plus récente.
- **Lecture.** Pendant la lecture, un `<video>` joue le proxy ; `requestVideoFrameCallback` donne le `mediaTime` de
  chaque image présentée, converti en index via la chronologie. À la pause, l’image exacte est décodée depuis
  l’original. Sous 0,1×, la lecture se fait image par image avec le décodeur.
- **Repli.** Sans WebCodecs (ou codec non décodable), un `<video>` caché est placé au milieu de l’image voulue et on
  attend qu’elle soit réellement présentée avant de la copier.
- **Cadence réelle.** `captureFps` sur l’essai corrige un ralenti ré-encodé ; le timecode et les marges en tiennent compte.
- **Validation.** Le test Playwright vérifie qu’une image atteinte par 37 pas successifs est identique pixel à pixel à
  la même image atteinte par saut direct, et après un aller-retour arrière/avant. La page *Coffre → Diagnostic*
  mesure les temps sur l’appareil réel (à lancer sur iPhone et iPad).

## Données et état

- Le coffre est la seule source de vérité. L’application charge toutes les fiches au démarrage dans un index
  réactif en mémoire (`store/data.ts`) ; chaque modification est écrite immédiatement dans le coffre (les analyses
  avec un délai de 400 ms, et à la mise en arrière-plan de l’app).
- Corbeille par `deletedAt` en cascade (athlète/séance → essais) ; suppression définitive des vidéos orphelines.
- Préférences propres à l’appareil (mode Terrain, couleurs, retards du replay) dans `localStorage`, hors coffre.
- `navigator.storage.persist()` est proposé dans *Coffre* ; sur iOS, l’installation sur l’écran d’accueil est le
  meilleur moyen d’éviter l’effacement automatique.

## PWA et déploiement

- `vite-plugin-pwa` (Workbox, `generateSW`) précache l’application (≈ 1,3 Mo) ; mise à jour proposée par un bandeau.
- Déploiement sur GitHub Pages sous `/foulee/` : `base`, `scope`, `start_url` et `id` du manifeste valent `/foulee/`
  (variable `FOULEE_BASE` pour un autre chemin). Le routage par « # » évite toute 404 au rechargement.
- Workflows : `.github/workflows/ci.yml` (types, tests, build, parcours Playwright) et `pages.yml`
  (build + déploiement à chaque push sur `main`).

## Écarts assumés par rapport au plan

| Plan | Phase 1 | Raison |
| --- | --- | --- |
| Index de travail en IndexedDB | Index en mémoire reconstruit au démarrage | 10 à 50 athlètes : quelques centaines de petits JSON se lisent en quelques dizaines de ms. IndexedDB ajouterait un second état à synchroniser sans gain mesurable. À revoir si le démarrage dépasse ~300 ms. |
| Paquets `report`, `vision` | Non créés | Pas de code avant les phases 4 et 8. |
| Playwright WebKit | Chromium (ordinateur + format iPad) | Le WebKit Linux de Playwright ne décode pas le H.264 comme Safari iOS ; la validation iOS se fait sur l’appareil réel via la page Diagnostic. |
| Angle | Outil d’angle simple inclus dans la barre de dessin | Utile tout de suite ; la phase 2 y ajoute la marge d’erreur, l’étalon et les longueurs en mètres. |

## Risques suivis en phase 1

| Risque | État |
| --- | --- |
| Image par image sur iOS | Validé dans Chromium. **À vérifier sur iPhone/iPad** avec la page Diagnostic. |
| Taille des vidéos | Hachage et écriture en flux ; archive assemblée en mémoire sur iOS (pas d’API d’écriture en flux) : prévoir des exports réguliers ou « sans vidéos ». |
| Sélecteur Photos iOS qui ré-encode | Message dans l’app : importer depuis Fichiers ou choisir « Actuel ». Champ `captureFps` pour corriger. |
| Effacement des données par iOS | Demande de persistance, installation PWA, export. Fournisseurs externes en phase 5. |

## Dépendances et licences

| Dépendance | Licence | Usage |
| --- | --- | --- |
| Vue, vue-router | MIT | Interface |
| Mediabunny | MPL-2.0 (copyleft au niveau du fichier, compatible avec un code propriétaire tant que ses fichiers ne sont pas modifiés) | Démuxage, décodage, encodage |
| fflate | MIT | ZIP |
| @noble/hashes | MIT | SHA-256 |
| vite-plugin-pwa, workbox | MIT | Service worker |

La licence du projet est provisoirement « tous droits réservés » (voir `LICENSE`).

## Phase 3 : spécifications d’épreuve (sprint et haies)

- `packages/core/src/trialspec.ts` : spécifications déclaratives (100, 200, 400 m, 100/110/400 m haies) avec positions de
  passage, haies (première, espacement, nombre), cadence minimale pour le temps de contact et seuils de plausibilité. Les
  distances de haies sont les valeurs standard senior (à vérifier par catégorie et saison). Les seuils sont des garde-fous
  à valider avec des entraîneurs.
- `packages/core/src/sprint.ts` : fonctions pures. Splits avec marge (au plus une image par extrémité), vitesses, profil
  Vmax/τ (modèle mono-exponentiel ajusté par moindres carrés, marges à 2 écarts-types, F0 = Vmax/τ, Pmax = F0·Vmax/4),
  pas, fréquence, contacts, vol, contrôles. Tests sur un 100 m synthétique de référence.
- Pas encore faits (à venir) : photo-finish par fente, détection de départ au son, kinogramme semi-manuel, indice de
  technique des haies, héritage entre spécifications au-delà du sprint.

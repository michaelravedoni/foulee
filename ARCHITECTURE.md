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
- Départ au son (`core/audio.ts`, `media/audio.ts`) : enveloppe de crête au pas de 2 ms, seuil adaptatif au bruit de fond,
  candidats classés par niveau ; le retard du son (distance au pistolet / 343 m/s) est retiré. Le repère créé a
  `source: "auto"` et une confiance ; la précision est celle de l'image, à vérifier à l'œil.
- Kinogramme semi-manuel (`core/kinogram.ts`, `KinogramPanel.vue`) : planche d'images aux repères marqués ou régulières,
  export PNG. Les dessins ne sont pas inclus.
- Pas encore faits : photo-finish par fente, indice de technique des haies, héritage entre spécifications au-delà du sprint.

## Phase 4 : rapports PDF et export tableur

- Paquet `packages/report` : construction du contenu (`build.ts`, fonctions pures testées), règles « ce qui va bien / à
  travailler » (`insights.ts`), glossaire pédagogique, rendu PDF A4 avec jsPDF chargé à la demande (`pdf.ts`), CSV (`csv.ts`).
- Rapport athlète (1 à 2 pages) : images clés, trois chiffres avec flèche mieux/moins bien **seulement si l'écart dépasse la marge**
  par rapport à l'essai précédent, points forts, points à travailler, consigne. Rapport coach : protocole, résultats, splits,
  graphique de vitesse, profil, pas, contacts, contrôles, historique avec meilleur essai et meilleur virtuel, notes, annexes
  (méthode, glossaire).
- L'historique est recalculé depuis les repères enregistrés (`timeSourceFromEvents`), sans recharger les vidéos.
- Les polices PDF standard ne couvrent que le latin-1 : `pdfText` remplace les autres caractères (ex. τ devient « tau »).
- Pas de fichier PDF ni d'entité « Rapport » stockés dans le coffre : les rapports sont régénérés à la demande.
- Excel : CSV « ; » avec virgule décimale et BOM UTF-8 (s'ouvre directement dans Excel en français), pas de .xlsx.
- Seuils à valider avec des entraîneurs : perte de vitesse en fin de course (4 %), plausibilité des contacts et fréquences.

## Phase 5 : sauvegardes, chiffrement, restauration

- Fournisseurs de stockage (même interface `StorageProvider`) : dossier du disque (File System Access API, Chromium sur
  ordinateur ; réutilise le code OPFS), WebDAV (PROPFIND, MKCOL, PUT, GET, DELETE), S3 (signature AWS SigV4 vérifiée contre le
  vecteur de test officiel « get-vanilla », liste paginée, PUT en `UNSIGNED-PAYLOAD`). WebDAV et S3 appellent le serveur depuis
  le navigateur : il doit autoriser le CORS pour l'application. Pas de clés S3 dans un site public : elles restent sur l'appareil
  (localStorage), à limiter à un seau dédié.
- `EncryptedProvider` : voir `docs/format-coffre-v1.md`. Vidéos traitées par blocs, jamais chargées en entier.
- `syncProviders(source, destination)` : copie ce qui manque ou est plus récent (`updatedAt`), médias identifiés par leur empreinte,
  refuse de mêler deux coffres d'identifiant différent sauf restauration explicite. Les suppressions ne sont pas propagées.
- `MirrorProvider` (écriture locale d'abord, copie en arrière-plan avec reprise) existe et est testé, mais n'est pas encore branché
  dans l'interface : seule la sauvegarde manuelle l'est. Pas d'archive ZIP chiffrée : l'export ZIP reste en clair.
- Écran Sauvegardes : destinations, test de connexion, « Sauvegarder maintenant », « Restaurer sur cet appareil » (réinstallation
  sur un autre appareil). La phrase secrète n'est jamais enregistrée.

## Phase 6 : sauts (longueur, triple saut, hauteur, perche)

- `jumpspec.ts` : un gabarit déclaratif par saut (événements attendus, obligatoires ou non, aide de placement, signification du champ
  « position » : distance ou hauteur de barre, seuils de plausibilité, version des données). L'interface et le moteur lisent la même liste.
- `jumps.ts` (`analyzeJump`) : fonction pure `spec + repères + source de temps → mesures, phases, foulées d'élan, contrôles, repères manquants`.
  Les foulées d'élan réutilisent `analyzeStrides` (sprint) sur les seuls repères antérieurs à l'appel. La chaîne appel → décollage →
  appui/réception donne les contacts, vols et, si les positions sont saisies, la distance et la part de chaque phase (triple saut : trois).
- Longueur du saut = position de la réception − position de l'appel (marge ≈ 7 cm). Elle ne remplace pas la mesure officielle.
- Estimations balistiques **indicatives** (g = 9,81 m/s²) : montée du centre de gravité (g·T²/8 depuis le temps de vol, ou ½·g·t² depuis le
  sommet / le lâcher), vitesse verticale d'envol, angle d'envol (longueur ÷ temps de vol). Marges relatives doublées pour les termes quadratiques.
- Hauteur et perche : résultat = hauteur de barre saisie (position du repère « barre »). Perche : pose → appel, appel → lâcher, lâcher → sommet.
- Temps d'appel marqué non fiable sous 120 i/s. Seuils de plausibilité à valider avec des entraîneurs.
- Rapports : `jumpreport.ts` (athlète / coach), `jumpcsv.ts` ; `ReportPanel.vue` choisit selon `jumpSpecFor`. L'historique est recalculé avec `analyzeJump`.
- Limites : aucune validation sur de vrais sauts ; pas de détection de la planche ou de la barre ; les repères uniques (appel, réception,
  sommet, pose, lâcher, barre) sont remplacés quand on les replace.

## Phase 7 : lancers (poids, disque, javelot, marteau)

- `throwspec.ts` : gabarit par engin (puissance/rotation/pas croisés/tours, blocage, lâcher, chute de l'engin) et garde-fous de plausibilité
  (vitesse et angle de lâcher, durée d'un tour de marteau), à valider avec des entraîneurs.
- `throws.ts` (`analyzeThrow`) : fonction pure. Suivi manuel de l'engin : la trajectoire pointée (outil Trajectoire) donne, par régression linéaire
  sur les premiers points après le lâcher, la vitesse et l'angle de lâcher. La vitesse verticale est ramenée à l'instant du lâcher (correction g·Δt).
  Marges : pointage (±2 px) sur la pente + incertitude de l'étalon. Mesures dans le plan de l'image (caméra perpendiculaire requise).
- Marteau : durée de chaque tour (début de tour → début suivant, dernier tour → lâcher), nombre de tours, accélération (premier − dernier tour).
  Détection automatique des tours : non faite (repères manuels).
- Portée balistique (poids, marteau, si la hauteur de lâcher est saisie) : indicative, sans résistance de l'air. Pas de modèle pour le disque et le javelot
  (portance). La distance est la valeur saisie sur le repère « chute de l'engin ».
- Suivi du cercle / position dans le cercle : pas implémenté (l'étalon et la trajectoire libre restent disponibles).
- `EventTemplate.vue` : gabarit d'événements commun aux sauts et lancers. Rapports : `throwreport.ts`, `throwcsv.ts`.

## Phase 8 : automatisation (pose, appuis, suivi)

- **Pose** : interface `PoseEstimator` (`@foulee/media`), implémentée par MediaPipe BlazePose lite (`@mediapipe/tasks-vision`, licence Apache 2.0), exécutée
  dans le navigateur (GPU, sinon CPU) : aucune image ne quitte l'appareil. Les fichiers WebAssembly sont copiés dans `public/mediapipe/` avant `dev` et
  `build` (`scripts/copy-mediapipe.mjs`, non versionnés) et mis en cache par le service worker. Le modèle (6 Mo) est téléchargé une seule fois au premier
  usage depuis `storage.googleapis.com`, puis gardé dans le cache du navigateur (`foulee-models`). Les poses ne sont pas enregistrées dans le coffre.
- **Appuis** (`autoevents.ts`, pur et testé sur des séries synthétiques) : un pied est « au sol » quand il est dans le bas de sa course verticale locale
  (fenêtre glissante) ; début = appui, fin = décollage. Les propositions sont **à valider** (✓/✕, « accepter les sûrs ») ; acceptées, elles deviennent des
  repères `source: 'auto'` avec leur confiance, modifiables et supprimables comme les autres.
- **Suivi de point** (`tracker.ts` + `track.ts`) : corrélation croisée normalisée avec affinage sous-pixel, motif renouvelé à chaque image, arrêt explicite
  quand la corrélation tombe sous 0,55 (jamais de position inventée). Utilisé par « Suivre automatiquement » (outil Trajectoire, 60 images au plus).
- Le mode GPU est vérifié sur une image d'essai ; s'il échoue (contexte WebGL refusé, fréquent selon le navigateur), l'analyse passe au processeur. Sans WebGL du tout,
  l'erreur est expliquée en français (MediaPipe a besoin de WebGL même en mode processeur).
- Squelette dessiné sur la vidéo (calque SVG, désactivable).
- Vérifié avec le vrai modèle sur une photo d'athlète (30 poses sur 30, squelette aligné). **Non vérifié** : appuis sur de vraies courses (aucune vidéo de
  sprint disponible dans l'environnement de développement) ; seuils (fenêtre 0,5 s, bas de course 30 %, contact ≥ 40 ms) à régler sur des vidéos réelles.
  Le critère « temps d'analyse divisé par deux » n'a pas été mesuré.
- Hors périmètre de cette phase : tracking automatique des dessins (seules les trajectoires se suivent), angles articulaires automatiques, texte de rapport
  par LLM (les textes de rapport restent générés par règles à partir des mesures).

## Système de design « Foulée » (Cream / Void)

- Source : le système « Foulée » enregistré dans Claude (`tokens.json`, README et composants). Repris dans `packages/app/src/design.css` : jetons sémantiques
  (`surface`, `ink`, `ink-muted`, `fill`, `on-fill`, `hairline`, `control-border`, `overlay-primary/secondary`, `focus-ring`) pour les deux thèmes.
- **Cream** (`:root`, `[data-theme='cream']`) pour l'accueil, les listes et le panneau de mesures ; **Void** (`[data-theme='void']` et `.player`) pour la vidéo et ses commandes.
  Fiche d'essai en diptyque : panneau Cream à gauche (320-400 px), panneau Void qui prend le reste (empilés sous 1000 px).
- Aucun accent chromatique, aucune ombre : l'ancien orange et les verts/rouges d'état sont remplacés par le contraste noir/blanc et la graisse. Les anciennes variables
  (`--bg`, `--text`, `--accent`…) sont des alias déclarés **dans chaque thème** (une propriété personnalisée est résolue là où elle est déclarée).
- Navigation : rangée de liens texte en bas à droite (pas de barre supérieure collante). Titre d'écran en Archivo Black capitales, une fois par écran ; le reste en Inter (poids 300/450/500).
- Polices embarquées (`@fontsource-variable/inter`, `@fontsource/archivo-black`) : pas de CDN, fonctionne hors ligne. Plus d'émojis dans l'interface.
- Calques sur la vidéo : squelette et étalon en `overlay-primary` (crème sur Void) ; les couleurs de dessin choisies par l'utilisateur restent libres.
- Icônes de l'application redessinées (courbe crème sur fond noir). Pas porté : composants `Chip`, `PhaseTimeline`, `MetricRow` du système (les équivalents de l'application, boutons à bascule, onglets, tableaux, en reprennent les jetons).

## Phase 9 — Normes et tendances

**Aucune valeur de norme n'est embarquée.** Les tableaux officiels (Swiss Athletics ou autre) ne sont pas récupérables ici de façon fiable : le coach importe un fichier JSON `norms@1` qu'il a contrôlé à la source. L'exigence « les normes affichées correspondent à la source officielle » est donc tenue par la **provenance** : chaque tableau porte `source` (nom, URL, saison, date de relevé) et, une fois contrôlé, `verified` (nom, date). Tant que `verified` manque, chaque affichage (onglet Normes, rapport coach) dit « valeurs non vérifiées à la source ».

- `core/norms.ts` : `parseNormTable` (validation, messages en français), `categoryFor` (catégorie = âge atteint dans l'année de la saison, année de naissance → année de la séance), `rateAgainst` (temps : plus petit = meilleur ; sinon plus grand ; niveau atteint, prochain niveau et écart, drapeau « trop proche du seuil » si le seuil est dans résultat ± marge).
- `core/trends.ts` : `summarize` (record, meilleur de la saison, moyenne des 3 derniers, pente par mois). Sens « mieux/moins » seulement si le changement estimé dépasse 2× la marge moyenne ; sinon « stable » ; moins de 3 résultats → « insuffisant ».
- Coffre : fichiers `norms/<id>.json` (copiés par la sauvegarde, inclus dans l'export ZIP et fusionnés à l'import : un tableau déjà présent n'est pas écrasé). `Athlete.sex?` ('F'|'M') optionnel, requis pour comparer.
- Application : écran `/normes` (import, modèle téléchargeable, « J'ai vérifié à la source », suppression), onglet **Normes** de l'essai, bloc **Progression** par épreuve sur la fiche athlète, lignes « Références » dans les rapports.
- Résultat d'un essai (`app/lib/results.ts`) : temps total (sprint), longueur (sauts horizontaux), distance saisie (lancers). Hauteur de barre (saut en hauteur, perche) : pas encore de résultat principal, donc pas de comparaison.
- Test de plausibilité du modèle Vmax/τ sur des temps intermédiaires de référence (recopiés de mémoire, à contrôler) : ordres de grandeur seulement.

## Refonte UX (parcours, textes, navigation)

Principes : une action principale toujours visible (« ＋ Ajouter une vidéo » dans la barre du haut), le vocabulaire de l'entraîneur plutôt que celui du modèle de données, et les fonctions avancées repliées.

- Barre du haut : Vidéos, Athlètes, Comparer ; menu « Plus » (séances, replay, normes, sauvegarde, gros boutons, verrouillage). Plus de navigation fixe en bas à droite, plus de bandeau « prête hors ligne ».
- Ajouter une vidéo : la séance du jour est créée à la demande (`lib/quick.ts`) ; la boîte demande seulement l'athlète (ou un nouvel athlète) et l'épreuve ; cadence et étiquettes sont sous « Options ».
- Accueil « Mes vidéos » : grille de cartes (athlète, épreuve, date, résultat ou « à mesurer »), recherche ; écran d'accueil en trois étapes tant qu'il n'y a pas de vidéo.
- Fiche d'essai : cinq onglets (Mesurer, Résultats, Rapport, Outils, Infos) ; « Mesurer » ouvre par défaut avec des consignes numérotées et le résultat en grand ; départ au son et appuis sont dans « Outils avancés » ; repères libres, suivi automatique et kinogramme sont sous « Outils » ; les normes (si un tableau est importé) apparaissent dans « Résultats » ; étiquettes dans « Infos ».
- Sauvegarde : l'ancien « Coffre » devient « Sauvegarde et données » (copie complète / légère, restaurer, protéger mes données).

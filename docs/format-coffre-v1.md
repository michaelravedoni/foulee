# Format de coffre Foulée – version 1

Le coffre est la **seule source de vérité** des données de Foulée. Il est conçu pour être lu, copié et sauvegardé
sans l’application : des fichiers JSON lisibles et des vidéos nommées par leur empreinte.

Le même format sert au stockage sur l’appareil (OPFS, dossier `foulee-vault/`) et aux archives ZIP exportées.

## Arborescence

```
manifest.json                 version du format, identifiant du coffre
athletes/<id>.json            une fiche par athlète
sessions/<id>.json            une fiche par séance
trials/<id>.json              une fiche par essai
analyses/<id-essai>.json      repères, dessins, origine du temps d’un essai
media/<sha256>.<ext>          vidéo originale, jamais modifiée
media/<sha256>.json           métadonnées de la vidéo (cadence, images, dimensions)
proxies/<sha256>.mp4          proxy basse résolution (cache jetable, jamais exporté)
LISEZMOI.txt                  (archives uniquement) explication en clair
```

## Règles générales

- Encodage UTF-8, JSON indenté de 2 espaces, une entité par fichier.
- Dates : ISO 8601 en UTC (`2026-11-02T06:46:39.000Z`) ; dates civiles en `AAAA-MM-JJ`.
- Identifiants : préfixe + horodatage base 36 + aléa, par exemple `ath_0mvyxar1zbjjqlwnb4t`
  (`ath` athlète, `ses` séance, `tri` essai, `evt` repère, `ann` dessin). Ils sont triables dans le temps.
- Chaque fiche porte un champ `schema` (`athlete@1`, `session@1`, `trial@1`, `analysis@1`, `media@1`).
  Un lecteur doit refuser une version qu’il ne connaît pas plutôt que de la deviner.
- Corbeille : une fiche supprimée garde son fichier et reçoit `deletedAt`. La suppression définitive efface le fichier.
- Les vidéos sont **immuables** et nommées par le SHA-256 de leur contenu : une même vidéo importée deux fois n’est
  stockée qu’une fois, et toute corruption est détectable.
- Les champs inconnus doivent être conservés tels quels par les versions futures.

## manifest.json

```json
{
  "format": "foulee-vault",
  "formatVersion": 1,
  "vaultId": "vlt_…",
  "createdAt": "2026-11-02T07:00:00.000Z",
  "updatedAt": "2026-11-02T08:00:00.000Z",
  "generator": "Foulée 0.1.0",
  "exportedAt": "…",          // archives uniquement
  "includesMedia": true        // archives uniquement
}
```

Une version plus récente que celle connue de l’application est refusée avec un message clair. Les migrations
successives (v1 → v2 → …) sont dans `packages/vault/src/migrations.ts`.

## Entités

Champs communs : `schema`, `id`, `createdAt`, `updatedAt`, `deletedAt?`.

**Athlète** (`athlete@1`) : `firstName`, `lastName`, `birthDate?`, `tags[]`, `notes`, `favorite`.

**Séance** (`session@1`) : `date`, `title`, `place`, `venue?` (`halle|stade|autre`), `lighting?`
(`halle|jour|soir|nuit`), `surface?` (`synthetique|halle|herbe|route|autre`), `weather?`, `notes`, `tags[]`, `favorite`.

**Essai** (`trial@1`) : `sessionId`, `athleteId`, `discipline` (`100m`, `200m`, `400m`, `100mh`, `110mh`, `400mh`,
`longueur`, `triple`, `hauteur`, `perche`, `poids`, `disque`, `javelot`, `marteau`, `autre`), `number`, `mediaHash?`,
`camera?` (`fixe|panoramique`), `shoes?` (`pointes|baskets|autre`), `surface?`, `lighting?`, `captureFps?`,
`officialResult?`, `tags[]`, `notes`, `favorite`.

`captureFps` corrige un ralenti ré-encodé : un fichier à 30 i/s filmé à 240 i/s a `captureFps: 240`, et toutes les
durées affichées sont multipliées par 30/240.

Les tags d’épreuve, de surface, de chaussures, d’éclairage et de cadence sont **dérivés** des champs ci-dessus et ne
sont pas stockés dans `tags[]` (qui ne contient que les tags libres et rapides).

**Analyse** (`analysis@1`, un fichier par essai, nommé par l’id de l’essai) :

```json
{
  "schema": "analysis@1",
  "trialId": "tri_…",
  "updatedAt": "…",
  "timeOrigin": 37,
  "locked": false,
  "events": [
    { "id": "evt_…", "type": "depart", "frame": 47, "time": 0.391667, "source": "manuel", "confidence": 1 },
    { "id": "evt_…", "type": "appui", "side": "G", "frame": 63, "time": 0.525, "source": "manuel", "confidence": 1 }
  ],
  "annotations": [
    {
      "id": "ann_…", "kind": "ligne", "color": "#ff3b30", "width": 4,
      "points": [{ "x": 412.5, "y": 300.1 }, { "x": 980.2, "y": 610.0 }],
      "frame": 47, "holdFrames": 120
    }
  ]
}
```

- `frame` est l’index de l’image (0 = première image en ordre d’affichage). `time` est le temps média (s) de cette
  image, recopié pour qu’un outil externe puisse s’en servir sans décoder la vidéo.
- `timeOrigin` est l’image définie comme t = 0.
- Coordonnées des dessins : pixels de l’image affichée (rotation appliquée), origine en haut à gauche.
- `kind` : `ligne`, `fleche`, `main` (main levée), `cercle` (centre, point du bord), `rectangle` (deux coins),
  `angle` (trois points, sommet au milieu), `texte` (un point + `text`).
- `holdFrames` : nombre d’images pendant lesquelles le dessin reste visible après `frame` ; `null` = toujours visible.
- `source` : `manuel` ou `auto` ; `confidence` entre 0 et 1 (1 pour un repère manuel).

**Média** (`media@1`, `media/<sha256>.json`) : `hash`, `mime`, `ext`, `size`, `originalName`, `importedAt`, `width`,
`height`, `rotation`, `durationS`, `codec?`, `frameCount`, `nominalFps`, `variableFrameRate`, `proxyHash?`.

`nominalFps` est la médiane des écarts entre horodatages réels des images ; `variableFrameRate` est vrai si des écarts
s’en éloignent de plus de 25 %.

## Archives ZIP

- Même arborescence que le coffre, sans `proxies/`, plus `LISEZMOI.txt`.
- JSON compressés (deflate), vidéos stockées sans compression.
- Import = fusion : pour chaque fiche, la version dont `updatedAt` est la plus récente gagne. Chaque vidéo est
  vérifiée contre son SHA-256 avant d’être écrite ; une vidéo corrompue est signalée et ignorée.
- Limite connue de la v1 : pas de ZIP64, donc une archive (ou une vidéo) de plus de 4 Go n’est pas prise en charge.

## Prévu pour les versions suivantes

- Journal de modifications par appareil (`journal/<appareil>.ndjson`) pour la synchronisation (phase 5).
- Fichiers `calibrations/` et `measures/` (phases 2 et 3), avec version de la spécification d’épreuve.
- Chiffrement optionnel côté appareil avant envoi vers un fournisseur externe.

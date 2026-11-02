# Foulée

Application web (PWA) d’analyse vidéo pour l’athlétisme : image par image exact, dessin, comparaison côte à côte,
replay différé et coffre de données au format ouvert. Interface en français, fonctionne hors-ligne.

**Version en ligne :** https://michaelravedoni.github.io/foulee/

## Démarrer

```sh
pnpm install
pnpm dev          # http://localhost:5173/foulee/
pnpm check        # types + tests unitaires + build
pnpm test:e2e     # parcours navigateur (Playwright)
```

Node 22 et pnpm 10 sont requis.

## Organisation

| Paquet | Rôle |
| --- | --- |
| `packages/core` | Domaine : modèle de données, chronologie des images, timecode, tags, géométrie, validation. Aucun accès au navigateur. |
| `packages/media` | Vidéo : lecture du conteneur, décodage image par image (WebCodecs, repli `requestVideoFrameCallback`), proxy, replay différé. |
| `packages/vault` | Coffre v1 : fournisseurs de stockage (OPFS, mémoire), empreintes SHA-256, export/import ZIP. |
| `packages/app` | Interface Vue 3. |

Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour les choix techniques et [docs/format-coffre-v1.md](docs/format-coffre-v1.md)
pour le format de données.

## Licence

Provisoire : tous droits réservés (voir [LICENSE](LICENSE)).

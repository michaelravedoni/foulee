// Copie les fichiers WebAssembly de MediaPipe dans public/ pour qu'ils soient servis par l'application
// (fonctionnement hors ligne, pas de CDN). Exécuté avant `dev` et `build`.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Le paquet est une dépendance de @foulee/media (lien pnpm dans son node_modules).
const pkg = join(here, '../../media/node_modules/@mediapipe/tasks-vision');
const dest = join(here, '../public/mediapipe/wasm');
mkdirSync(dest, { recursive: true });
cpSync(join(pkg, 'wasm'), dest, { recursive: true });
console.log('MediaPipe wasm copié dans', dest);

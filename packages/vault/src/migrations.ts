import { VAULT_FORMAT_VERSION, type VaultManifest } from './layout.js';

/**
 * Migrations successives du format de coffre. Chaque étape transforme la
 * version N en N+1. La v1 est la première : rien à migrer pour l'instant.
 */
const STEPS: Record<number, (m: VaultManifest) => VaultManifest> = {};

export function migrateManifest(m: VaultManifest): VaultManifest {
  if (m.formatVersion > VAULT_FORMAT_VERSION)
    throw new Error(
      `Ce coffre utilise le format v${m.formatVersion}, plus récent que cette version de Foulée (v${VAULT_FORMAT_VERSION}). Mettez l'application à jour.`,
    );
  let cur = m;
  while (cur.formatVersion < VAULT_FORMAT_VERSION) {
    const step = STEPS[cur.formatVersion];
    if (!step) throw new Error(`Migration manquante depuis la v${cur.formatVersion}`);
    cur = step(cur);
  }
  return cur;
}

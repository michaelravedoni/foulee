/** Identifiants triables dans le temps : préfixe + horodatage base 36 + aléa. */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export type IdPrefix = 'ath' | 'ses' | 'tri' | 'ann' | 'evt' | 'trj';

export function newId(prefix: IdPrefix, now: number = Date.now(), random: () => number = Math.random): string {
  const time = now.toString(36).padStart(9, '0');
  let rand = '';
  for (let i = 0; i < 10; i++) rand += ALPHABET[Math.floor(random() * ALPHABET.length)] ?? '0';
  return `${prefix}_${time}${rand}`;
}

export function isId(value: unknown, prefix?: IdPrefix): value is string {
  if (typeof value !== 'string') return false;
  const re = /^(ath|ses|tri|ann|evt|trj)_[0-9a-z]{19}$/;
  if (!re.test(value)) return false;
  return prefix === undefined || value.startsWith(`${prefix}_`);
}

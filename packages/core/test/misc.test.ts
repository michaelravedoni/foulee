import { describe, expect, it } from 'vitest';
import {
  UndoStack,
  addTag,
  angleAt,
  cadenceTag,
  createAthlete,
  createTrial,
  derivedTags,
  formatHms,
  formatTimecode,
  isAnnotationVisible,
  isId,
  matchesQuery,
  newId,
  simplifyPath,
  toggleTag,
  validateAthlete,
  validateTrial,
  ValidationError,
  hitDistance,
} from '../src/index.js';

describe('identifiants', () => {
  it('sont préfixés et triables dans le temps', () => {
    const a = newId('ath', 1000);
    const b = newId('ath', 2000);
    expect(isId(a, 'ath')).toBe(true);
    expect(isId(a, 'tri')).toBe(false);
    expect(a < b).toBe(true);
  });
});

describe('timecode', () => {
  it('formate h:m:s avec virgule', () => {
    expect(formatHms(0)).toBe('0:00,000');
    expect(formatHms(61.2345)).toBe('1:01,235');
    expect(formatHms(3725.5)).toBe('1:02:05,500');
    expect(formatHms(-0.5)).toBe('−0:00,500');
  });
  it('est relatif à l’origine du temps', () => {
    const input = { frame: 10, originFrame: 4, time: 10 / 120, originTime: 4 / 120 };
    expect(formatTimecode('image', input)).toBe('img 6');
    expect(formatTimecode('ms', input)).toBe('50,0 ms');
    expect(formatTimecode('ms', { ...input, scale: 0.5 })).toBe('25,0 ms');
    expect(formatTimecode('image', { ...input, frame: 1 })).toBe('img −3');
  });
});

describe('tags', () => {
  it('normalise et évite les doublons', () => {
    expect(addTag(['faute'], '  Faute ')).toEqual(['faute']);
    expect(addTag([], 'À  revoir')).toEqual(['à revoir']);
    expect(toggleTag(['faute'], 'faute')).toEqual([]);
  });
  it('dérive les tags des champs structurés', () => {
    const t = createTrial({ sessionId: 's', athleteId: 'a', discipline: '100m', number: 1, shoes: 'pointes', surface: 'halle' });
    expect(derivedTags(t, 240)).toEqual(['100 m', 'piste de halle', 'pointes', '240 i/s et +']);
    expect(cadenceTag(59.94)).toBe('60 i/s');
  });
  it('recherche sans tenir compte des accents', () => {
    expect(matchesQuery(['Léa Müller', 'haies'], 'lea mul')).toBe(true);
    expect(matchesQuery(['Léa'], 'zoé')).toBe(false);
  });
});

describe('géométrie', () => {
  it('calcule un angle', () => {
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180);
  });
  it('simplifie un tracé rectiligne', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i * 2 + (i % 2) * 0.01 }));
    expect(simplifyPath(pts, 0.5)).toHaveLength(2);
  });
  it('gère la visibilité temporelle des dessins', () => {
    const a = { id: 'x', kind: 'ligne' as const, points: [], color: '#f00', width: 3, frame: 10, holdFrames: 5 };
    expect(isAnnotationVisible(a, 9)).toBe(false);
    expect(isAnnotationVisible(a, 15)).toBe(true);
    expect(isAnnotationVisible(a, 16)).toBe(false);
    expect(isAnnotationVisible({ ...a, holdFrames: null }, 1)).toBe(true);
  });
  it('mesure la distance à un rectangle', () => {
    const r = { id: 'r', kind: 'rectangle' as const, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '', width: 1, frame: 0, holdFrames: null };
    expect(hitDistance(r, { x: 5, y: 0 })).toBe(0);
    expect(hitDistance(r, { x: 5, y: 5 })).toBe(5);
  });
});

describe('annuler / rétablir', () => {
  it('restaure les états', () => {
    const u = new UndoStack<number>();
    u.push(1);
    u.push(2);
    expect(u.undo(3)).toBe(2);
    expect(u.undo(2)).toBe(1);
    expect(u.undo(1)).toBeUndefined();
    expect(u.redo(1)).toBe(2);
    u.push(5);
    expect(u.canRedo).toBe(false);
  });
});

describe('validation', () => {
  it('accepte une entité créée par la fabrique', () => {
    const a = createAthlete({ firstName: 'Léa', lastName: 'Rey' });
    expect(validateAthlete(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });
  it('rejette un schéma inconnu ou un champ manquant', () => {
    const a = createAthlete({ firstName: 'Léa', lastName: 'Rey' });
    expect(() => validateAthlete({ ...a, schema: 'athlete@9' })).toThrow(ValidationError);
    const t = createTrial({ sessionId: 's', athleteId: 'a', discipline: '200m', number: 1 });
    expect(() => validateTrial({ ...t, number: 'un' })).toThrow(/number/);
  });
});

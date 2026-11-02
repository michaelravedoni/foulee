import { SCHEMA, type Analysis, type Athlete, type EntityKind, type MediaInfo, type Trial, type TrainingSession } from './model.js';

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path} : ${message}`);
    this.name = 'ValidationError';
  }
}

type Json = Record<string, unknown>;

function obj(v: unknown, path: string): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ValidationError('objet attendu', path);
  return v as Json;
}
function str(o: Json, k: string, path: string, optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (typeof v !== 'string') throw new ValidationError(`« ${k} » doit être un texte`, path);
}
function num(o: Json, k: string, path: string, optional = false): void {
  const v = o[k];
  if (v === undefined && optional) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ValidationError(`« ${k} » doit être un nombre`, path);
}
function strArray(o: Json, k: string, path: string): void {
  const v = o[k];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
    throw new ValidationError(`« ${k} » doit être une liste de textes`, path);
}
function base(o: Json, schema: string, path: string): void {
  if (o.schema !== schema) throw new ValidationError(`schéma « ${String(o.schema)} » inattendu (attendu ${schema})`, path);
  str(o, 'id', path);
  str(o, 'createdAt', path);
  str(o, 'updatedAt', path);
  str(o, 'deletedAt', path, true);
}

export function validateAthlete(v: unknown, path = 'athlète'): Athlete {
  const o = obj(v, path);
  base(o, SCHEMA.athlete, path);
  str(o, 'firstName', path);
  str(o, 'lastName', path);
  str(o, 'birthDate', path, true);
  strArray(o, 'tags', path);
  return o as unknown as Athlete;
}

export function validateSession(v: unknown, path = 'séance'): TrainingSession {
  const o = obj(v, path);
  base(o, SCHEMA.session, path);
  str(o, 'date', path);
  strArray(o, 'tags', path);
  return o as unknown as TrainingSession;
}

export function validateTrial(v: unknown, path = 'essai'): Trial {
  const o = obj(v, path);
  base(o, SCHEMA.trial, path);
  str(o, 'sessionId', path);
  str(o, 'athleteId', path);
  str(o, 'discipline', path);
  num(o, 'number', path);
  str(o, 'mediaHash', path, true);
  num(o, 'captureFps', path, true);
  strArray(o, 'tags', path);
  return o as unknown as Trial;
}

export function validateAnalysis(v: unknown, path = 'analyse'): Analysis {
  const o = obj(v, path);
  if (o.schema !== SCHEMA.analysis) throw new ValidationError('schéma inattendu', path);
  str(o, 'trialId', path);
  num(o, 'timeOrigin', path);
  if (!Array.isArray(o.events)) throw new ValidationError('« events » doit être une liste', path);
  if (!Array.isArray(o.annotations)) throw new ValidationError('« annotations » doit être une liste', path);
  if (o.calibration !== undefined) {
    const c = obj(o.calibration, `${path}.calibration`);
    num(c, 'meters', `${path}.calibration`);
    num(c, 'clickErrorPx', `${path}.calibration`);
    obj(c.a, `${path}.calibration.a`);
    obj(c.b, `${path}.calibration.b`);
  }
  if (o.trajectories !== undefined && !Array.isArray(o.trajectories)) throw new ValidationError('« trajectories » doit être une liste', path);
  return o as unknown as Analysis;
}

export function validateMediaInfo(v: unknown, path = 'média'): MediaInfo {
  const o = obj(v, path);
  if (o.schema !== SCHEMA.media) throw new ValidationError('schéma inattendu', path);
  str(o, 'hash', path);
  if (!/^[0-9a-f]{64}$/.test(String(o.hash))) throw new ValidationError('empreinte SHA-256 invalide', path);
  str(o, 'ext', path);
  num(o, 'size', path);
  num(o, 'frameCount', path);
  num(o, 'nominalFps', path);
  return o as unknown as MediaInfo;
}

export const VALIDATORS: { [K in EntityKind]: (v: unknown, path?: string) => unknown } = {
  athlete: validateAthlete,
  session: validateSession,
  trial: validateTrial,
  analysis: validateAnalysis,
  media: validateMediaInfo,
};

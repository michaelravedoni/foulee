import { newId } from './ids.js';
import type { DisciplineId } from './disciplines.js';
import { SCHEMA, nowIso, type Analysis, type Athlete, type Trial, type TrainingSession } from './model.js';

export function createAthlete(input: Partial<Athlete> & Pick<Athlete, 'firstName' | 'lastName'>): Athlete {
  const now = nowIso();
  return {
    tags: [],
    notes: '',
    favorite: false,
    ...input,
    schema: SCHEMA.athlete,
    id: input.id ?? newId('ath'),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

export function createSession(input: Partial<TrainingSession> & Pick<TrainingSession, 'date'>): TrainingSession {
  const now = nowIso();
  return {
    title: '',
    place: '',
    notes: '',
    tags: [],
    favorite: false,
    ...input,
    schema: SCHEMA.session,
    id: input.id ?? newId('ses'),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

export function createTrial(
  input: Partial<Trial> & { sessionId: string; athleteId: string; discipline: DisciplineId; number: number },
): Trial {
  const now = nowIso();
  return {
    tags: [],
    notes: '',
    favorite: false,
    ...input,
    schema: SCHEMA.trial,
    id: input.id ?? newId('tri'),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

export function createAnalysis(trialId: string): Analysis {
  return {
    schema: SCHEMA.analysis,
    trialId,
    updatedAt: nowIso(),
    timeOrigin: 0,
    events: [],
    annotations: [],
    locked: false,
  };
}

/** Copie modifiée avec date de mise à jour. */
export function touch<T extends { updatedAt: string }>(entity: T, patch: Partial<T> = {}): T {
  return { ...entity, ...patch, updatedAt: nowIso() };
}

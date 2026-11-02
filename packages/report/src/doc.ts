import type { Calibration, SprintAnalysis } from '@foulee/core';

export type Trend = 'mieux' | 'moins' | 'egal';

export interface ReportImage {
  label: string;
  /** Image JPEG en data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

export interface HistoryTrial {
  id: string;
  /** Intitulé court : « 12 mars · essai 2 ». */
  label: string;
  /** AAAA-MM-JJ, pour trier. */
  date: string;
  analysis: SprintAnalysis;
}

export interface ReportInput {
  athleteName: string;
  disciplineLabel: string;
  /** Distance de l'épreuve (m). */
  distance: number;
  date: string;
  place?: string;
  weather?: string;
  trialNumber: number;
  notes: string;
  /** Lignes « Références » (normes comparées, avec leur source) ; vide = section omise. */
  refs?: string[];
  officialResult?: string;
  nominalFps: number;
  captureFps?: number;
  calibration?: Calibration;
  specDataVersion: string;
  analysis: SprintAnalysis;
  /** Autres essais du même athlète dans la même épreuve, du plus ancien au plus récent. */
  history: HistoryTrial[];
  images: ReportImage[];
  /** Date de génération (ISO), pour le pied de page. */
  generatedAt: string;
}

export type Block =
  | { t: 'h1'; text: string }
  | { t: 'h2'; text: string }
  | { t: 'p'; text: string; muted?: boolean }
  | { t: 'bullets'; items: string[]; tone?: 'good' | 'work' }
  | { t: 'stats'; items: { label: string; value: string; sub?: string; trend?: Trend }[] }
  | { t: 'table'; head: string[]; rows: string[][]; widths?: number[] }
  | { t: 'images'; items: ReportImage[] }
  | { t: 'bars'; title: string; unit: string; items: { label: string; value: number; margin?: number }[] }
  | { t: 'box'; text: string; lines: number };

export interface ReportDoc {
  title: string;
  subtitle: string;
  footer: string;
  blocks: Block[];
}

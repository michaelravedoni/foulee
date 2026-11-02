import type { Block, ReportDoc } from './doc.js';
import { pdfText } from './text.js';

const PAGE_W = 210;
const PAGE_H = 297;
const M = 15;
const W = PAGE_W - 2 * M;
const BOTTOM = PAGE_H - 18;

const INK: [number, number, number] = [24, 32, 42];
const MUTED: [number, number, number] = [100, 112, 124];
const LINE: [number, number, number] = [213, 219, 225];
const GOOD: [number, number, number] = [30, 140, 70];
const BAD: [number, number, number] = [200, 60, 50];
const ACCENT: [number, number, number] = [10, 110, 200];
const FILL: [number, number, number] = [238, 241, 244];

/** Dessine le document en PDF A4 (jsPDF chargé à la demande) et renvoie les octets. */
export async function renderPdf(doc: ReportDoc): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  pdf.setProperties({ title: pdfText(doc.title), subject: pdfText(doc.subtitle), creator: 'Foulée' });
  let y = M;

  const setInk = (c: [number, number, number]) => pdf.setTextColor(c[0], c[1], c[2]);
  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      pdf.addPage();
      y = M;
    }
  };
  const wrap = (text: string, width: number) => pdf.splitTextToSize(pdfText(text), width) as string[];
  const text = (t: string, size: number, style: 'normal' | 'bold', color: [number, number, number], width = W, x = M, lh = 1.45) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    setInk(color);
    const lines = wrap(t, width);
    const step = (size * 0.3528) * lh;
    for (const l of lines) {
      ensure(step);
      pdf.text(l, x, y + size * 0.3528);
      y += step;
    }
    return lines.length;
  };

  // En-tête
  text(doc.title, 20, 'bold', INK);
  text(doc.subtitle, 10, 'normal', MUTED);
  y += 3;
  pdf.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  pdf.setLineWidth(0.6);
  pdf.line(M, y, M + 24, y);
  y += 6;

  const draw: { [K in Block['t']]: (b: Extract<Block, { t: K }>) => void } = {
    h1: (b) => {
      y += 2;
      text(b.text, 16, 'bold', INK);
      y += 2;
    },
    h2: (b) => {
      ensure(14);
      y += 4;
      text(b.text, 12.5, 'bold', INK);
      y += 1.5;
    },
    p: (b) => {
      text(b.text, b.muted ? 9 : 10.5, 'normal', b.muted ? MUTED : INK);
      y += 2;
    },
    bullets: (b) => {
      const color = b.tone === 'good' ? GOOD : b.tone === 'work' ? BAD : ACCENT;
      for (const item of b.items) {
        const lines = wrap(item, W - 7);
        ensure(lines.length * 5 + 1);
        pdf.setFillColor(color[0], color[1], color[2]);
        pdf.circle(M + 2, y + 2.2, 0.9, 'F');
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10.5);
        setInk(INK);
        for (const l of lines) {
          pdf.text(l, M + 7, y + 3.2);
          y += 5;
        }
        y += 1;
      }
      y += 1;
    },
    stats: (b) => {
      const gap = 4;
      const cw = (W - gap * (b.items.length - 1)) / b.items.length;
      const h = 30;
      ensure(h + 4);
      b.items.forEach((s, i) => {
        const x = M + i * (cw + gap);
        pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
        pdf.setFillColor(FILL[0], FILL[1], FILL[2]);
        pdf.roundedRect(x, y, cw, h, 2.5, 2.5, 'FD');
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.5);
        setInk(MUTED);
        pdf.text(pdfText(s.label), x + 4, y + 7);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(18);
        setInk(INK);
        pdf.text(pdfText(s.value), x + 4, y + 17);
        if (s.sub) {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8.5);
          setInk(MUTED);
          pdf.text(pdfText(s.sub), x + 4, y + 24);
        }
        if (s.trend) {
          const cx = x + cw - 9;
          const cy = y + 15;
          if (s.trend === 'mieux') {
            pdf.setFillColor(GOOD[0], GOOD[1], GOOD[2]);
            pdf.triangle(cx - 3.5, cy + 3, cx + 3.5, cy + 3, cx, cy - 3.5, 'F');
          } else if (s.trend === 'moins') {
            pdf.setFillColor(BAD[0], BAD[1], BAD[2]);
            pdf.triangle(cx - 3.5, cy - 3, cx + 3.5, cy - 3, cx, cy + 3.5, 'F');
          } else {
            pdf.setFillColor(MUTED[0], MUTED[1], MUTED[2]);
            pdf.rect(cx - 3.5, cy - 0.6, 7, 1.2, 'F');
          }
        }
      });
      y += h + 5;
    },
    table: (b) => {
      const widths = (b.widths ?? b.head.map(() => 1 / b.head.length)).map((w) => w * W);
      const pad = 1.8;
      const fs = 9;
      const rowH = (cells: string[]) => Math.max(...cells.map((c, i) => wrap(c, widths[i]! - 2 * pad).length)) * 4.2 + 2 * pad - 0.6;
      const drawRow = (cells: string[], header: boolean) => {
        const h = rowH(cells);
        ensure(h);
        let x = M;
        if (header) {
          pdf.setFillColor(FILL[0], FILL[1], FILL[2]);
          pdf.rect(M, y, W, h, 'F');
        }
        pdf.setFont('helvetica', header ? 'bold' : 'normal');
        pdf.setFontSize(fs);
        setInk(header ? MUTED : INK);
        cells.forEach((c, i) => {
          const lines = wrap(c, widths[i]! - 2 * pad);
          lines.forEach((l, k) => pdf.text(l, x + pad, y + pad + 3 + k * 4.2));
          x += widths[i]!;
        });
        pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
        pdf.setLineWidth(0.2);
        pdf.line(M, y + h, M + W, y + h);
        y += h;
      };
      if (b.head.some((h) => h)) drawRow(b.head, true);
      for (const r of b.rows) drawRow(r, false);
      y += 4;
    },
    images: (b) => {
      const cols = Math.min(3, b.items.length);
      const gap = 3;
      const cw = (W - gap * (cols - 1)) / cols;
      for (let i = 0; i < b.items.length; i += cols) {
        const row = b.items.slice(i, i + cols);
        const hs = row.map((im) => (cw * im.height) / im.width);
        const h = Math.max(...hs) + 6;
        ensure(h + 2);
        row.forEach((im, k) => {
          const x = M + k * (cw + gap);
          try {
            pdf.addImage(im.dataUrl, 'JPEG', x, y, cw, hs[k]!, undefined, 'FAST');
          } catch {
            pdf.setFillColor(FILL[0], FILL[1], FILL[2]);
            pdf.rect(x, y, cw, hs[k]!, 'F');
          }
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          setInk(MUTED);
          pdf.text(pdfText(im.label), x, y + hs[k]! + 4);
        });
        y += h + 2;
      }
    },
    bars: (b) => {
      const h = 52;
      ensure(h + 8);
      text(`${b.title} (${b.unit})`, 9.5, 'bold', INK);
      const top = y + 2;
      const base = y + h - 12;
      const chartH = base - top - 4;
      const max = Math.max(1e-9, ...b.items.map((i) => i.value + (i.margin ?? 0)));
      const slot = W / b.items.length;
      pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
      pdf.setLineWidth(0.2);
      pdf.line(M, base, M + W, base);
      b.items.forEach((it, i) => {
        const bw = Math.min(14, slot * 0.62);
        const x = M + i * slot + (slot - bw) / 2;
        const bh = Math.max(0, (it.value / max) * chartH);
        pdf.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
        pdf.rect(x, base - bh, bw, bh, 'F');
        if (it.margin && it.margin > 0) {
          const mh = (it.margin / max) * chartH;
          pdf.setDrawColor(INK[0], INK[1], INK[2]);
          pdf.setLineWidth(0.3);
          pdf.line(x + bw / 2, base - bh - mh, x + bw / 2, base - bh + mh);
        }
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        setInk(INK);
        const label = Number.isFinite(it.value) ? it.value.toFixed(1).replace('.', ',') : '';
        pdf.text(label, x + bw / 2, base - bh - 1.8 - (it.margin ? (it.margin / max) * chartH : 0), { align: 'center' });
        setInk(MUTED);
        pdf.text(pdfText(it.label), x + bw / 2, base + 4, { align: 'center' });
      });
      y += h + 3;
    },
    box: (b) => {
      const h = b.lines * 7 + 8;
      ensure(h);
      pdf.setDrawColor(LINE[0], LINE[1], LINE[2]);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(M, y, W, h, 2, 2, 'S');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      setInk(MUTED);
      pdf.text(pdfText(b.text), M + 3, y + 5.5);
      for (let i = 1; i <= b.lines; i++) pdf.line(M + 3, y + 5.5 + i * 7, M + W - 3, y + 5.5 + i * 7);
      y += h + 4;
    },
  };

  for (const block of doc.blocks) (draw[block.t] as (b: Block) => void)(block);

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    setInk(MUTED);
    pdf.text(pdfText(doc.footer), M, PAGE_H - 9);
    pdf.text(`${i} / ${pages}`, PAGE_W - M, PAGE_H - 9, { align: 'right' });
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}

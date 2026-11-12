import 'server-only';
import PDFDocument from 'pdfkit';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { Column } from './modules/reports/types';

type Doc = InstanceType<typeof PDFDocument>;

const MARGIN = 40;
const GREEN = '#0e9f6e';
const MUTED = '#6b7c76';
const LINE = '#d9e1de';

/** Helvetica (WinAnsi) n'a pas les espaces fines ni certains symboles : on les remplace. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/→/g, '->').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[⚠✓✔]/g, '!').replace(/[“”]/g, '"');
}

export const moneyPlain = (value: string, currency: 'USD' | 'CDF') => pdfSafe(formatMoney(value, currency));

export function newPdf(): Doc {
  return new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Producer: 'SEC Finance Control' } });
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

export function drawHeader(doc: Doc, h: { entityName?: string; title: string; number?: string; subtitle?: string }) {
  doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(16).text(pdfSafe(h.entityName ?? 'SEC Finance Control'));
  doc.moveDown(0.3).fillColor('#14221e').fontSize(14).text(pdfSafe(h.title));
  const meta = [h.number ? `N° ${h.number}` : null, h.subtitle].filter(Boolean).join('  ·  ');
  if (meta) doc.moveDown(0.2).fillColor(MUTED).font('Helvetica').fontSize(10).text(pdfSafe(meta));
  doc.moveDown(0.6);
  doc.moveTo(MARGIN, doc.y).lineTo(doc.page.width - MARGIN, doc.y).strokeColor(GREEN).lineWidth(1.5).stroke();
  doc.moveDown(0.8).fillColor('#14221e').font('Helvetica').fontSize(10);
}

/** Pied de page « Généré le … par … — page x/y » sur toutes les pages (à appeler une fois, à la fin). */
export function drawFooters(doc: Doc, generatedAt: Date, generatedBy: string) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - MARGIN + 8;
    doc.fontSize(8).fillColor(MUTED).font('Helvetica');
    // Désactive la marge basse pour pouvoir écrire dans le pied sans déclencher de saut de page.
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.text(pdfSafe(`Généré le ${formatDateTime(generatedAt)} par ${generatedBy} — page ${i + 1}/${range.count}`), MARGIN, y, {
      width: doc.page.width - 2 * MARGIN, align: 'center', lineBreak: false,
    });
    doc.page.margins.bottom = saved;
  }
}

export function drawSectionTitle(doc: Doc, title: string) {
  ensureSpace(doc, 60);
  doc.moveDown(0.6).fillColor(GREEN).font('Helvetica-Bold').fontSize(11).text(pdfSafe(title)).moveDown(0.3);
  doc.fillColor('#14221e').font('Helvetica').fontSize(9);
}

function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - MARGIN - 24) doc.addPage();
}

export function cellText(col: Column, row: Record<string, string>): string {
  const v = row[col.key] ?? '';
  if (!v) return '';
  if (col.type === 'money') {
    const cur = (col.currencyKey ? row[col.currencyKey] : undefined) === 'CDF' ? 'CDF' : 'USD';
    return moneyPlain(v, cur);
  }
  if (col.type === 'date') return formatDate(v);
  return pdfSafe(v);
}

export function drawTable(doc: Doc, columns: Column[], rows: Record<string, string>[]) {
  const total = doc.page.width - 2 * MARGIN;
  const weights = columns.map((c) => c.width ?? (c.type === 'money' ? 1.2 : c.type === 'text' ? 2 : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * total);
  const pad = 3;

  const header = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
    let x = MARGIN;
    columns.forEach((c, i) => {
      doc.text(pdfSafe(c.label), x + pad, y, { width: widths[i]! - 2 * pad, align: c.type === 'money' || c.type === 'int' ? 'right' : 'left' });
      x += widths[i]!;
    });
    const h = Math.max(...columns.map((c, i) => doc.heightOfString(pdfSafe(c.label), { width: widths[i]! - 2 * pad })));
    doc.y = y + h + 3;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + total, doc.y).strokeColor(LINE).lineWidth(0.8).stroke();
    doc.y += 3;
    doc.font('Helvetica').fontSize(9).fillColor('#14221e');
  };

  ensureSpace(doc, 50);
  header();
  if (rows.length === 0) {
    doc.fillColor(MUTED).text('Aucune opération sur la période.', MARGIN + pad, doc.y).moveDown(0.5).fillColor('#14221e');
    return;
  }
  for (const row of rows) {
    const texts = columns.map((c) => cellText(c, row));
    const h = Math.max(...texts.map((t, i) => doc.heightOfString(t || ' ', { width: widths[i]! - 2 * pad }))) + 4;
    if (doc.y + h > doc.page.height - MARGIN - 24) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    let x = MARGIN;
    texts.forEach((t, i) => {
      const col = columns[i]!;
      doc.text(t, x + pad, y, { width: widths[i]! - 2 * pad, align: col.type === 'money' || col.type === 'int' ? 'right' : 'left' });
      x += widths[i]!;
    });
    doc.y = y + h;
    doc.moveTo(MARGIN, doc.y - 2).lineTo(MARGIN + total, doc.y - 2).strokeColor('#eef2f0').lineWidth(0.5).stroke();
  }
  doc.moveDown(0.3);
}

/** Cases de signature (demandeur, approbateur, caissier, bénéficiaire…). */
export function drawSignatureBoxes(doc: Doc, labels: string[]) {
  ensureSpace(doc, 110);
  doc.moveDown(1);
  const gap = 10;
  const w = (doc.page.width - 2 * MARGIN - gap * (labels.length - 1)) / labels.length;
  const y = doc.y;
  labels.forEach((label, i) => {
    const x = MARGIN + i * (w + gap);
    doc.rect(x, y, w, 80).strokeColor(LINE).lineWidth(1).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(pdfSafe(label), x + 6, y + 6, { width: w - 12 });
    doc.text('Nom, date et signature', x + 6, y + 66, { width: w - 12 });
  });
  doc.y = y + 90;
  doc.fillColor('#14221e');
}

export function drawKeyValues(doc: Doc, pairs: [string, string][]) {
  for (const [k, v] of pairs) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(pdfSafe(k), MARGIN, y, { width: 140 });
    doc.font('Helvetica-Bold').fillColor('#14221e').text(pdfSafe(v), MARGIN + 150, y, { width: doc.page.width - 2 * MARGIN - 150 });
    doc.moveDown(0.25);
  }
  doc.font('Helvetica').fontSize(10);
}

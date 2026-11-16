import 'server-only';
import ExcelJS from 'exceljs';
import { drawFooters, drawHeader, drawSectionTitle, drawSignatureBoxes, drawTable, newPdf, pdfSafe, toBuffer } from '@/server/pdf';
import type { Section, TabularDoc } from './types';

/** Rendu PDF d'un document tabulaire : en-tête, une table par section, pied « Généré le … page x/y ». */
export async function renderPdf(d: TabularDoc): Promise<Buffer> {
  const doc = newPdf();
  drawHeader(doc, { entityName: d.entityName, title: d.title, number: d.number, subtitle: d.subtitle });
  for (const s of d.sections) {
    drawSectionTitle(doc, s.title);
    drawTable(doc, s.columns, s.rows);
    if (s.note) doc.fontSize(8).fillColor('#6b7c76').text(pdfSafe(s.note)).fillColor('#14221e').fontSize(9);
  }
  if (d.signatures?.length) drawSignatureBoxes(doc, d.signatures);
  drawFooters(doc, d.generatedAt, d.generatedBy);
  return toBuffer(doc);
}

const sheetName = (title: string, used: Set<string>) => {
  const base = title.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Feuille';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

function fillSheet(ws: ExcelJS.Worksheet, s: Section) {
  ws.columns = s.columns.map((c) => ({
    header: c.label, key: c.key, width: c.type === 'text' ? 34 : c.type === 'money' ? 18 : 14,
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of s.rows) {
    const values: Record<string, string | number | Date | null> = {};
    for (const c of s.columns) {
      const raw = r[c.key] ?? '';
      if (raw === '') values[c.key] = null;
      // Cellules NUMÉRIQUES (SPEC §12 phase 7) : le montant reste décimal exact dans ReportData, converti ici pour l'affichage Excel.
      else if (c.type === 'money') values[c.key] = Number(raw);
      else if (c.type === 'int') values[c.key] = Number(raw);
      else if (c.type === 'date') values[c.key] = new Date(raw);
      else values[c.key] = raw;
    }
    const row = ws.addRow(values);
    s.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.type === 'money') cell.numFmt = '#,##0.00';
      else if (c.type === 'int') cell.numFmt = '0';
      else if (c.type === 'date') cell.numFmt = 'dd/mm/yyyy';
    });
  }
  s.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = '#,##0.00';
    if (c.type === 'int') col.numFmt = '0';
    if (c.type === 'date') col.numFmt = 'dd/mm/yyyy';
    if (c.type === 'money' || c.type === 'int') col.alignment = { horizontal: 'right' };
  });
  if (s.note) {
    ws.addRow([]);
    ws.addRow([s.note]);
  }
}

/** Excel : une feuille par section, montants en cellules numériques (format #,##0.00), devise en colonne. */
export async function renderXlsx(d: TabularDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fintrax';
  wb.created = d.generatedAt;
  const used = new Set<string>();
  const cover = wb.addWorksheet(sheetName('Résumé', used));
  cover.getColumn(1).width = 28;
  cover.getColumn(2).width = 60;
  cover.addRows([
    ['Document', d.title], ['Entité', d.entityName ?? '—'], ['Période', d.subtitle ?? '—'],
    ['Généré par', d.generatedBy], ['Généré le', d.generatedAt.toISOString()],
  ]);
  cover.getColumn(1).font = { bold: true };
  for (const s of d.sections) fillSheet(wb.addWorksheet(sheetName(s.title, used)), s);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

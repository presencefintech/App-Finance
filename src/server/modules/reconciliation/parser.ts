import 'server-only';
import ExcelJS from 'exceljs';
import { parseFlexibleDate } from '@/lib/dates';
import { D, type Money } from '@/server/money';

export interface ColumnMapping {
  hasHeader: boolean;
  date: number;
  label: number;
  reference?: number;
  /** Montant signé dans une seule colonne… */
  amount?: number;
  /** …ou colonnes débit / crédit séparées. */
  debit?: number;
  credit?: number;
}

export interface ParsedLine { position: number; date: Date; label: string; reference: string | null; amount: Money }
export interface ParseError { row: number; message: string }

/** Découpe une ligne CSV en respectant les guillemets. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsv(text: string): string[][] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const first = lines[0]!;
  const counts = { ';': (first.match(/;/g) ?? []).length, ',': (first.match(/,/g) ?? []).length, '\t': (first.match(/\t/g) ?? []).length };
  const sep = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]) as string;
  return lines.map((l) => splitCsvLine(l, sep));
}

export async function parseXlsx(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value;
      if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
      else if (v && typeof v === 'object' && 'result' in v) cells.push(String(v.result ?? ''));
      else if (v && typeof v === 'object' && 'text' in v) cells.push(String(v.text));
      else cells.push(v === null || v === undefined ? '' : String(v));
    }
    rows.push(cells.map((x) => x.trim()));
  });
  return rows;
}

export async function readStatementRows(fileName: string, buffer: Buffer): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return parseXlsx(buffer);
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCsv(buffer.toString('utf8'));
  throw new Error('UNSUPPORTED');
}

/**
 * Montant en chaîne → décimal exact. Accepte "1 250,50", "1.250,50", "-1250.50", "(100,00)", "100 CR".
 * Aucun passage par number (règle 1).
 */
export function parseAmount(raw: string): Money | null {
  let s = raw.trim().replace(/\s| | /g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/DB$/i.test(s)) { negative = true; s = s.slice(0, -2); }
  if (/CR$/i.test(s)) s = s.slice(0, -2);
  s = s.replace(/[A-Za-z$€]/g, '');
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  // Séparateur décimal = le dernier de , ou . s'il est suivi de 1 ou 2 chiffres ; les autres sont des milliers.
  const m = /^(.*?)[.,](\d{1,2})$/.exec(s);
  const intPart = (m ? m[1]! : s).replace(/[.,]/g, '');
  const frac = m ? m[2]! : '';
  if (!/^\d+$/.test(intPart) || (frac && !/^\d{1,2}$/.test(frac))) return null;
  const value = D(`${intPart}${frac ? '.' + frac : ''}`);
  return negative ? value.negated() : value;
}

/** Applique le mapping de colonnes et valide chaque ligne ; renvoie lignes valides + erreurs (rien n'est deviné). */
export function applyMapping(rows: string[][], mapping: ColumnMapping): { lines: ParsedLine[]; errors: ParseError[] } {
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  const offset = mapping.hasHeader ? 2 : 1;
  const lines: ParsedLine[] = [];
  const errors: ParseError[] = [];
  body.forEach((cells, i) => {
    const row = i + offset;
    if (cells.every((c) => !c)) return;
    const date = parseFlexibleDate(cells[mapping.date] ?? '');
    if (!date) return void errors.push({ row, message: `Date invalide « ${cells[mapping.date] ?? ''} »` });
    const label = (cells[mapping.label] ?? '').trim();
    if (!label) return void errors.push({ row, message: 'Libellé manquant' });

    let amount: Money | null = null;
    if (mapping.amount !== undefined) {
      amount = parseAmount(cells[mapping.amount] ?? '');
    } else {
      const debit = mapping.debit !== undefined ? parseAmount(cells[mapping.debit] ?? '') : null;
      const credit = mapping.credit !== undefined ? parseAmount(cells[mapping.credit] ?? '') : null;
      if (debit && !debit.isZero()) amount = debit.abs().negated();
      else if (credit && !credit.isZero()) amount = credit.abs();
      else if ((debit && debit.isZero()) || (credit && credit.isZero())) amount = D('0');
    }
    if (!amount) return void errors.push({ row, message: 'Montant invalide ou manquant' });
    if (amount.isZero()) return void errors.push({ row, message: 'Montant nul' });
    const ref = mapping.reference !== undefined ? (cells[mapping.reference] ?? '').trim() : '';
    lines.push({ position: lines.length + 1, date, label, reference: ref || null, amount });
  });
  return { lines, errors };
}

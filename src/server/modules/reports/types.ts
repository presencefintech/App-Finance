/** Document tabulaire neutre : une seule structure, deux rendus (PDF et Excel). */
export type ColType = 'text' | 'money' | 'date' | 'int';

export interface Column {
  key: string;
  label: string;
  type: ColType;
  /** Pour type 'money' : clé de la colonne portant la devise de la ligne. */
  currencyKey?: string;
  /** Largeur relative (PDF). */
  width?: number;
}

export interface Section {
  title: string;
  columns: Column[];
  /** Montants en chaînes décimales ("1250.00"), jamais en number. */
  rows: Record<string, string>[];
  note?: string;
}

export interface TabularDoc {
  title: string;
  subtitle?: string;
  entityName?: string;
  number?: string;
  generatedAt: Date;
  generatedBy: string;
  /** Cases de signature en fin de document (PDF). */
  signatures?: string[];
  sections: Section[];
}

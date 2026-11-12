import { toCardinal } from 'n2words/fr';

type Currency = 'USD' | 'CDF';

const UNITS: Record<Currency, { one: string; many: string; minorOne: string; minorMany: string }> = {
  USD: { one: 'dollar américain', many: 'dollars américains', minorOne: 'cent', minorMany: 'cents' },
  CDF: { one: 'franc congolais', many: 'francs congolais', minorOne: 'centime', minorMany: 'centimes' },
};

/** « un million de dollars », « deux milliards d'… » : "de" après million(s)/milliard(s) quand rien ne suit. */
const needsDe = (words: string) => /(million|millions|milliard|milliards)$/.test(words);

/**
 * Montant en lettres (français) à partir d'une CHAÎNE décimale ("2000.50").
 * Aucun calcul sur le montant : l'entier et les centimes sont convertis séparément en texte.
 * ex. « deux mille dollars américains et cinquante cents ».
 */
export function amountInWords(value: string, currency: Currency): string {
  const clean = value.trim().replace(/^-/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error(`Montant invalide : ${value}`);
  const [intPart = '0', fracRaw = ''] = clean.split('.');
  const minor = fracRaw.padEnd(2, '0');
  const u = UNITS[currency];

  const intWords = toCardinal(BigInt(intPart));
  const isSingular = BigInt(intPart) <= 1n; // « zéro dollar », « un dollar »
  const unit = isSingular ? u.one : u.many;
  const main = `${intWords}${needsDe(intWords) ? ' de' : ''} ${unit}`;

  if (minor === '00') return main;
  const minorN = Number(minor); // 1..99 : entier minuscule, pas un montant
  return `${main} et ${toCardinal(minorN)} ${minorN === 1 ? u.minorOne : u.minorMany}`;
}

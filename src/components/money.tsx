'use client';

import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { inputClass } from '@/components/ui/form';

type Currency = 'USD' | 'CDF';

/** Affichage d'un montant : chaîne décimale + devise, jamais de number. */
export function Money({ value, currency, className }: { value: string; currency: Currency; className?: string }) {
  const negative = value.startsWith('-');
  return (
    <span className={cn('tabular-nums', negative && 'text-danger', className)}>{formatMoney(value, currency)}</span>
  );
}

/** Saisie de montant en chaîne (2 décimales max), jamais parsée en float. */
export function MoneyInput({
  value, onChange, currency, required, id,
}: {
  value: string; onChange: (v: string) => void; currency: Currency; required?: boolean; id?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id} value={value} required={required} inputMode="decimal" placeholder="0.00"
        onChange={(e) => {
          const v = e.target.value.replace(',', '.');
          if (/^\d{0,16}(\.\d{0,2})?$/.test(v)) onChange(v);
        }}
        className={cn(inputClass, 'pr-14 tabular-nums')}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{currency}</span>
    </div>
  );
}

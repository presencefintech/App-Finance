import { cn } from '@/lib/cn';

export const inputClass =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary';

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="mb-4 block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: React.ComponentProps<'button'> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cn(
        'rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50',
        variant === 'primary' && 'bg-primary text-white',
        variant === 'ghost' && 'border border-border bg-card text-foreground hover:bg-background',
        variant === 'danger' && 'bg-danger text-white',
        className,
      )}
      {...props}
    />
  );
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  return children ? (
    <p role="alert" className="mb-3 text-sm text-danger">
      {children}
    </p>
  ) : null;
}

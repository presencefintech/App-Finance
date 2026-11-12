import { cn } from '@/lib/cn';

const tones = {
  success: 'bg-primary/10 text-primary',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-border text-muted',
} as const;

export function StatusBadge({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
  );
}

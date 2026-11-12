import { cn } from '@/lib/cn';

export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn('rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(20,34,30,0.04)]', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('mb-4 text-base font-semibold', className)} {...props} />;
}

import { cn } from '@/lib/cn';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

const variants: Record<BadgeVariant, string> = {
  default: 'bg-surface-container-high text-on-surface-variant',
  success: 'bg-tertiary/10 text-tertiary',
  warning: 'bg-amber-500/10 text-amber-400',
  error: 'bg-error/10 text-error',
  info: 'bg-primary/10 text-primary',
};

export function Badge({ children, variant = 'default', className }: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
      variants[variant],
      className
    )}>
      {children}
    </span>
  );
}

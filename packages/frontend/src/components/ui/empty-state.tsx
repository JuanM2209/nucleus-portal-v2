interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && (
        <div className="mb-4 text-on-surface-variant/40">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold text-on-surface">{title}</h3>
      {description && (
        <p className="text-sm text-on-surface-variant mt-2 max-w-md">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

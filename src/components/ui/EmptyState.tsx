import { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="text-4xl opacity-20">{icon}</div>
      <div className="text-lg font-semibold tracking-tight" style={{ color: "var(--muted2)" }}>
        {title}
      </div>
      <div className="max-w-sm text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {description}
      </div>
      {actions && <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

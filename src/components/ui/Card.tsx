import { ReactNode } from "react";

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-shell ${className}`.trim()}>
      {title && <div className="card-header">{title}</div>}
      {children}
    </div>
  );
}

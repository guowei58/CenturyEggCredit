import { ReactNode } from "react";

export function Card({
  title,
  children,
  className = "",
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-shell ${className}`.trim()}>
      {title != null && title !== "" && <div className="card-header">{title}</div>}
      {children}
    </div>
  );
}

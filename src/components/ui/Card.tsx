import { ReactNode } from "react";

export function Card({
  title,
  titleAside,
  children,
  className = "",
}: {
  title?: ReactNode;
  /** Rendered inline after the title (e.g. actions). */
  titleAside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const showHeader = (title != null && title !== "") || titleAside != null;
  return (
    <div className={`card-shell ${className}`.trim()}>
      {showHeader ? (
        <div className="card-header flex flex-wrap items-center gap-2">
          {title != null && title !== "" ? <span>{title}</span> : null}
          {titleAside}
        </div>
      ) : null}
      {children}
    </div>
  );
}

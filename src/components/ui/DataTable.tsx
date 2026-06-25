import { ReactNode } from "react";

export function DataTable({
  children,
  grid,
  className,
}: {
  children: ReactNode;
  grid?: boolean;
  className?: string;
}) {
  const classes = ["table-institutional", grid && "table-institutional-grid", className]
    .filter(Boolean)
    .join(" ");
  return <table className={classes}>{children}</table>;
}

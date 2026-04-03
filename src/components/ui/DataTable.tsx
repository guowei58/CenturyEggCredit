import { ReactNode } from "react";

export function DataTable({ children }: { children: ReactNode }) {
  return <table className="table-institutional">{children}</table>;
}

"use client";

import { Card } from "@/components/ui";
import { IrPageIndexer } from "@/components/irIndexer/IrPageIndexer";

export function CompanyIrPageIndexerTab({ ticker }: { ticker: string }) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();

  if (!safeTicker) {
    return (
      <Card title="IR Page Indexer">
        <p className="py-4 text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to index its IR pages.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`IR Page Indexer — ${safeTicker}`}>
      <IrPageIndexer ticker={safeTicker} />
    </Card>
  );
}


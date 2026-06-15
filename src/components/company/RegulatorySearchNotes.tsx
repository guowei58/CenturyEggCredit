"use client";

export function RegulatorySearchNotes({
  notes,
  className = "mt-4",
}: {
  notes: string[];
  className?: string;
}) {
  const filtered = notes.map((n) => n.trim()).filter(Boolean);
  if (filtered.length === 0) return null;

  return (
    <details
      className={`${className} rounded-lg border text-sm group`}
      style={{ borderColor: "var(--border2)", background: "rgba(250,204,21,0.06)", color: "var(--text)" }}
    >
      <summary
        className="cursor-pointer list-none px-4 py-2 text-xs font-semibold uppercase tracking-wider [&::-webkit-details-marker]:hidden"
        style={{ color: "var(--muted)" }}
      >
        <span className="inline-flex w-full items-center justify-between gap-2">
          <span>Search notes ({filtered.length})</span>
          <span className="font-normal normal-case tracking-normal" style={{ color: "var(--accent)" }}>
            <span className="group-open:hidden">Show</span>
            <span className="hidden group-open:inline">Hide</span>
          </span>
        </span>
      </summary>
      <ul
        className="space-y-1 border-t px-4 py-3 text-xs leading-relaxed"
        style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
      >
        {filtered.map((note, index) => (
          <li key={`${note}-${index}`}>• {note}</li>
        ))}
      </ul>
    </details>
  );
}

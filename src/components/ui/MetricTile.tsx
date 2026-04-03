import { ReactNode } from "react";

export function MetricTile({
  label,
  value,
  subtitle,
  valueColor,
}: {
  label: string;
  value: ReactNode;
  subtitle?: string;
  valueColor?: string;
}) {
  return (
    <div className="metric-tile">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {subtitle && (
        <div className="mt-1 text-[10px]" style={{ color: "var(--muted)" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

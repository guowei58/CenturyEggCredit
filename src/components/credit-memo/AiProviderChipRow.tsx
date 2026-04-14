"use client";

import { aiProviderChipStyle, type AiProvider } from "@/lib/ai-provider";
import { AiModelPicker } from "@/components/AiModelPicker";

export function AiProviderChipRow({
  aiProvider,
  onProviderChange,
  className,
}: {
  aiProvider: AiProvider;
  onProviderChange: (p: AiProvider) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 mb-4 ${className ?? ""}`}>
      <span className="text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
        Provider:
      </span>
      <div className="inline-flex rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
        <button
          type="button"
          onClick={() => onProviderChange("claude")}
          className="px-3 py-1.5 text-[11px] font-medium transition-colors"
          style={aiProviderChipStyle(aiProvider, "claude")}
        >
          Claude
        </button>
        <button
          type="button"
          onClick={() => onProviderChange("openai")}
          className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
          style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "openai") }}
        >
          ChatGPT
        </button>
        <button
          type="button"
          onClick={() => onProviderChange("gemini")}
          className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
          style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "gemini") }}
        >
          Gemini
        </button>
        <button
          type="button"
          onClick={() => onProviderChange("deepseek")}
          className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
          style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "deepseek") }}
        >
          DeepSeek
        </button>
      </div>
      <AiModelPicker provider={aiProvider} className="mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto" />
    </div>
  );
}

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/lib/ratings-link-search/**/*.test.ts",
      "src/lib/news/**/*.test.ts",
      "src/lib/brokerResearch/**/*.test.ts",
      "src/lib/xSearch/**/*.test.ts",
      "src/lib/researchFinder/**/*.test.ts",
      "src/lib/substack/**/*.test.ts",
      "src/lib/irIndexer/**/*.test.ts",
      "src/lib/reddit/**/*.test.ts",
      "src/lib/reddit/*.test.ts",
      "src/lib/creditMemo/**/*.test.ts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/lib/egg-hoc-chat/**/*.test.ts",
      "src/lib/ratings-link-search/**/*.test.ts",
      "src/lib/news/**/*.test.ts",
      "src/lib/brokerResearch/**/*.test.ts",
      "src/lib/xSearch/**/*.test.ts",
      "src/lib/researchFinder/**/*.test.ts",
      "src/lib/substack/**/*.test.ts",
      "src/lib/reddit/**/*.test.ts",
      "src/lib/reddit/*.test.ts",
      "src/lib/creditMemo/**/*.test.ts",
      "src/lib/xbrl-saved-history/**/*.test.ts",
      "src/lib/sec-edgar.test.ts",
      "src/lib/sec-filing-exhibits.test.ts",
      "src/lib/exhibit21GridExtract.test.ts",
      "src/lib/buildPublicRecordsProfileFromSec.test.ts",
      "src/lib/subsidiary-name-hints.test.ts",
      "src/lib/debt-map/**/*.test.ts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

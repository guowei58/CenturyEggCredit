import { describe, expect, it } from "vitest";
import { parseRiskAiAnswersJson } from "./parse-risk-ai-answers";

describe("parseRiskAiAnswersJson", () => {
  it("parses raw JSON", () => {
    const parsed = parseRiskAiAnswersJson(
      JSON.stringify({
        answers: [{ questionCode: "IBR-01", answerLabel: "yes", rationale: "test" }],
      })
    );
    expect(parsed?.answers[0]?.questionCode).toBe("IBR-01");
    expect(parsed?.answers[0]?.answerLabel).toBe("yes");
  });

  it("parses fenced JSON", () => {
    const parsed = parseRiskAiAnswersJson(
      'Here is the result:\n```json\n{"answers":[{"questionCode":"FIN-02","answerLabel":"no"}]}\n```'
    );
    expect(parsed?.answers[0]?.answerLabel).toBe("no");
  });

  it("rejects invalid labels", () => {
    const parsed = parseRiskAiAnswersJson(
      JSON.stringify({ answers: [{ questionCode: "IBR-01", answerLabel: "maybe" }] })
    );
    expect(parsed).toBeNull();
  });
});

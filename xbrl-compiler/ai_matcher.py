"""AI-powered concept matching for line items that deterministic rules cannot resolve.

This module is the ONLY place in the pipeline that uses AI.  It sends a single
batch request to an OpenAI-compatible chat-completion endpoint with:
  - the master row registry (from the latest 10-K)
  - the list of unmatched concepts + their display labels

The AI returns a JSON mapping:
    { "statement_type||raw_concept": "canonical_row_id" | null }

If the AI is unsure about a match, it returns null and the concept stays
as a separate row (or goes to unresolved).  The pipeline treats the AI
output as a deterministic lookup — AI never touches numbers or derivations.
"""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# ── Types ─────────────────────────────────────────────────────────────────

@dataclass
class UnmatchedConcept:
    statement_type: str
    raw_concept: str
    display_label: str


@dataclass
class AiMatchResult:
    statement_type: str
    raw_concept: str
    canonical_row_id: str | None


# ── Prompt construction ───────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are an expert financial-statement line-item matcher specializing in SEC \
XBRL filings.  You will receive:
1. A MASTER chart of accounts (from a company's latest 10-K filing).
2. A list of UNMATCHED line items from the same company's older filings.

Your job: for each unmatched item, decide which master row it corresponds to \
based on ECONOMIC MEANING, not exact wording.

CRITICAL MATCHING RULES:
- XBRL labels are often very verbose.  A long label and a short label can be \
the same line item.  Focus on what the number economically represents.
- Only match within the SAME statement type (income_statement, balance_sheet, \
cash_flow).
- If you are NOT confident an item maps to any master row, return null.
- Do NOT invent master rows.  Only use canonical_row_ids from the master list.
- Return ONLY valid JSON.  No commentary, no markdown fences.

COMMON EQUIVALENCES YOU MUST RECOGNIZE:
- "Income (Loss) from Continuing Operations before Equity Method Investments, \
Income Taxes, Noncontrolling Interest" = "Income before income taxes" \
(both are pre-tax income)
- "Cost of revenue" = "Cost of goods sold" = "Cost of sales"
- "Net income (loss)" = "Net income" = "Net earnings"
- "SG&A" = "Selling, general and administrative expense"
- "Revenue" = "Net revenue" = "Total revenue" = "Net sales" = "Sales"
- "Research and development" = "Research and development expense"
- "Interest expense, net" = "Interest expense" = "Net interest expense"
- "Provision for income taxes" = "Income tax expense" = "Income tax provision"
- "Cash and cash equivalents" = "Cash and cash equivalent"
- "Property, plant and equipment, net" = "Property and equipment, net" = "PP&E"
- "Accounts receivable, net" = "Trade receivables" = "Receivables"
- "Depreciation and amortization" = "Depreciation & amortization" = "D&A"
- "Net cash provided by operating activities" = "Cash flows from operations"
- "Net cash used in investing activities" = "Cash flows from investing"
- "Net cash used in financing activities" = "Cash flows from financing"
- Verbose GAAP labels with qualifiers like "before equity method investments, \
noncontrolling interest" are often the SAME as shorter labels without those \
qualifiers — the economic meaning is what matters.
- When a label adds "(loss)" in parentheses, it is the same item as without.
- Subtotals in older filings may map to the closest matching subtotal in the \
master even if the exact scope differs slightly."""

_USER_TEMPLATE = """\
MASTER ROWS (statement_type | canonical_row_id | display_label):
{master_rows}

UNMATCHED ITEMS (statement_type | raw_concept | display_label):
{unmatched_items}

Return a JSON object mapping each unmatched item's key to its master \
canonical_row_id, or null if you cannot confidently match it.
Key format: "statement_type||raw_concept"

Example output:
{{
  "income_statement||custom:CostOfGoodsSold": "us-gaap:CostOfRevenue",
  "income_statement||custom:Unknown": null
}}"""


def _build_prompt(
    master_rows: list[dict],
    unmatched: list[UnmatchedConcept],
) -> str:
    mr_lines = "\n".join(
        f"{r['statement_type']} | {r['canonical_row_id']} | {r['display_label']}"
        for r in master_rows
    )
    um_lines = "\n".join(
        f"{u.statement_type} | {u.raw_concept} | {u.display_label}"
        for u in unmatched
    )
    return _USER_TEMPLATE.format(master_rows=mr_lines, unmatched_items=um_lines)


# ── API call ──────────────────────────────────────────────────────────────

_PROVIDER_URLS: dict[str, str] = {
    "openai":   "https://api.openai.com/v1/chat/completions",
    "deepseek": "https://api.deepseek.com/v1/chat/completions",
}

_DEFAULT_MODELS: dict[str, str] = {
    "openai":   "gpt-4o",
    "deepseek": "deepseek-chat",
}


def _call_llm(
    provider: str,
    api_key: str,
    model: str | None,
    system_prompt: str,
    user_prompt: str,
    timeout: int = 120,
) -> str:
    url = _PROVIDER_URLS.get(provider)
    if not url:
        raise ValueError(f"Unknown AI provider: {provider}")

    mdl = model or _DEFAULT_MODELS.get(provider, "gpt-4o")
    body = json.dumps({
        "model": mdl,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }).encode()

    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    logger.info("AI matcher: calling %s  model=%s  payload=%d chars", provider, mdl, len(user_prompt))

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode())

    content: str = data["choices"][0]["message"]["content"]
    return content.strip()


def _parse_ai_response(raw: str) -> dict[str, str | None]:
    """Extract JSON object from AI response, tolerating markdown fences."""
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


# ── Public API ────────────────────────────────────────────────────────────

def ai_match_concepts(
    master_rows: list[dict],
    unmatched: list[UnmatchedConcept],
    provider: str = "openai",
    api_key: str | None = None,
    model: str | None = None,
) -> list[AiMatchResult]:
    """Send unmatched concepts to an AI and return proposed mappings.

    Parameters
    ----------
    master_rows : list[dict]
        Each dict has keys ``statement_type``, ``canonical_row_id``,
        ``display_label``.
    unmatched : list[UnmatchedConcept]
        Concepts that Phase 1+2 could not map deterministically.
    provider : str
        ``"openai"`` or ``"deepseek"``.
    api_key : str | None
        Falls back to ``OPENAI_API_KEY`` / ``DEEPSEEK_API_KEY`` env var.
    model : str | None
        Override the default model for the provider.

    Returns
    -------
    list[AiMatchResult]
        One entry per unmatched concept.  ``canonical_row_id`` is None if
        the AI couldn't confidently match it.
    """
    if not unmatched:
        return []

    key = api_key
    if not key:
        env_name = f"{provider.upper()}_API_KEY"
        key = os.environ.get(env_name, "")
    if not key:
        logger.warning("AI matcher: no API key for %s — skipping AI matching", provider)
        return [AiMatchResult(u.statement_type, u.raw_concept, None) for u in unmatched]

    # Build valid canonical_row_ids set for validation
    valid_ids: dict[str, set[str]] = {}
    for r in master_rows:
        valid_ids.setdefault(r["statement_type"], set()).add(r["canonical_row_id"])

    user_prompt = _build_prompt(master_rows, unmatched)

    try:
        raw_response = _call_llm(provider, key, model, _SYSTEM_PROMPT, user_prompt)
        logger.info("AI matcher: raw response length = %d chars", len(raw_response))
        mapping = _parse_ai_response(raw_response)
    except (urllib.error.URLError, json.JSONDecodeError, KeyError, Exception) as exc:
        logger.error("AI matcher failed: %s — all items remain unmatched", exc)
        return [AiMatchResult(u.statement_type, u.raw_concept, None) for u in unmatched]

    results: list[AiMatchResult] = []
    matched = 0
    skipped_invalid = 0
    for u in unmatched:
        lookup_key = f"{u.statement_type}||{u.raw_concept}"
        canon = mapping.get(lookup_key)

        if canon is not None:
            st_valid = valid_ids.get(u.statement_type, set())
            if canon not in st_valid:
                logger.warning(
                    "AI returned invalid canonical_row_id '%s' for %s — ignoring",
                    canon, lookup_key,
                )
                canon = None
                skipped_invalid += 1
            else:
                matched += 1
                logger.info("AI MATCH: %s → %s  (label='%s')", u.raw_concept, canon, u.display_label)

        results.append(AiMatchResult(u.statement_type, u.raw_concept, canon))

    logger.info(
        "AI matcher: %d/%d resolved, %d invalid IDs rejected, %d unresolved",
        matched, len(unmatched), skipped_invalid, len(unmatched) - matched - skipped_invalid,
    )
    return results

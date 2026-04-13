"""Build master presentation layout + concept-to-row map.

The latest 10-K defines:
  - row order
  - display labels
  - depth / indentation

ALL workbooks contribute concepts.  Matching proceeds in three phases:

  Phase 1 – master 10-K seeds canonical rows with display order + labels.
  Phase 2 – deterministic matching (local-name + normalized-label).
  Phase 3 – AI reconciliation: unmatched concepts are sent to an LLM which
            returns a JSON mapping to master rows.  Only this step uses AI.
  Fallback – anything still unmatched becomes a new row *positioned next to
            its nearest mapped neighbor* from the source filing, not just
            dumped at the bottom.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

from workbook_loader import WorkbookInfo

logger = logging.getLogger(__name__)


# ── Data classes ──────────────────────────────────────────────────────────

@dataclass
class MasterRow:
    statement_type: str
    canonical_row_id: str      # stable row key (= concept from master)
    master_raw_concept: str    # concept as it appears in source
    display_label: str         # Line text (from master 10-K when available)
    display_order: float       # sequential position within its statement
    depth: int


@dataclass
class ConceptMapping:
    statement_type: str
    raw_concept: str
    canonical_row_id: str
    mapping_status: str        # auto_from_master | auto_local_name | auto_label_match | ai_matched | auto_from_filing
    notes: str


# ── Deterministic matching helpers ────────────────────────────────────────

def _extract_local_name(concept: str) -> str:
    """Strip namespace prefix, returning only the local part of a QName.

    Examples:
        us-gaap:Revenue                       → Revenue
        cabo:CustomConcept                    → CustomConcept
        http://fasb.org/us-gaap/2024/Revenue  → Revenue
        Revenue                               → Revenue
    """
    if "://" in concept:
        return concept.rsplit("/", 1)[1]
    if ":" in concept:
        return concept.rsplit(":", 1)[1]
    if "/" in concept:
        return concept.rsplit("/", 1)[1]
    return concept


# Irregular plurals that a simple trailing-s strip cannot handle
_IRREGULAR_PLURALS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bliabilities\b"),  "liability"),
    (re.compile(r"\bactivities\b"),   "activity"),
    (re.compile(r"\bsecurities\b"),   "security"),
    (re.compile(r"\bsubsidiaries\b"), "subsidiary"),
    (re.compile(r"\bcategories\b"),   "category"),
    (re.compile(r"\binventories\b"),  "inventory"),
    (re.compile(r"\btaxes\b"),        "tax"),
    (re.compile(r"\blosses\b"),       "loss"),
]

# General -ies → -y  (e.g. "companies" → "company")
_IES_RE = re.compile(r"\b(\w{2,})ies\b")

# General trailing-s strip for regular plurals (4+ char words).
# Excludes words ending in 'ss' (loss, gross), 'us' (surplus, bonus),
# or 'is' (basis, analysis) to avoid mangling non-plural forms.
_TRAILING_S_RE = re.compile(r"\b(\w{3,}[^sui])s\b")


# ── Verbose XBRL description condensers ──────────────────────────────────
# XBRL concepts have both terse labels ("Income before income taxes") and
# verbose documentation strings ("Amount of income (loss) from continuing
# operations, net of tax, before addition of income (loss) from equity
# method investments.").  These regexes strip the filler so both versions
# normalise to the same string.

_CONDENSER_RULES: list[tuple[re.Pattern, str]] = [
    # "Amount of ..." / "Aggregate amount of ..." → strip prefix
    (re.compile(r"^(?:aggregate\s+)?amount\s+of\s+", re.I), ""),
    # ", net of tax," / "net of income taxes" → remove
    (re.compile(r",?\s*net\s+of\s+(?:income\s+)?tax(?:es)?\s*,?", re.I), " "),
    # "before addition of income (loss) from" → "before"
    (re.compile(
        r"before\s+(?:addition|deduction)\s+(?:of|for)\s+"
        r"(?:income\s+(?:from\s+)?)?",
        re.I,
    ), "before "),
    # "after addition of income (loss) from" → "after"
    (re.compile(
        r"after\s+(?:addition|deduction)\s+(?:of|for)\s+"
        r"(?:income\s+(?:from\s+)?)?",
        re.I,
    ), "after "),
    # "including ..." clause up to comma/end → remove
    (re.compile(r",?\s*including\s+(?:accretion|amortization)\b[^,]*,?", re.I), " "),
]


def _normalize_label(label: str) -> str:
    """Deterministic label normalization for matching.

    Rules (applied in order):
      1. lowercase
      2. remove parenthetical content  e.g. "(loss)" "(in millions)"
      3. ``&`` → ``and``
      4. condense verbose XBRL documentation phrases
      5. de-pluralize (irregular then general rules)
      6. strip leading "total "
      7. strip trailing commas / colons / semicolons
      8. replace non-alphanumeric with space
      9. collapse whitespace
    """
    s = label.lower().strip()
    s = re.sub(r"\([^)]*\)", "", s)
    s = s.replace("&", " and ")
    for pat, repl in _CONDENSER_RULES:
        s = pat.sub(repl, s)
    for pat, repl in _IRREGULAR_PLURALS:
        s = pat.sub(repl, s)
    s = _IES_RE.sub(r"\1y", s)
    s = _TRAILING_S_RE.sub(r"\1", s)
    s = re.sub(r"^total\s+", "", s)
    s = re.sub(r"[,;:]+\s*$", "", s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ── Positional helpers ────────────────────────────────────────────────────

def _renumber_display_order(rows: list[MasterRow]) -> None:
    """Re-assign integer display_order values per statement type after sorting."""
    by_stmt: dict[str, list[MasterRow]] = {}
    for r in rows:
        by_stmt.setdefault(r.statement_type, []).append(r)
    for stmt_rows in by_stmt.values():
        stmt_rows.sort(key=lambda r: r.display_order)
        for i, r in enumerate(stmt_rows):
            r.display_order = i


# ── Builder ───────────────────────────────────────────────────────────────

@dataclass
class _UnmatchedItem:
    statement_type: str
    concept: str
    label: str
    depth: int
    source_file: str
    anchor_canon: str | None     # canonical_row_id of nearest preceding mapped concept


def build_master_presentation(
    master_wb: WorkbookInfo,
    all_workbooks: list[WorkbookInfo] | None = None,
    ai_provider: str | None = None,
    ai_api_key: str | None = None,
    ai_model: str | None = None,
) -> tuple[list[MasterRow], list[ConceptMapping]]:
    """
    Build the row registry and concept map.

    Phase 1 – master 10-K seeds canonical rows (order + labels).
    Phase 2 – deterministic matching + positional tracking:
        a) exact match  → already registered, skip (update position tracker)
        b) local-name match → map to existing master row
        c) normalized-label match → map to existing master row (**not** used for
           ``balance_sheet`` — label-only collapse was hiding distinct asset lines)
        d) no match → collected for Phase 3 with anchor info
    Phase 3 – AI reconciliation (if provider configured).
    Fallback – unmatched items inserted next to their nearest mapped neighbor.
    """
    master_rows: list[MasterRow] = []
    concept_map: list[ConceptMapping] = []

    seen: set[tuple[str, str]] = set()          # (stmt_type, concept)

    # Maps (stmt_type, raw_concept) → canonical_row_id for positional lookups
    concept_to_canon: dict[tuple[str, str], str] = {}

    # ── Phase 1: master 10-K ──────────────────────────────────────────
    for sheet in master_wb.sheets:
        for idx, concept in enumerate(sheet.row_order):
            if not concept:
                continue
            key = (sheet.statement_type, concept)
            if key in seen:
                continue
            seen.add(key)

            label = sheet.concept_to_line.get(concept, concept)
            depth = sheet.concept_to_depth.get(concept, 0)

            master_rows.append(MasterRow(
                statement_type=sheet.statement_type,
                canonical_row_id=concept,
                master_raw_concept=concept,
                display_label=label,
                display_order=idx,
                depth=depth,
            ))
            concept_map.append(ConceptMapping(
                statement_type=sheet.statement_type,
                raw_concept=concept,
                canonical_row_id=concept,
                mapping_status="auto_from_master",
                notes=f"Seeded from master 10-K: {master_wb.filename}",
            ))
            concept_to_canon[key] = concept

    master_count = len(master_rows)

    # ── Build lookup indices from Phase-1 master rows ─────────────────
    local_name_idx: dict[tuple[str, str], str] = {}
    norm_label_idx: dict[tuple[str, str], str] = {}

    for row in master_rows:
        local = _extract_local_name(row.canonical_row_id)
        lk = (row.statement_type, local)
        if lk not in local_name_idx:
            local_name_idx[lk] = row.canonical_row_id

        norm = _normalize_label(row.display_label)
        if norm:
            nk = (row.statement_type, norm)
            if nk not in norm_label_idx:
                norm_label_idx[nk] = row.canonical_row_id

    # ── Phase 2: deterministic matching + positional tracking ─────────
    matched_local = 0
    matched_label = 0
    still_unmatched: list[_UnmatchedItem] = []

    if all_workbooks:
        for wb in all_workbooks:
            for sheet in wb.sheets:
                st = sheet.statement_type
                last_mapped_canon: str | None = None

                for concept in sheet.row_order:
                    if not concept:
                        continue
                    key = (st, concept)

                    if key in seen:
                        # Already registered — update position tracker
                        last_mapped_canon = concept_to_canon.get(key, concept)
                        continue

                    seen.add(key)

                    # ─ Layer 1: local-name match ──────────────
                    local = _extract_local_name(concept)
                    canon = local_name_idx.get((st, local))
                    if canon is not None:
                        concept_map.append(ConceptMapping(
                            statement_type=st,
                            raw_concept=concept,
                            canonical_row_id=canon,
                            mapping_status="auto_local_name",
                            notes=f"Local name '{local}' matched master {canon} (from {wb.filename})",
                        ))
                        concept_to_canon[key] = canon
                        last_mapped_canon = canon
                        matched_local += 1
                        continue

                    # ─ Layer 2: normalized-label match (IS/CF only) ───────────
                    # On the balance sheet, label-only matching is unsafe: distinct
                    # GAAP tags (e.g. finite-lived intangibles vs goodwill, or
                    # investments vs other assets) often normalize to overlapping
                    # text and would collapse into a single row.  Local-name match
                    # still maps ``us-gaap:Foo`` ↔ ``vendor:Foo`` when the element
                    # name matches.
                    raw_label = sheet.concept_to_line.get(concept, "")
                    if st != "balance_sheet" and raw_label:
                        norm = _normalize_label(raw_label)
                        if norm:
                            canon = norm_label_idx.get((st, norm))
                            if canon is not None:
                                concept_map.append(ConceptMapping(
                                    statement_type=st,
                                    raw_concept=concept,
                                    canonical_row_id=canon,
                                    mapping_status="auto_label_match",
                                    notes=f"Normalized label '{norm}' matched master {canon} (from {wb.filename})",
                                ))
                                concept_to_canon[key] = canon
                                last_mapped_canon = canon
                                matched_label += 1
                                continue

                    # ─ Collect for Phase 3 with anchor ────────
                    label = raw_label or concept
                    depth = sheet.concept_to_depth.get(concept, 0)
                    still_unmatched.append(_UnmatchedItem(
                        statement_type=st,
                        concept=concept,
                        label=label,
                        depth=depth,
                        source_file=wb.filename,
                        anchor_canon=last_mapped_canon,
                    ))

    # ── Phase 3: AI reconciliation ────────────────────────────────────
    matched_ai = 0

    if still_unmatched and ai_provider:
        try:
            import ai_matcher as _aim

            master_dicts = [
                {"statement_type": r.statement_type,
                 "canonical_row_id": r.canonical_row_id,
                 "display_label": r.display_label}
                for r in master_rows
            ]
            um_objs = [
                _aim.UnmatchedConcept(it.statement_type, it.concept, it.label)
                for it in still_unmatched
            ]

            ai_results = _aim.ai_match_concepts(
                master_dicts, um_objs,
                provider=ai_provider,
                api_key=ai_api_key,
                model=ai_model,
            )

            ai_map: dict[tuple[str, str], str] = {}
            for r in ai_results:
                if r.canonical_row_id is not None:
                    ai_map[(r.statement_type, r.raw_concept)] = r.canonical_row_id

            remaining: list[_UnmatchedItem] = []
            for item in still_unmatched:
                canon = ai_map.get((item.statement_type, item.concept))
                if canon is not None:
                    concept_map.append(ConceptMapping(
                        statement_type=item.statement_type,
                        raw_concept=item.concept,
                        canonical_row_id=canon,
                        mapping_status="ai_matched",
                        notes=f"AI matched to {canon} (from {item.source_file})",
                    ))
                    concept_to_canon[(item.statement_type, item.concept)] = canon
                    matched_ai += 1
                else:
                    remaining.append(item)

            still_unmatched = remaining
        except Exception as exc:
            logger.error("Phase 3 AI matching failed: %s — proceeding without AI", exc)

    # ── Fallback: insert unmatched rows at their correct position ─────
    # Build display_order lookup from existing master rows
    order_of: dict[tuple[str, str], float] = {
        (r.statement_type, r.canonical_row_id): r.display_order
        for r in master_rows
    }

    # Group unmatched items by their anchor so we can assign incremental
    # sub-positions after each anchor.
    anchor_counters: dict[tuple[str, str | None], int] = {}

    new_rows = 0
    for item in still_unmatched:
        anchor_key = (item.statement_type, item.anchor_canon)
        seq = anchor_counters.get(anchor_key, 0)
        anchor_counters[anchor_key] = seq + 1

        if item.anchor_canon is not None:
            anchor_order = order_of.get(
                (item.statement_type, item.anchor_canon)
            )
            if anchor_order is not None:
                new_order = anchor_order + 0.001 * (seq + 1)
            else:
                new_order = 9999.0 + seq
        else:
            new_order = -1.0 + 0.001 * seq

        master_rows.append(MasterRow(
            statement_type=item.statement_type,
            canonical_row_id=item.concept,
            master_raw_concept=item.concept,
            display_label=item.label,
            display_order=new_order,
            depth=item.depth,
        ))
        concept_map.append(ConceptMapping(
            statement_type=item.statement_type,
            raw_concept=item.concept,
            canonical_row_id=item.concept,
            mapping_status="auto_from_filing",
            notes=(
                f"Positioned after {item.anchor_canon} — added from {item.source_file}"
                if item.anchor_canon
                else f"No anchor — added from {item.source_file}"
            ),
        ))
        new_rows += 1

    # Re-sort and renumber so display_order is clean integers
    _renumber_display_order(master_rows)

    extra = len(master_rows) - master_count
    logger.info(
        "Master presentation: %d rows from 10-K, "
        "%d local-name, %d label, %d AI matches, %d new rows = %d total, "
        "%d concept mappings",
        master_count, matched_local, matched_label, matched_ai, new_rows,
        len(master_rows), len(concept_map),
    )
    return master_rows, concept_map

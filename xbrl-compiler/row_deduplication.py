"""Post-build duplicate canonical-row merge.

After consolidation + coverage + final raw reconcile, two *different* QNames can
still resolve to the same economics: overlapping XBRL tags (e.g. generic
``MarketableSecurities`` vs ``MarketableSecuritiesNoncurrent``) with identical
values. We merge those into one **canonical row** (keep the more specific
identifier) and remap ``concept_map`` so downstream exports stay consistent.

Conservative rules (all must hold):
  * same ``statement_type``, ``depth``, and **non-empty** value signature;
  * pair allowed by **local-name prefix**, **identical normalized label** + invest/security
    gate, or **strict word-subset** labels with that gate — mirroring the
    frontend BS dedupe philosophy.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field

from consolidator import ConsolidatedData, AuditEntry
from master_presentation_builder import (
    ConceptMapping,
    MasterRow,
    _extract_local_name,
    _labels_similar_for_merge,
    _normalize_label,
    _renumber_display_order,
)

logger = logging.getLogger(__name__)

_LABEL_STOPWORDS = frozenset({
    "a", "an", "and", "at", "for", "in", "less", "net", "of", "on", "or",
    "the", "to", "total",
})


def _concept_local_norm(concept: str) -> str:
    loc = _extract_local_name(concept)
    return re.sub(r"[^a-zA-Z0-9]", "", loc).lower()


def _label_tokens_fixed(label: str) -> frozenset[str]:
    t = re.sub(r"[^a-z0-9\s]", " ", label.lower())
    return frozenset(w for w in t.split() if w and w not in _LABEL_STOPWORDS)


def _norm_display_label(label: str) -> str:
    return re.sub(r"\s+", " ", _normalize_label(label)).strip()


def _investing_or_security_line(label: str, concept: str) -> bool:
    hay = f"{label} {_extract_local_name(concept)}"
    return bool(re.search(r"invest|securit", hay, re.I))


def _strict_subset_words(a: frozenset[str], b: frozenset[str]) -> bool:
    if len(a) >= len(b):
        return False
    return a.issubset(b)


def _value_signature(
    data: ConsolidatedData,
    st: str,
    crid: str,
) -> str | None:
    cells = data.get(st, {}).get(crid, {})
    if not cells:
        return None
    parts: list[str] = []
    for pl in sorted(cells.keys()):
        v = cells[pl]
        if v is None:
            continue
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        parts.append(f"{pl}={round(fv, 6)}")
    if not parts:
        return None
    return "|".join(parts)


def _row_by_canon(master_rows: list[MasterRow]) -> dict[tuple[str, str], MasterRow]:
    return {(r.statement_type, r.canonical_row_id): r for r in master_rows}


def _merge_pair_allowed(
    st: str,
    ca: str,
    cb: str,
    row_a: MasterRow,
    row_b: MasterRow,
) -> bool:
    if row_a.depth != row_b.depth:
        return False

    la, lb = row_a.display_label or "", row_b.display_label or ""
    na, nb = _concept_local_norm(ca), _concept_local_norm(cb)

    if na == nb:
        return True

    # Prefix extension (e.g. MarketableSecurities vs MarketableSecuritiesNoncurrent)
    shorter, longer = (na, nb) if len(na) <= len(nb) else (nb, na)
    if len(shorter) >= 8 and longer.startswith(shorter):
        if st == "balance_sheet":
            return _investing_or_security_line(la, ca) or _investing_or_security_line(lb, cb)
        return len(shorter) >= 10

    if _norm_display_label(la) == _norm_display_label(lb) and _norm_display_label(la):
        return True

    if st in ("income_statement", "cash_flow") and _labels_similar_for_merge(la, lb):
        return True

    inv_a = _investing_or_security_line(la, ca)
    inv_b = _investing_or_security_line(lb, cb)
    if not (inv_a and inv_b):
        return False

    ta, tb = _label_tokens_fixed(la), _label_tokens_fixed(lb)
    if _strict_subset_words(ta, tb) or _strict_subset_words(tb, ta):
        return True

    return False


def _pick_representative(canon_ids: list[str]) -> str:
    def score(c: str) -> tuple[int, int, int, str]:
        n = _concept_local_norm(c)
        gaap = 1 if c.startswith("us-gaap:") else 0
        return (len(n), gaap, -len(c), c)

    return max(canon_ids, key=score)


@dataclass
class RowDedupResult:
    changed: bool = False
    components_merged: int = 0
    rows_removed: int = 0
    detail: list[dict] = field(default_factory=list)


def apply_row_deduplication(
    consolidated: ConsolidatedData,
    master_rows: list[MasterRow],
    concept_map: list[ConceptMapping],
    audit_entries: list[AuditEntry],
) -> RowDedupResult:
    """
    Merge duplicate canonical rows in-place. Safe to call multiple times;
    converges when no merge pairs remain.
    """
    res = RowDedupResult()
    rowmap = _row_by_canon(master_rows)

    # Group (st canonical_id) by (st, depth, signature)
    buckets: dict[tuple[str, int, str], list[str]] = defaultdict(list)
    for r in master_rows:
        sig = _value_signature(consolidated, r.statement_type, r.canonical_row_id)
        if sig is None:
            continue
        buckets[(r.statement_type, r.depth, sig)].append(r.canonical_row_id)

    # Union-find within each bucket
    merges: list[tuple[str, str, str, str]] = []  # st, keep, drop, reason

    for (st, depth, sig), canon_list in buckets.items():
        if len(canon_list) < 2:
            continue
        uniq = sorted(set(canon_list))
        parent = {c: c for c in uniq}

        def find(x: str) -> str:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(x: str, y: str) -> None:
            rx, ry = find(x), find(y)
            if rx == ry:
                return
            keeper = _pick_representative([rx, ry])
            if keeper == rx:
                parent[ry] = keeper
            else:
                parent[rx] = keeper

        for i, ca in enumerate(uniq):
            ra = rowmap.get((st, ca))
            if ra is None:
                continue
            for cb in uniq[i + 1 :]:
                rb = rowmap.get((st, cb))
                if rb is None:
                    continue
                if _merge_pair_allowed(st, ca, cb, ra, rb):
                    union(ca, cb)

        roots: dict[str, list[str]] = defaultdict(list)
        for c in uniq:
            roots[find(c)].append(c)

        for root, comp in roots.items():
            if len(comp) < 2:
                continue
            keep = _pick_representative(comp)
            for drop in comp:
                if drop == keep:
                    continue
                merges.append((st, keep, drop, "value_signature_equivalence"))

    # Label-similar IS/CF rows where one side has no values (wording drift, sparse filings)
    by_label: dict[tuple[str, int], list[str]] = defaultdict(list)
    for r in master_rows:
        if r.statement_type not in ("income_statement", "cash_flow"):
            continue
        by_label[(r.statement_type, r.depth)].append(r.canonical_row_id)

    for (st, depth), canon_list in by_label.items():
        uniq = sorted(set(canon_list))
        for i, ca in enumerate(uniq):
            ra = rowmap.get((st, ca))
            if ra is None:
                continue
            for cb in uniq[i + 1 :]:
                rb = rowmap.get((st, cb))
                if rb is None:
                    continue
                if not _merge_pair_allowed(st, ca, cb, ra, rb):
                    continue
                sig_a = _value_signature(consolidated, st, ca)
                sig_b = _value_signature(consolidated, st, cb)
                if sig_a and sig_b:
                    continue
                if sig_a is None and sig_b is None:
                    keep = _pick_representative([ca, cb])
                    drop = cb if keep == ca else ca
                    merges.append((st, keep, drop, "similar_label_empty"))
                    continue
                if sig_a and sig_b:
                    continue
                keep, drop = (ca, cb) if sig_a else (cb, ca)
                merges.append((st, keep, drop, "similar_label_sparse"))

    if not merges:
        return res

    # Apply merges: redirect drops → keep
    seen_drop: set[tuple[str, str]] = set()
    for st, keep, drop, reason in merges:
        key = (st, drop)
        if key in seen_drop:
            continue
        seen_drop.add(key)
        if keep == drop:
            continue
        if (st, keep) not in rowmap:
            continue
        if (st, drop) not in rowmap:
            continue

        # Merge consolidated cells
        if st in consolidated and drop in consolidated[st]:
            src = consolidated[st].pop(drop, None)
            if src:
                consolidated.setdefault(st, {}).setdefault(keep, {})
                tgt = consolidated[st][keep]
                for pl, val in src.items():
                    if tgt.get(pl) is None and val is not None:
                        tgt[pl] = val

        # Remap concept_map
        for m in concept_map:
            if m.statement_type == st and m.canonical_row_id == drop:
                m.canonical_row_id = keep
                m.notes = f"{m.notes}; dedup_merged_into:{keep}:{reason}"

        master_rows[:] = [
            r for r in master_rows
            if not (r.statement_type == st and r.canonical_row_id == drop)
        ]
        rowmap = _row_by_canon(master_rows)

        keep_row = rowmap.get((st, keep))
        dl = keep_row.display_label if keep_row else keep
        audit_entries.append(
            AuditEntry(
                statement_type=st,
                canonical_row_id=keep,
                master_display_label=dl,
                output_period="",
                value=None,
                source_file="",
                source_sheet="",
                source_column="",
                raw_line_label="",
                raw_concept=drop,
                source_method="row_deduplication",
                derivation_formula=f"Merged duplicate canonical row {drop} → {keep} ({reason})",
            )
        )

        res.rows_removed += 1
        res.detail.append({
            "statement_type": st,
            "keep": keep,
            "drop": drop,
            "reason": reason,
        })

    _renumber_display_order(master_rows)
    res.changed = True
    res.components_merged = len(seen_drop)
    logger.info(
        "Row deduplication: merged %d duplicate canonical rows into keepers",
        res.rows_removed,
    )
    return res

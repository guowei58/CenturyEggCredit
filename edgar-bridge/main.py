"""
Local SEC bridge using dgunning/edgartools (Python).
SEC requires a descriptive User-Agent with contact — set EDGAR_IDENTITY.

Run:
  pip install -r requirements.txt
  set EDGAR_IDENTITY=Your Name you@company.com
  uvicorn main:app --host 127.0.0.1 --port 8765
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="CenturyEggCredit Edgar Bridge", version="1.0.0")

_cors = os.getenv("EDGAR_BRIDGE_CORS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_identity() -> None:
    ident = (os.getenv("EDGAR_IDENTITY") or "").strip()
    if not ident:
        raise HTTPException(
            status_code=503,
            detail="Set EDGAR_IDENTITY to 'Your Name email@domain' (SEC policy).",
        )
    from edgar import set_identity

    set_identity(ident)


def normalize_accession(raw: str) -> str:
    s = raw.replace("-", "").strip()
    if not re.fullmatch(r"\d{18}", s):
        raise HTTPException(
            status_code=400,
            detail="accession must be 18 digits (with or without dashes), e.g. 0000320193-23-000106",
        )
    return f"{s[:10]}-{s[10:12]}-{s[12:]}"


def _df_to_records(df: Any, limit: int) -> tuple[list[dict[str, Any]], bool]:
    import pandas as pd

    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return [], False
    truncated = len(df) > limit
    chunk = df.head(limit)
    raw = chunk.to_json(orient="records", date_format="iso", default_handler=str)
    return json.loads(raw), truncated


def _coerce_statement_dataframe(method: Any) -> Any:
    """EdgarTools returns a DataFrame or a Statement-like object with .to_dataframe()."""
    import pandas as pd

    if not callable(method):
        return None
    try:
        raw = method()
    except Exception:  # noqa: BLE001
        return None
    if raw is None:
        return None
    if isinstance(raw, pd.DataFrame):
        return raw if not raw.empty else None
    to_df = getattr(raw, "to_dataframe", None)
    if callable(to_df):
        try:
            df = to_df()
            if isinstance(df, pd.DataFrame) and not df.empty:
                return df
        except Exception:  # noqa: BLE001
            return None
    return None


def _dataframe_to_markdown(df: Any) -> str | None:
    try:
        return df.to_markdown(index=False)
    except Exception:  # noqa: BLE001
        try:
            return str(df)
        except Exception:  # noqa: BLE001
            return None


def _extract_xbrl_bundle(filing: Any, facts_max: int) -> dict[str, Any]:
    out: dict[str, Any] = {
        "available": False,
        "facts": [],
        "factsTruncated": False,
        "statements": {},
        "statementRecords": {},
        "rawInstanceUrls": [],
        "error": None,
    }
    try:
        xbrl = filing.xbrl()
    except Exception as e:  # noqa: BLE001
        out["error"] = f"xbrl(): {e!s}"
        return out

    if xbrl is None:
        out["error"] = "No inline XBRL / XBRL package for this filing."
        return out

    out["available"] = True

    # Financial statements: API returns Statement objects — must use .to_dataframe().
    statements_obj = getattr(xbrl, "statements", None)
    if statements_obj is not None:
        stm_md: dict[str, str] = {}
        stm_recs: dict[str, list[dict[str, Any]]] = {}
        for key, meth_names in (
            ("incomeStatement", ("income_statement",)),
            ("balanceSheet", ("balance_sheet",)),
            ("cashFlowStatement", ("cash_flow_statement", "cashflow_statement")),
        ):
            df = None
            for m in meth_names:
                fn = getattr(statements_obj, m, None)
                if not callable(fn):
                    continue
                df = _coerce_statement_dataframe(fn)
                if df is not None:
                    break
            if df is None:
                continue
            md = _dataframe_to_markdown(df)
            if md:
                stm_md[key] = md
            recs, _trunc = _df_to_records(df, 100_000)
            if recs:
                stm_recs[key] = recs
        out["statements"] = stm_md
        out["statementRecords"] = stm_recs

    # Fact grid (structure varies by edgartools version)
    facts_df = None
    inst = getattr(xbrl, "instance", None)
    if inst is not None:
        facts_df = getattr(inst, "facts", None)
        if facts_df is None and callable(getattr(inst, "to_dataframe", None)):
            try:
                facts_df = inst.to_dataframe()
            except Exception:  # noqa: BLE001
                facts_df = None
    if facts_df is None:
        facts_df = getattr(xbrl, "facts", None)

    if facts_df is not None:
        recs, trunc = _df_to_records(facts_df, facts_max)
        out["facts"] = recs
        out["factsTruncated"] = trunc

    if not out["facts"] and inst is not None:
        qf = getattr(inst, "query_facts", None)
        if callable(qf):
            try:
                qdf = qf()
                if qdf is not None:
                    recs, trunc = _df_to_records(qdf, facts_max)
                    if recs:
                        out["facts"] = recs
                        out["factsTruncated"] = trunc
            except Exception:  # noqa: BLE001
                pass

    # Optional: attachment hints for raw .htm / .xml in filing
    try:
        atts = getattr(filing, "attachments", None)
        if atts is not None:
            urls: list[str] = []
            for a in atts:
                if len(urls) >= 80:
                    break
                url = getattr(a, "url", None) or getattr(a, "document_url", None)
                doc = (getattr(a, "document", None) or "") or ""
                if url and (
                    doc.lower().endswith((".xml", ".xbrl", ".htm", ".html")) or "xbrl" in doc.lower()
                ):
                    urls.append(str(url))
            out["rawInstanceUrls"] = urls[:40]
    except Exception:  # noqa: BLE001
        pass

    return out


@app.get("/health")
def health() -> dict[str, bool | str]:
    ident_ok = bool((os.getenv("EDGAR_IDENTITY") or "").strip())
    return {"status": "ok" if ident_ok else "misconfigured", "edgarIdentitySet": ident_ok}


@app.get("/company/{ticker}/filings")
def company_filings(
    ticker: str,
    limit: int = Query(50, ge=1, le=120),
    form: str | None = Query(None, description="Optional SEC form filter, e.g. 10-K"),
) -> dict[str, Any]:
    _require_identity()
    from edgar import Company

    tk = ticker.strip().upper()
    if not tk:
        raise HTTPException(status_code=400, detail="ticker required")

    company = Company(tk)
    try:
        coll = company.get_filings(form=form) if form else company.get_filings()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"get_filings failed: {e!s}") from e

    def accession_for_json(fobj: Any) -> str:
        """Always a JSON string — numeric accessions exceed JS safe integer and break the bundle request."""
        raw = getattr(fobj, "accession_no", None) or getattr(fobj, "accession_number", None)
        if raw is None:
            return ""
        return str(raw).strip()

    rows: list[dict[str, Any]] = []
    try:
        seq = coll.head(limit) if hasattr(coll, "head") else coll
        for f in seq:
            rows.append(
                {
                    "accessionNumber": accession_for_json(f),
                    "form": getattr(f, "form", None),
                    "filingDate": getattr(f, "filing_date", None),
                    "description": getattr(f, "primary_doc_description", None)
                    or getattr(f, "description", None)
                    or "",
                    "secHomeUrl": getattr(f, "homepage_url", None),
                    "primaryDocUrl": getattr(f, "filing_url", None),
                }
            )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"iterate filings: {e!s}") from e

    cik = getattr(company, "cik", None)
    return {
        "ticker": tk,
        "companyName": getattr(company, "name", None) or str(company),
        "cik": str(cik) if cik is not None else None,
        "filings": rows,
    }


@app.get("/filing/bundle")
def filing_bundle(
    accession: str = Query(..., min_length=10),
    html_max: int = Query(1_500_000, ge=10_000, le=6_000_000),
    facts_max: int = Query(4_000, ge=100, le=25_000),
) -> dict[str, Any]:
    _require_identity()
    from edgar import get_by_accession_number

    acc = normalize_accession(accession)
    try:
        filing = get_by_accession_number(acc)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"Filing not found: {e!s}") from e

    html: str | None = None
    html_truncated = False
    try:
        html = filing.html()
    except Exception as e:  # noqa: BLE001
        html = None
        html_err = str(e)
    else:
        html_err = None

    if html is not None and len(html) > html_max:
        html = html[:html_max]
        html_truncated = True

    xbrl_payload = _extract_xbrl_bundle(filing, facts_max)

    return {
        "ok": True,
        "accessionNumber": acc,
        "form": getattr(filing, "form", None),
        "filingDate": getattr(filing, "filing_date", None),
        "company": getattr(filing, "company", None),
        "cik": getattr(filing, "cik", None),
        "secHomeUrl": getattr(filing, "homepage_url", None),
        "primaryDocUrl": getattr(filing, "filing_url", None),
        "html": html,
        "htmlTruncated": html_truncated,
        "htmlChars": len(html or ""),
        "htmlError": html_err,
        "xbrl": xbrl_payload,
    }

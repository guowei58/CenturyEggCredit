from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def build_steps(kind: str, state_name: str, primary: str, secondary: str) -> list[dict]:
    if kind == "courts_judgments":
        step1 = "State court case search"
        hint1 = f"Search {state_name} court dockets, civil cases, judgments, and filings by party name when available."
        step2 = "DOJ state court directory"
        hint2 = "Fallback directory of court systems and resources when the primary portal is limited."
    elif kind == "licenses_regulatory":
        step1 = "State licensing / regulatory search"
        hint1 = f"Search {state_name} professional / business license registries and regulatory actions where available."
        step2 = "National licensure directory"
        hint2 = "Directory of state professional licensing resources and links."
    elif kind == "procurement_contracts":
        step1 = "State procurement / bids portal"
        hint1 = f"Search {state_name} solicitations, RFPs, awards, vendor registrations, and contract notices where available."
        step2 = "NASPO procurement directory"
        hint2 = "Directory of state procurement sites and resources."
    else:
        step1 = "Primary source"
        hint1 = f"Primary portal for {state_name}."
        step2 = "Directory / secondary source"
        hint2 = "Secondary directory of sources."

    return [
        {"step": 1, "label": step1, "hint": hint1, "url": primary},
        {"step": 2, "label": step2, "hint": hint2, "url": secondary},
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", required=True, choices=["courts_judgments", "licenses_regulatory", "procurement_contracts"])
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    df = pd.read_excel(args.xlsx)
    required = {"State", "Abbrev", "Primary_State_URL", "Secondary_or_Directory_URL"}
    missing = required - set(df.columns)
    if missing:
        raise SystemExit(f"Missing columns {sorted(missing)} in {args.xlsx}. Found: {list(df.columns)}")

    out: dict[str, dict] = {}
    for _, row in df.iterrows():
        state = str(row["State"]).strip()
        abbr = str(row["Abbrev"]).strip().upper()
        primary = str(row["Primary_State_URL"]).strip()
        secondary = str(row["Secondary_or_Directory_URL"]).strip()
        out[abbr] = {
            "stateName": state,
            "primaryUrl": primary,
            "secondaryUrl": secondary,
            "steps": build_steps(args.kind, state, primary, secondary),
        }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"Wrote {len(out)} states to {out_path}")


if __name__ == "__main__":
    main()


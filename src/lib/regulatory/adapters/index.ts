import type { RegulatoryAgencyAdapter } from "@/lib/regulatory/types";
import { federalRegisterAdapter } from "@/lib/regulatory/adapters/federalRegister";
import { openFdaAdapter } from "@/lib/regulatory/adapters/openFda";
import { usaspendingAdapter } from "@/lib/regulatory/adapters/usaspending";
import { nhtsaAdapter } from "@/lib/regulatory/adapters/nhtsa";
import { cfpbComplaintsAdapter } from "@/lib/regulatory/adapters/cfpbComplaints";
import { fdicBankfindAdapter } from "@/lib/regulatory/adapters/fdicBankfind";
import { occInstitutionDataAdapter } from "@/lib/regulatory/adapters/occInstitutionData";
import { ffiecCdrAdapter } from "@/lib/regulatory/adapters/ffiecCdr";
import { cmsDataAdapter } from "@/lib/regulatory/adapters/cmsData";
import { oshaAdapter } from "@/lib/regulatory/adapters/osha";
import { ofacAdapter } from "@/lib/regulatory/adapters/ofac";
import { phmsaAdapter } from "@/lib/regulatory/adapters/phmsa";
import { fercAdapter } from "@/lib/regulatory/adapters/ferc";
import { regulationsGovAdapter } from "@/lib/regulatory/adapters/regulationsGov";
import { fecOpenFecAdapter } from "@/lib/regulatory/adapters/fecOpenFec";
import { ecfrAdapter } from "@/lib/regulatory/adapters/ecfr";
import { epaEchoAdapter } from "@/lib/regulatory/adapters/epaEcho";
import { epaEnvirofactsAdapter } from "@/lib/regulatory/adapters/epaEnvirofacts";
import { eiaAdapter } from "@/lib/regulatory/adapters/eia";
import { samGovAdapter } from "@/lib/regulatory/adapters/samGov";
import { litigationAdapter } from "@/lib/regulatory/adapters/litigation";
import { enforcementsAdapter } from "@/lib/regulatory/adapters/enforcements";
import { manualOnlyAdapter } from "@/lib/regulatory/adapters/manualOnly";

const ADAPTERS: RegulatoryAgencyAdapter[] = [
  federalRegisterAdapter,
  openFdaAdapter,
  usaspendingAdapter,
  nhtsaAdapter,
  cfpbComplaintsAdapter,
  fdicBankfindAdapter,
  occInstitutionDataAdapter,
  ffiecCdrAdapter,
  cmsDataAdapter,
  oshaAdapter,
  ofacAdapter,
  phmsaAdapter,
  fercAdapter,
  regulationsGovAdapter,
  fecOpenFecAdapter,
  ecfrAdapter,
  epaEchoAdapter,
  epaEnvirofactsAdapter,
  eiaAdapter,
  samGovAdapter,
  litigationAdapter,
  enforcementsAdapter,
  // everything else falls back to manual-only until implemented
];

export function getRegulatoryAdapter(sourceId: string): RegulatoryAgencyAdapter {
  return ADAPTERS.find((a) => a.sourceId === sourceId) ?? manualOnlyAdapter(sourceId);
}


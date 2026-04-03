/**
 * Credit-focused org chart model. Used by extraction pipeline and UI.
 * Ticker-agnostic; no company-specific fields.
 */

export type OrgChartEntityRole =
  | "parent"
  | "issuer"
  | "borrower"
  | "guarantor"
  | "non-guarantor"
  | "restricted-subsidiary"
  | "unrestricted-subsidiary"
  | "operating-subsidiary"
  | "foreign-subsidiary";

export type OrgChartEntity = {
  id: string;
  name: string;
  roles: OrgChartEntityRole[];
  debtInstrument?: string;
  children?: OrgChartEntity[];
  isBucket?: boolean;
  confidence?: "confirmed" | "likely" | "unclear";
};

export type OrgChartData = {
  ticker: string;
  companyName: string;
  sourceNote: string;
  root: OrgChartEntity;
  structuralNotes: string[];
  partial?: boolean;
};

export type OrgChartApiResponse =
  | { ok: true; data: OrgChartData }
  | { ok: false; insufficient: true; message: string }
  | { ok: false; error: string };

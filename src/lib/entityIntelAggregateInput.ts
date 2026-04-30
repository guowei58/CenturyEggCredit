import { prisma } from "@/lib/prisma";
import type { EntityIntelProfileInput } from "@/lib/generateEntitySearchTasks";
import { parseCustomEntityRegistryEntries } from "@/lib/entityCustomRegistry";

/** Merge saved entity-intelligence profile with public-records diligence profile for generators. */
export async function buildEntityIntelProfileInput(userId: string, ticker: string): Promise<{
  input: EntityIntelProfileInput;
  customSourcesReturn: ReturnType<typeof parseCustomEntityRegistryEntries>;
}> {
  const [eip, pub] = await Promise.all([
    prisma.entityIntelligenceProfile.findUnique({ where: { userId_ticker: { userId, ticker } } }),
    prisma.publicRecordsProfile.findUnique({ where: { userId_ticker: { userId, ticker } } }),
  ]);

  const customSources = parseCustomEntityRegistryEntries(eip?.customSourceRegistryEntries ?? null);

  let majorFacility: string[] = eip?.majorFacilityAddresses ?? [];
  if ((!majorFacility || majorFacility.length === 0) && pub?.majorFacilityLocations != null) {
    try {
      const raw = pub.majorFacilityLocations as unknown;
      if (Array.isArray(raw)) {
        majorFacility = raw.filter((x): x is string => typeof x === "string").slice(0, 200);
      } else if (typeof raw === "object" && raw !== null && "addresses" in (raw as object)) {
        const a = (raw as { addresses?: unknown }).addresses;
        if (Array.isArray(a)) majorFacility = a.filter((x): x is string => typeof x === "string");
      }
    } catch {
      majorFacility = [];
    }
  }

  const hqAddress =
    eip?.hqAddress ??
    ([pub?.hqCity, pub?.hqState].filter(Boolean).join(", ").trim() || null);

  const majorOp = eip?.majorOperatingStates?.length
    ? eip.majorOperatingStates
    : (([pub?.hqState].filter(Boolean) as string[]) ?? []);

  const input: EntityIntelProfileInput = {
    ticker,
    companyName: eip?.companyName ?? pub?.companyName,
    publicRegistrantName: eip?.publicRegistrantName ?? pub?.legalNames?.[0] ?? pub?.companyName,
    stateOfIncorporation: eip?.stateOfIncorporation ?? pub?.stateOfIncorporation,
    hqState: eip?.hqState ?? pub?.hqState,
    hqCity: eip?.hqCity ?? pub?.hqCity,
    hqAddress,
    principalExecutiveOfficeAddress: eip?.principalExecutiveOfficeAddress ?? pub?.principalExecutiveOfficeAddress,
    majorOperatingStates: majorOp,
    majorFacilityAddresses: majorFacility,
    subsidiaryNames: pub?.subsidiaryNames ?? [],
    subsidiaryDomiciles: pub?.subsidiaryDomiciles ?? [],
    borrowerNames: pub?.borrowerNames ?? [],
    guarantorNames: pub?.guarantorNames ?? [],
    issuerNames: pub?.issuerNames ?? [],
    dbaNames: pub?.dbaNames ?? [],
    formerNames: pub?.formerNames ?? [],
    restrictedSubsidiaryNames: pub?.restrictedSubsidiaryNames ?? [],
    unrestrictedSubsidiaryNames: pub?.unrestrictedSubsidiaryNames ?? [],
  };

  return { input, customSourcesReturn: customSources };
}

import { prisma } from "@/lib/prisma";

const ROW_ID = 1;

export type SharedHistoricalFinancialsTemplateMeta = {
  filename: string;
  updatedAt: string;
  bytes: number;
  updatedByUserId: string | null;
};

export async function getSharedHistoricalFinancialsTemplateMeta(): Promise<SharedHistoricalFinancialsTemplateMeta | null> {
  const row = await prisma.appSharedHistoricalFinancialsTemplate.findUnique({
    where: { id: ROW_ID },
    select: { filename: true, updatedAt: true, body: true, updatedByUserId: true },
  });
  if (!row || !row.body?.length) return null;
  return {
    filename: row.filename,
    updatedAt: row.updatedAt.toISOString(),
    bytes: row.body.length,
    updatedByUserId: row.updatedByUserId,
  };
}

export async function getSharedHistoricalFinancialsTemplateBuffer(): Promise<Buffer | null> {
  const row = await prisma.appSharedHistoricalFinancialsTemplate.findUnique({
    where: { id: ROW_ID },
    select: { body: true },
  });
  if (!row?.body?.length) return null;
  return Buffer.from(row.body);
}

export async function upsertSharedHistoricalFinancialsTemplate(params: {
  filename: string;
  body: Buffer;
  updatedByUserId: string;
}): Promise<void> {
  await prisma.appSharedHistoricalFinancialsTemplate.upsert({
    where: { id: ROW_ID },
    create: {
      id: ROW_ID,
      filename: params.filename,
      body: new Uint8Array(params.body),
      updatedByUserId: params.updatedByUserId,
    },
    update: {
      filename: params.filename,
      body: new Uint8Array(params.body),
      updatedByUserId: params.updatedByUserId,
    },
  });
}

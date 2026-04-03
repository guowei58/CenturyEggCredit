/** Postgres workspace row for account-wide blobs (not tied to one ticker). */
export const WORKSPACE_GLOBAL_TICKER = "__global__";

/** Client sends this as folderPath; server materializes DB files to OS temp for ingest. */
export const USER_WORKSPACE_INGEST_SENTINEL = "__USER_WORKSPACE_V1__";

export const MAX_WORKSPACE_FILE_BYTES = 100 * 1024 * 1024;

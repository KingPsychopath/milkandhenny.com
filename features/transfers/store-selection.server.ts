/** The catalogue and media queue must switch as one authority. */
export function postgresTransferCatalogueSelected(): boolean {
  if (process.env.TRANSFER_CATALOGUE_STORE !== "postgres") return false;
  if (process.env.TRANSFER_MEDIA_JOB_STORE !== "postgres")
    throw new Error("Postgres transfer catalogue requires Postgres media jobs");
  return true;
}

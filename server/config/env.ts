import dotenv from "dotenv";

// Imported first by server.ts and scripts, so every module sees the same
// environment no matter which one happens to read process.env first.
dotenv.config({ quiet: true });

/**
 * Without DATABASE_URL, fall back to a local PostgreSQL built from the DB_*
 * variables. The defaults match the `db` service in docker-compose.yml, so
 * `npm run db:local` followed by `npm run dev` needs no configuration.
 */
export function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return { url: process.env.DATABASE_URL, isFallback: false };
  const user = process.env.DB_USER || "postgres";
  const password = process.env.DB_PASSWORD || "postgres";
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "file_upload_db";
  const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}?schema=public`;
  process.env.DATABASE_URL = url;
  return { url, isFallback: true };
}

/** The connection string with the password masked, for logs. */
export function describeDatabaseUrl(url: string) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return `${u.protocol}//${u.username}${u.password ? ":***" : ""}@${u.host}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

export const database = resolveDatabaseUrl();

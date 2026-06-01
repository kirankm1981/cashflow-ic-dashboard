import dns from "dns";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

// On Windows + Node 17+, `localhost` often resolves to IPv6 (::1) first, but a
// default PostgreSQL install only listens on IPv4 (127.0.0.1). That mismatch
// causes intermittent ECONNREFUSED even when PostgreSQL is running. Force IPv4
// resolution first and normalize the host so existing .env files keep working.
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}

function normalizeDbHost(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/@localhost([:/])/i, "@127.0.0.1$1");
}

const pool = new pg.Pool({
  connectionString: normalizeDbHost(process.env.DATABASE_URL),
  max: 40,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  statement_timeout: 600000,
});

pool.on("error", (err) => {
  console.error("[DB Pool] Unexpected client error:", err.message);
});

export const db = drizzle(pool, { schema });
export { pool };

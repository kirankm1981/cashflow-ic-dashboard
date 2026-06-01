import dns from "dns";
import { defineConfig } from "drizzle-kit";

// Force IPv4-first DNS and rewrite `localhost` to 127.0.0.1 so `drizzle-kit push`
// reaches PostgreSQL on Windows, where `localhost` may resolve to IPv6 (::1).
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}
const databaseUrl = (process.env.DATABASE_URL ?? "").replace(
  /@localhost([:/])/i,
  "@127.0.0.1$1",
);

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});

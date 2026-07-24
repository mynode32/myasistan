// Loads env vars for the Prisma CLI (migrate, studio, db pull) — Next.js
// loads .env.local automatically for the app itself, but this config file
// runs outside Next.js, so it needs to load it explicitly.
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations need a non-pooled connection (PgBouncer transaction mode
    // doesn't support the prepared statements Prisma Migrate uses). The
    // app itself connects with the pooled DATABASE_URL via a driver
    // adapter instead — see src/lib/db/prisma.ts.
    url: process.env["DIRECT_URL"],
  },
});

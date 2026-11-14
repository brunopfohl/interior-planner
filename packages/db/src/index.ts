import { SQL } from "bun";

if (!Bun.env.PGPASSWORD) {
  throw new Error("PGPASSWORD is required");
}

export const db = new SQL({
  adapter: "postgres",
  hostname: Bun.env.PGHOST ?? "localhost",
  port: Number(Bun.env.PGPORT ?? 5432),
  database: Bun.env.PGDATABASE ?? "interior_planner",
  username: Bun.env.PGUSER ?? "interior_planner",
  password: Bun.env.PGPASSWORD,
  max: 5,
  connectionTimeout: 5,
});

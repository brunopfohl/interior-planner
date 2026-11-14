import { db } from "@interior-planner/db";
import homepage from "./index.html";

await db`SELECT 1`;

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(Bun.env.PORT ?? 3000),
  development: Bun.env.NODE_ENV !== "production",
  routes: {
    "/": homepage,
    "/health": async () => {
      try {
        await db`SELECT 1`;
        return Response.json({ status: "ok" });
      } catch {
        return Response.json({ status: "unavailable" }, { status: 503 });
      }
    },
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Interior Planner listening on ${server.url}`);

async function shutdown() {
  await server.stop(true);
  await db.close();
  process.exit(0);
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

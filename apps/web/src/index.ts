import { db } from "@interior-planner/db";
import homepage from "./index.html";
import { migrate } from "@interior-planner/db/schema";
import { handleApi } from "./api";

await db`SELECT 1`;
await migrate();

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(Bun.env.PORT ?? 3000),
  development: Bun.env.NODE_ENV !== "production",
  maxRequestBodySize: 9 * 1024 * 1024,
  routes: {
    "/": homepage,
    "/interiors/*": homepage,
    "/imports": homepage,
    "/imports/*": homepage,
    "/health": async () => {
      try {
        await db`SELECT 1`;
        return Response.json({ status: "ok" });
      } catch {
        return Response.json({ status: "unavailable" }, { status: 503 });
      }
    },
  },
  fetch(req) {
    if (new URL(req.url).pathname.startsWith("/api/")) return handleApi(req);
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

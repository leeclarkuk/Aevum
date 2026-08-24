import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();

serve({
  fetch: app.fetch,
  port: env.port,
  hostname: "0.0.0.0",
});

console.log(`Aevum API listening on http://127.0.0.1:${env.port}`);

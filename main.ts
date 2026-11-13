
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";

const app = new Hono();

// Serve built frontend files from the dist folder.
app.use("/*", serveStatic({ root: "./dist" }));

// Return index.html for frontend routes.
app.get("*", serveStatic({ path: "./dist/index.html" }));

serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: 8000,
});

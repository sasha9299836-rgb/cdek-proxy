import Fastify from "fastify";
import pino from "pino";
import { env } from "./config/env";
import { registerHealthRoutes } from "./routes/health";
import { registerCitiesRoutes } from "./routes/cities";
import { registerPvzRoutes } from "./routes/pvz";
import { registerShippingRoutes } from "./routes/shipping";
import { registerErrorHandler } from "./utils/errorHandler";

async function buildServer() {
  const app = Fastify({
    logger: pino({
      level: process.env.LOG_LEVEL || "info",
    }),
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  });

  app.options("*", async (_request, reply) => {
    reply.code(204).send();
  });

  registerErrorHandler(app);

  await registerHealthRoutes(app);
  await registerCitiesRoutes(app);
  await registerPvzRoutes(app);
  await registerShippingRoutes(app);

  return app;
}

async function start() {
  const app = await buildServer();
  await app.listen({
    port: env.port,
    host: "0.0.0.0",
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { env } from "./config/env";
import { registerHealthRoutes } from "./routes/health";
import { registerCitiesRoutes } from "./routes/cities";
import { registerPvzRoutes } from "./routes/pvz";
import { registerShippingRoutes } from "./routes/shipping";
import { registerAdminMediaRoutes } from "./routes/adminMedia";
import { registerAdminDraftPostRoutes } from "./routes/adminDraftPost";
import { registerAdminPostPhotoRoutes } from "./routes/adminPostPhoto";
import { registerAdminMeasurementPhotoRoutes } from "./routes/adminMeasurementPhoto";
import { registerAdminPostPublishRoutes } from "./routes/adminPostPublish";
import { registerAdminDefectPhotoRoutes } from "./routes/adminDefectPhoto";
import { registerAdminDefectVideoPresignRoutes } from "./routes/adminDefectVideoPresign";
import { registerAdminDefectVideoMultipartRoutes } from "./routes/adminDefectVideoMultipart";
import { registerAdminDefectVideoUploadRoutes } from "./routes/adminDefectVideoUpload";
import { registerErrorHandler } from "./utils/errorHandler";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "authorization, Authorization, x-client-info, apikey, content-type");
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  });

  app.options("*", async (request, reply) => {
    console.info(JSON.stringify({
      scope: "cdek-proxy",
      event: "cors_preflight",
      method: request.method,
      url: request.url,
      req_headers: request.headers["access-control-request-headers"] ?? null,
    }));
    reply.code(204).send();
  });

  registerErrorHandler(app);

  await app.register(multipart, {
    limits: {
      fileSize: Math.max(env.adminMainUploadMaxBytes, env.adminDefectVideoUploadMaxBytes),
      files: 1,
    },
  });

  await registerHealthRoutes(app);
  await registerCitiesRoutes(app);
  await registerPvzRoutes(app);
  await registerShippingRoutes(app);
  await registerAdminMediaRoutes(app);
  await registerAdminDraftPostRoutes(app);
  await registerAdminPostPhotoRoutes(app);
  await registerAdminMeasurementPhotoRoutes(app);
  await registerAdminPostPublishRoutes(app);
  await registerAdminDefectPhotoRoutes(app);
  await registerAdminDefectVideoPresignRoutes(app);
  await registerAdminDefectVideoMultipartRoutes(app);
  await registerAdminDefectVideoUploadRoutes(app);

  return app;
}

async function start() {
  const app = await buildServer();
  await app.listen({
    port: env.port,
    host: "0.0.0.0",
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

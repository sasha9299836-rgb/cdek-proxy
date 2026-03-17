import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HttpError } from "./httpError";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof HttpError) {
      request.log.warn({ err: error, details: error.details }, error.message);
      return reply.status(error.statusCode).send({
        ok: false,
        error: error.errorCode,
        message: error.message,
        details: error.details ?? null,
      });
    }

    const unhandled = error instanceof Error ? error : new Error(String(error));
    request.log.error({ err: unhandled }, "Unhandled error");
    return reply.status(500).send({
      ok: false,
      error: "INTERNAL_ERROR",
      message: "?????????? ?????? ???????",
    });
  });
}

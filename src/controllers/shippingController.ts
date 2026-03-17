import type { FastifyRequest } from "fastify";
import { env } from "../config/env";
import type { ShippingCreateInput, ShippingQuoteInput } from "../domain/orderBuilder";
import { parseOriginProfile } from "../domain/originProfiles";
import { HttpError } from "../utils/httpError";
import { createShipment, getShipmentStatus, quoteShipment } from "../services/shipmentService";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertNoForbiddenFields(
  body: Record<string, unknown>,
  forbiddenFields: string[],
  errorCode: string,
  message: string,
) {
  const found = forbiddenFields.find((field) => field in body);
  if (found) {
    throw new HttpError(400, errorCode, message, { field: found });
  }
}

export function validateQuoteBody(body: unknown): ShippingQuoteInput {
  if (!isObject(body)) {
    throw new HttpError(400, "INVALID_BODY", "Invalid JSON body");
  }

  assertNoForbiddenFields(
    body,
    ["from_location", "to_location", "packages", "tariff_code"],
    "RAW_PAYLOAD_NOT_ALLOWED",
    "Raw CDEK payload is not allowed for /api/shipping/quote",
  );

  if (!("receiverCityCode" in body) || body.receiverCityCode == null || body.receiverCityCode === "") {
    throw new HttpError(400, "RECEIVER_CITY_CODE_REQUIRED", "receiverCityCode is required");
  }

  if (!isObject(body.package)) {
    throw new HttpError(400, "PACKAGE_REQUIRED", "package is required");
  }

  return {
    originProfile: parseOriginProfile(body.originProfile, "ODN"),
    packagingPreset: body.packagingPreset as ShippingQuoteInput["packagingPreset"],
    receiverCityCode: body.receiverCityCode as string | number,
    package: body.package as ShippingQuoteInput["package"],
  };
}

export function validateCreateBody(body: unknown): ShippingCreateInput {
  if (!isObject(body)) {
    throw new HttpError(400, "INVALID_BODY", "Invalid JSON body");
  }

  assertNoForbiddenFields(
    body,
    ["type", "packages", "shipment_point", "delivery_point", "tariff_code"],
    "RAW_PAYLOAD_NOT_ALLOWED",
    "Raw CDEK payload is not allowed for /api/shipping/create",
  );

  if (!body.externalOrderId || typeof body.externalOrderId !== "string") {
    throw new HttpError(400, "EXTERNAL_ORDER_ID_REQUIRED", "externalOrderId is required");
  }

  if (!body.deliveryPoint || typeof body.deliveryPoint !== "string") {
    throw new HttpError(400, "DELIVERY_POINT_REQUIRED", "deliveryPoint is required");
  }

  if (!isObject(body.recipient)) {
    throw new HttpError(400, "RECIPIENT_REQUIRED", "recipient is required");
  }

  if (!body.recipient.name || !body.recipient.phone) {
    throw new HttpError(400, "RECIPIENT_REQUIRED", "recipient.name and recipient.phone are required");
  }

  if (!isObject(body.package)) {
    throw new HttpError(400, "PACKAGE_REQUIRED", "package is required");
  }

  return {
    originProfile: parseOriginProfile(body.originProfile, "ODN"),
    packagingPreset: body.packagingPreset as ShippingCreateInput["packagingPreset"],
    receiverCityCode: body.receiverCityCode as string | number | undefined,
    deliveryPoint: body.deliveryPoint as string,
    externalOrderId: body.externalOrderId as string,
    tariffCode: body.tariffCode as number | undefined,
    deliveryRecipientCost: body.deliveryRecipientCost as number | undefined,
    recipient: body.recipient as ShippingCreateInput["recipient"],
    package: body.package as ShippingCreateInput["package"],
    items: Array.isArray(body.items) ? (body.items as ShippingCreateInput["items"]) : undefined,
  };
}

export async function quoteHandler(request: FastifyRequest) {
  const payload = validateQuoteBody(request.body);
  return quoteShipment(env, payload);
}

export async function createHandler(request: FastifyRequest) {
  const payload = validateCreateBody(request.body);
  return createShipment(env, payload);
}

export async function statusHandler(
  request: FastifyRequest<{ Params: { uuid: string }; Querystring: { originProfile?: string } }>,
) {
  const uuid = String(request.params.uuid ?? "").trim();
  if (!uuid) {
    throw new HttpError(400, "UUID_REQUIRED", "uuid is required");
  }

  const originProfile = parseOriginProfile(request.query.originProfile);
  return getShipmentStatus(env, uuid, originProfile);
}

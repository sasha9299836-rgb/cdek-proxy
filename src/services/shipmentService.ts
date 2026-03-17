import type { AppConfig, OriginProfileCode } from "../config/env";
import type { ShippingCreateInput, ShippingQuoteInput } from "../domain/orderBuilder";
import { buildCreateOrderPayload } from "../domain/orderBuilder";
import { getOriginProfile } from "../domain/originProfiles";
import { HttpError } from "../utils/httpError";
import { cdekGet, cdekPost } from "./cdekClient";
import { calculateSelectedTariff } from "./tariffService";

function logShipmentProxyEvent(event: string, data: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      scope: "cdek-proxy",
      event,
      ...data,
    }),
  );
}

function normalizeCdekOrderState(payload: Record<string, unknown> | null) {
  const entity = (payload?.entity ?? payload) as Record<string, unknown> | null;
  const statuses = Array.isArray(entity?.statuses) ? entity.statuses : [];
  const latestStatus = statuses.length ? statuses[statuses.length - 1] as Record<string, unknown> : null;
  const nestedStatus = entity?.status && typeof entity.status === "object"
    ? entity.status as Record<string, unknown>
    : null;

  const trackingStatus =
    typeof entity?.status === "string"
      ? entity.status
      : typeof nestedStatus?.code === "string"
        ? nestedStatus.code
        : typeof nestedStatus?.name === "string"
          ? nestedStatus.name
          : typeof latestStatus?.code === "string"
            ? latestStatus.code
            : typeof latestStatus?.name === "string"
              ? latestStatus.name
              : null;

  const cdekNumber =
    typeof entity?.cdek_number === "string"
      ? entity.cdek_number
      : typeof entity?.track === "string"
        ? entity.track
        : null;

  return {
    entity,
    trackingStatus,
    cdekNumber,
  };
}

export async function quoteShipment(config: AppConfig, input: ShippingQuoteInput) {
  const profile = getOriginProfile(config, input.originProfile ?? "ODN");
  const result = await calculateSelectedTariff(config, input, profile);
  logShipmentProxyEvent("shipping_quote_completed", {
    originProfile: profile.id,
    receiverCityCode: input.receiverCityCode,
    packagingPreset: input.packagingPreset ?? null,
    selectedTariffCode: result.selectedTariffCode,
  });

  return {
    ok: true,
    originProfile: profile.id,
    shipmentPoint: profile.shipmentPoint,
    selectedTariffCode: result.selectedTariffCode,
    selectedTariff: result.selectedTariff,
    availableTariffs: result.availableTariffs,
  };
}

export async function createShipment(config: AppConfig, input: ShippingCreateInput) {
  if (!input.deliveryPoint) {
    throw new HttpError(400, "DELIVERY_POINT_REQUIRED", "deliveryPoint is required");
  }
  if (!input.externalOrderId) {
    throw new HttpError(400, "EXTERNAL_ORDER_ID_REQUIRED", "externalOrderId is required");
  }
  if (!input.recipient?.name || !input.recipient?.phone) {
    throw new HttpError(400, "RECIPIENT_REQUIRED", "recipient.name and recipient.phone are required");
  }

  const profile = getOriginProfile(config, input.originProfile ?? "ODN");
  logShipmentProxyEvent("shipping_create_start", {
    externalOrderId: input.externalOrderId,
    origin_profile: profile.id,
    sender_name: profile.senderName,
    sender_phone: profile.senderPhone,
    shipment_point: profile.shipmentPoint,
    deliveryPoint: input.deliveryPoint,
    city_code: input.receiverCityCode ?? null,
    packaging_preset: input.packagingPreset ?? null,
    tariffCode: input.tariffCode ?? null,
  });

  let tariffCode = input.tariffCode;
  if (!tariffCode) {
    // When tariffCode is already fixed upstream, create must reuse it and skip recalculation.
    if (!input.receiverCityCode) {
      throw new HttpError(400, "RECEIVER_CITY_CODE_REQUIRED", "receiverCityCode is required when tariffCode is missing");
    }

    const quote = await calculateSelectedTariff(
      config,
      {
        originProfile: input.originProfile,
        packagingPreset: input.packagingPreset,
        receiverCityCode: input.receiverCityCode,
        package: input.package,
      },
      profile,
    );

    tariffCode = quote.selectedTariffCode;
  }

  const payload = buildCreateOrderPayload(input, profile, tariffCode);
  const response = await cdekPost<any>(config, profile.id, "/v2/orders", payload);
  const normalized = normalizeCdekOrderState(response);
  const entity = normalized.entity;
  logShipmentProxyEvent("shipping_create_completed", {
    externalOrderId: input.externalOrderId,
    originProfile: profile.id,
    deliveryPoint: input.deliveryPoint,
    selectedTariffCode: tariffCode,
    cdekUuid: entity?.uuid ?? null,
    cdekStatus: normalized.trackingStatus,
  });

  return {
    ok: true,
    originProfile: profile.id,
    shipmentPoint: profile.shipmentPoint,
    selectedTariffCode: tariffCode,
    uuid: entity?.uuid ?? null,
    cdekNumber: normalized.cdekNumber,
    trackingStatus: normalized.trackingStatus,
  };
}

export async function getShipmentStatus(config: AppConfig, uuid: string, originProfile: OriginProfileCode) {
  const response = await cdekGet<any>(config, originProfile, `/v2/orders/${encodeURIComponent(uuid)}`);
  const normalized = normalizeCdekOrderState(response);
  logShipmentProxyEvent("shipping_status_completed", {
    originProfile,
    cdekUuid: uuid,
    cdekStatus: normalized.trackingStatus,
    cdekNumber: normalized.cdekNumber,
  });

  return {
    ok: true,
    originProfile,
    uuid,
    status: response,
  };
}

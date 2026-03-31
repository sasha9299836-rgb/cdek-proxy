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

function getObjectKeys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : [];
}

function buildCdekRawOrderDebug(payload: Record<string, unknown> | null) {
  const entity = (payload?.entity ?? payload) as Record<string, unknown> | null;
  const requests = Array.isArray(entity?.requests) ? entity.requests : [];
  const statuses = Array.isArray(entity?.statuses) ? entity.statuses : [];
  const latestStatus = statuses.length ? statuses[statuses.length - 1] as Record<string, unknown> : null;

  return {
    topLevelKeys: getObjectKeys(payload),
    entityKeys: getObjectKeys(entity),
    requestsCount: requests.length,
    statusesCount: statuses.length,
    uuid: typeof entity?.uuid === "string" ? entity.uuid : null,
    order_uuid: typeof entity?.order_uuid === "string" ? entity.order_uuid : null,
    number: typeof entity?.number === "string" ? entity.number : null,
    cdek_number: entity?.cdek_number ?? null,
    track: entity?.track ?? null,
    tracking_number: entity?.tracking_number ?? null,
    status: entity?.status ?? null,
    latestStatusCode: latestStatus?.code ?? null,
    latestStatusName: latestStatus?.name ?? null,
    latestStatusDateTime: latestStatus?.date_time ?? null,
    rawEntity: entity,
  };
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

  const cdekNumber = normalizeTrackValue(entity?.cdek_number) ?? normalizeTrackValue(entity?.track);

  return {
    entity,
    trackingStatus,
    cdekNumber,
  };
}

export async function quoteShipment(config: AppConfig, input: ShippingQuoteInput) {
  const originalOriginProfile = input.originProfile ?? "ODN";
  const forcedOriginProfile = originalOriginProfile === "ODN" ? "MSK" : originalOriginProfile;
  if (forcedOriginProfile !== originalOriginProfile) {
    logShipmentProxyEvent("shipping_quote_origin_profile_override_for_test", {
      originalOriginProfile,
      forcedOriginProfile,
      receiverCityCode: input.receiverCityCode,
    });
  }
  const profile = getOriginProfile(config, forcedOriginProfile);
  const result = await calculateSelectedTariff(config, input, profile);
  logShipmentProxyEvent("shipping_quote_completed", {
    originProfile: originalOriginProfile,
    originProfileUsedForCdek: profile.id,
    receiverCityCode: input.receiverCityCode,
    packagingPreset: input.packagingPreset ?? null,
    selectedTariffCode: result.selectedTariffCode,
  });

  return {
    ok: true,
    originProfile: originalOriginProfile,
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

  const originalOriginProfile = input.originProfile ?? "ODN";
  const forcedOriginProfile = originalOriginProfile === "ODN" ? "MSK" : originalOriginProfile;
  if (forcedOriginProfile !== originalOriginProfile) {
    logShipmentProxyEvent("shipping_origin_profile_override_for_test", {
      originalOriginProfile,
      forcedOriginProfile,
      externalOrderId: input.externalOrderId,
    });
  }

  const profile = getOriginProfile(config, forcedOriginProfile);
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
  if (tariffCode != null) {
    logShipmentProxyEvent("tariff_forced_direct_usage", {
      externalOrderId: input.externalOrderId,
      originProfile: profile.id,
      tariffCode,
    });
  }

  if (tariffCode == null) {
    // When tariffCode is already fixed upstream, create must reuse it and skip recalculation.
    if (!input.receiverCityCode) {
      throw new HttpError(400, "RECEIVER_CITY_CODE_REQUIRED", "receiverCityCode is required when tariffCode is missing");
    }

    const quote = await calculateSelectedTariff(
      config,
      {
        originProfile: forcedOriginProfile,
        packagingPreset: input.packagingPreset,
        receiverCityCode: input.receiverCityCode,
        package: input.package,
      },
      profile,
    );

    tariffCode = quote.selectedTariffCode;
  }

  const payload = buildCreateOrderPayload(input, profile, tariffCode);
  console.log("CDEK CREATE ORDER PAYLOAD", JSON.stringify(payload, null, 2));
  const response = await cdekPost<any>(config, profile.id, "/v2/orders", payload);
  const normalized = normalizeCdekOrderState(response);
  const entity = normalized.entity;
  logShipmentProxyEvent("shipping_create_raw_response", {
    externalOrderId: input.externalOrderId,
    originProfile: profile.id,
    raw: buildCdekRawOrderDebug(response as Record<string, unknown> | null),
  });
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
  const originalOriginProfile = originProfile;
  const forcedOriginProfile = originalOriginProfile === "ODN" ? "MSK" : originalOriginProfile;
  if (forcedOriginProfile !== originalOriginProfile) {
    logShipmentProxyEvent("shipping_status_origin_profile_override_for_test", {
      originalOriginProfile,
      forcedOriginProfile,
      uuid,
    });
  }

  const response = await cdekGet<any>(config, forcedOriginProfile, `/v2/orders/${encodeURIComponent(uuid)}`);
  const normalized = normalizeCdekOrderState(response);
  logShipmentProxyEvent("shipping_status_raw_response", {
    originProfileRequested: originalOriginProfile,
    originProfileUsedForCdek: forcedOriginProfile,
    uuid,
    raw: buildCdekRawOrderDebug(response as Record<string, unknown> | null),
  });
  logShipmentProxyEvent("shipping_status_completed", {
    originProfile: originalOriginProfile,
    originProfileUsedForCdek: forcedOriginProfile,
    cdekUuid: uuid,
    cdekStatus: normalized.trackingStatus,
    cdekNumber: normalized.cdekNumber,
  });

  return {
    ok: true,
    originProfile: originalOriginProfile,
    uuid,
    status: response,
  };
}
  const normalizeTrackValue = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  };

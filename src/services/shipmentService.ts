import type { AppConfig, OriginProfileCode } from "../config/env";
import type { ShippingCreateInput, ShippingQuoteInput } from "../domain/orderBuilder";
import { buildCreateOrderPayload } from "../domain/orderBuilder";
import { getOriginProfile } from "../domain/originProfiles";
import { HttpError } from "../utils/httpError";
import { cdekGet, cdekPost } from "./cdekClient";
import { calculateSelectedTariff } from "./tariffService";

export async function quoteShipment(config: AppConfig, input: ShippingQuoteInput) {
  const profile = getOriginProfile(config, input.originProfile ?? "MSK");
  const result = await calculateSelectedTariff(config, input, profile);

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

  const profile = getOriginProfile(config, input.originProfile ?? "MSK");

  let tariffCode = input.tariffCode;
  if (!tariffCode) {
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
  const entity = response?.entity ?? response;

  return {
    ok: true,
    originProfile: profile.id,
    shipmentPoint: profile.shipmentPoint,
    selectedTariffCode: tariffCode,
    uuid: entity?.uuid ?? null,
    cdekNumber: entity?.cdek_number ?? null,
    trackingStatus: entity?.status ?? null,
  };
}

export async function getShipmentStatus(config: AppConfig, uuid: string, originProfile: OriginProfileCode) {
  const response = await cdekGet<any>(config, originProfile, `/v2/orders/${encodeURIComponent(uuid)}`);

  return {
    ok: true,
    originProfile,
    uuid,
    status: response,
  };
}

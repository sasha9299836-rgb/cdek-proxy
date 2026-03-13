import type { AppConfig, OriginProfileCode } from "../config/env";
import { HttpError } from "../utils/httpError";

export type OriginProfile = {
  id: OriginProfileCode;
  shipmentPoint: string;
  cityCode: number;
  cityName: string;
  preferredTariffs: number[];
  senderName: string;
  senderPhone: string;
  sellerName: string;
};

export function parseOriginProfile(value: unknown, fallback?: OriginProfileCode): OriginProfileCode {
  if (value == null || value === "") {
    if (fallback) {
      return fallback;
    }
    throw new HttpError(400, "INVALID_ORIGIN_PROFILE", "originProfile must be MSK or YAN");
  }

  if (value === "MSK" || value === "YAN") {
    return value;
  }

  throw new HttpError(400, "INVALID_ORIGIN_PROFILE", "originProfile must be MSK or YAN");
}

export function getOriginProfile(config: AppConfig, code: OriginProfileCode): OriginProfile {
  if (code === "MSK") {
    return {
      id: "MSK",
      shipmentPoint: config.odnShipmentPoint,
      cityCode: config.mskCityCode,
      cityName: "Одинцово",
      preferredTariffs: [234, 136],
      senderName: config.senderName,
      senderPhone: config.senderPhone,
      sellerName: config.sellerName,
    };
  }

  return {
    id: "YAN",
    shipmentPoint: config.yanShipmentPoint,
    cityCode: config.yanCityCode,
    cityName: "Янино-1",
    preferredTariffs: [234, 136],
    senderName: config.senderName,
    senderPhone: config.senderPhone,
    sellerName: config.sellerName,
  };
}

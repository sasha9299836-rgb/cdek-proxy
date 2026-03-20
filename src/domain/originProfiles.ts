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
    throw new HttpError(400, "INVALID_ORIGIN_PROFILE", "Неизвестный профиль отправки");
  }

  if (value === "ODN" || value === "YAN" || value === "MSK") {
    return value;
  }

  throw new HttpError(400, "INVALID_ORIGIN_PROFILE", "Неизвестный профиль отправки");
}

export function getOriginProfile(config: AppConfig, code: OriginProfileCode): OriginProfile {
  if (code === "ODN") {
    return {
      id: "ODN",
      shipmentPoint: config.odnShipmentPoint,
      cityCode: config.odnCityCode,
      cityName: "Одинцово",
      preferredTariffs: [234, 136],
      senderName: config.odnSenderName,
      senderPhone: config.odnSenderPhone,
      sellerName: config.sellerName,
    };
  }

  if (code === "MSK") {
    return {
      id: "MSK",
      shipmentPoint: config.odnShipmentPoint,
      cityCode: config.odnCityCode,
      cityName: "Москва",
      preferredTariffs: [234, 136],
      senderName: config.odnSenderName,
      senderPhone: config.odnSenderPhone,
      sellerName: config.sellerName,
    };
  }

  return {
    id: "YAN",
    shipmentPoint: config.yanShipmentPoint,
    cityCode: config.yanCityCode,
    cityName: "Янино-1",
    preferredTariffs: [234, 136],
    senderName: config.yanSenderName,
    senderPhone: config.yanSenderPhone,
    sellerName: config.sellerName,
  };
}

import dotenv from "dotenv";

dotenv.config();

export type OriginProfileCode = "MSK" | "YAN";
export type PackagingPreset = "A2" | "A3" | "A4";

export type AppConfig = {
  port: number;
  cdekBaseUrl: string;
  odnClientId: string;
  odnClientSecret: string;
  yanClientId: string;
  yanClientSecret: string;
  odnShipmentPoint: string;
  yanShipmentPoint: string;
  mskCityCode: number;
  yanCityCode: number;
  senderName: string;
  senderPhone: string;
  sellerName: string;
};

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function readNumber(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env: ${name}`);
  }

  return parsed;
}

export const env: AppConfig = {
  port: readNumber("PORT", 8787),
  cdekBaseUrl: (process.env.CDEK_BASE_URL?.trim() || "https://api.cdek.ru").replace(/\/$/, ""),
  odnClientId: readRequired("CDEK_ODN_CLIENT_ID"),
  odnClientSecret: readRequired("CDEK_ODN_CLIENT_SECRET"),
  yanClientId: readRequired("CDEK_YAN_CLIENT_ID"),
  yanClientSecret: readRequired("CDEK_YAN_CLIENT_SECRET"),
  odnShipmentPoint: process.env.CDEK_ODN_SHIPMENT_POINT?.trim() || "ODN8",
  yanShipmentPoint: process.env.CDEK_YAN_SHIPMENT_POINT?.trim() || "YANN10",
  mskCityCode: readNumber("CDEK_MSK_CITY_CODE", 520),
  yanCityCode: readNumber("CDEK_YAN_CITY_CODE", 13059),
  senderName: readRequired("CDEK_SENDER_NAME"),
  senderPhone: readRequired("CDEK_SENDER_PHONE"),
  sellerName: process.env.CDEK_SELLER_NAME?.trim() || "AES ISLAND",
};

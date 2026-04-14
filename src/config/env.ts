import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export type OriginProfileCode = "ODN" | "YAN" | "MSK";
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
  odnCityCode: number;
  yanCityCode: number;
  odnSenderName: string;
  odnSenderPhone: string;
  yanSenderName: string;
  yanSenderPhone: string;
  sellerName: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  ycAccessKey: string;
  ycSecretKey: string;
  ycBucket: string;
  ycRegion: string;
  adminMainUploadMaxBytes: number;
  adminDefectVideoUploadMaxBytes: number;
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

function readOptional(name: string): string {
  return process.env[name]?.trim() || "";
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
  odnCityCode: readNumber("CDEK_ODN_CITY_CODE", 520),
  yanCityCode: readNumber("CDEK_YAN_CITY_CODE", 13059),
  odnSenderName: readRequired("CDEK_ODN_SENDER_NAME"),
  odnSenderPhone: readRequired("CDEK_ODN_SENDER_PHONE"),
  yanSenderName: readRequired("CDEK_YAN_SENDER_NAME"),
  yanSenderPhone: readRequired("CDEK_YAN_SENDER_PHONE"),
  sellerName: process.env.CDEK_SELLER_NAME?.trim() || "AES ISLAND",
  supabaseUrl: readOptional("SUPABASE_URL"),
  supabaseServiceRoleKey: readOptional("SUPABASE_SERVICE_ROLE_KEY"),
  ycAccessKey: readOptional("YC_ACCESS_KEY"),
  ycSecretKey: readOptional("YC_SECRET_KEY"),
  ycBucket: readOptional("YC_BUCKET"),
  ycRegion: readOptional("YC_REGION") || "ru-central1",
  adminMainUploadMaxBytes: readNumber("ADMIN_MAIN_UPLOAD_MAX_BYTES", 10 * 1024 * 1024),
  adminDefectVideoUploadMaxBytes: readNumber("ADMIN_DEFECT_VIDEO_UPLOAD_MAX_BYTES", 200 * 1024 * 1024),
};

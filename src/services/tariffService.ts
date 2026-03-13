import type { AppConfig } from "../config/env";
import type { ShippingQuoteInput } from "../domain/orderBuilder";
import type { OriginProfile } from "../domain/originProfiles";
import { buildTariffPayload } from "../domain/orderBuilder";
import { HttpError } from "../utils/httpError";
import { cdekPost } from "./cdekClient";

function extractTariffs(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.tariffs)) return raw.tariffs;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

function readTariffCode(row: any): number | null {
  const value = row?.tariff_code ?? row?.code ?? row?.tariffCode;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getTariffList(config: AppConfig, input: ShippingQuoteInput, profile: OriginProfile) {
  const payload = buildTariffPayload(input, profile);
  const response = await cdekPost<any>(config, profile.id, "/v2/calculator/tarifflist", payload);
  return { payload, response };
}

export function selectPreferredTariff(raw: any, preferred: number[] = [234, 136]) {
  const tariffs = extractTariffs(raw);

  for (const code of preferred) {
    const found = tariffs.find((row) => readTariffCode(row) === code);
    if (found) {
      return {
        tariffCode: code,
        tariff: found,
        allTariffs: tariffs,
      };
    }
  }

  throw new HttpError(422, "TARIFF_NOT_AVAILABLE", "Нет доступных тарифов 234 или 136");
}

export async function calculateSelectedTariff(config: AppConfig, input: ShippingQuoteInput, profile: OriginProfile) {
  const { payload, response } = await getTariffList(config, input, profile);
  const selected = selectPreferredTariff(response, profile.preferredTariffs);

  const calculationPayload = {
    ...payload,
    tariff_code: selected.tariffCode,
  };

  const calculation = await cdekPost<any>(config, profile.id, "/v2/calculator/tariff", calculationPayload);

  return {
    payloadUsed: calculationPayload,
    selectedTariffCode: selected.tariffCode,
    selectedTariff: selected.tariff,
    availableTariffs: selected.allTariffs,
    calculation,
  };
}

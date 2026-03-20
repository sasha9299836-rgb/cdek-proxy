import type { AppConfig } from "../config/env";
import type { ShippingQuoteInput } from "../domain/orderBuilder";
import type { OriginProfile } from "../domain/originProfiles";
import { buildTariffPayload } from "../domain/orderBuilder";
import { HttpError } from "../utils/httpError";
import { cdekPost } from "./cdekClient";

function logTariffEvent(event: string, data: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      scope: "cdek-proxy",
      event,
      ...data,
    }),
  );
}

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

export function selectPreferredTariff(raw: any, preferred: number[] = [136, 234]) {
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

  throw new HttpError(422, "TARIFF_NOT_AVAILABLE", "Нет доступных тарифов 136 или 234");
}

export async function calculateSelectedTariff(config: AppConfig, input: ShippingQuoteInput, profile: OriginProfile) {
  const { payload, response } = await getTariffList(config, input, profile);
  const tarifflistPayload = payload;
  console.log("CDEK TARIFFLIST PAYLOAD", JSON.stringify(tarifflistPayload, null, 2));
  const tariffs = extractTariffs(response);
  const availableTariffCodes = tariffs.map((row) => readTariffCode(row)).filter((code): code is number => code !== null);
  const preferredTariffs = profile.preferredTariffs?.length ? profile.preferredTariffs : [136, 234];

  logTariffEvent("quote_tariff_list_received", {
    originProfile: profile.id,
    receiverCityCode: input.receiverCityCode,
    packagingPreset: input.packagingPreset ?? null,
    preferredTariffs,
    availableTariffCodes,
    tariffListPayload: payload,
  });

  let selected: ReturnType<typeof selectPreferredTariff>;
  try {
    selected = selectPreferredTariff(response, preferredTariffs);
  } catch (error) {
    if (error instanceof HttpError && error.errorCode === "TARIFF_NOT_AVAILABLE") {
      logTariffEvent("quote_tariff_unavailable", {
        originProfile: profile.id,
        checkedTariffs: preferredTariffs,
        availableTariffCodes,
      });
    }
    throw error;
  }
  const selectedByRule = selected.tariffCode === 136 ? "preferred_136" : "fallback_234";
  const calculationPayload = {
    ...payload,
    tariff_code: selected.tariffCode,
  };
  const directPayload = calculationPayload;
  console.log("CDEK DIRECT TARIFF PAYLOAD", JSON.stringify(directPayload, null, 2));

  logTariffEvent("quote_tariff_selected_from_list", {
    originProfile: profile.id,
    selectedTariffCode: selected.tariffCode,
    selectedByRule,
    checkedTariffs: preferredTariffs,
    calculationPayload,
  });

  const calculation = await cdekPost<any>(config, profile.id, "/v2/calculator/tariff", calculationPayload);
  return {
    payloadUsed: calculationPayload,
    selectedTariffCode: selected.tariffCode,
    selectedTariff: selected.tariff,
    availableTariffs: selected.allTariffs,
    calculation,
  };
}

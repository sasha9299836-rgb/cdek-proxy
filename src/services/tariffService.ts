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
  const tariffs = extractTariffs(response);
  const availableTariffCodes = tariffs.map((row) => readTariffCode(row)).filter((code): code is number => code !== null);
  const preferredTariffs = profile.preferredTariffs?.length ? profile.preferredTariffs : [234, 136];

  logTariffEvent("quote_tariff_list_received", {
    originProfile: profile.id,
    receiverCityCode: input.receiverCityCode,
    packagingPreset: input.packagingPreset ?? null,
    preferredTariffs,
    availableTariffCodes,
    tariffListPayload: payload,
  });

  try {
    const selected = selectPreferredTariff(response, preferredTariffs);
    const calculationPayload = {
      ...payload,
      tariff_code: selected.tariffCode,
    };

    logTariffEvent("quote_tariff_selected_from_list", {
      originProfile: profile.id,
      selectedTariffCode: selected.tariffCode,
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
  } catch (error) {
    const fromListUnavailable = error instanceof HttpError && error.errorCode === "TARIFF_NOT_AVAILABLE";
    if (!fromListUnavailable) {
      throw error;
    }
  }

  const attemptErrors: Array<{ tariffCode: number; statusCode: number; errorCode: string; details: unknown }> = [];

  for (const tariffCode of preferredTariffs) {
    const calculationPayload = {
      ...payload,
      tariff_code: tariffCode,
    };
    logTariffEvent("quote_tariff_direct_attempt", {
      originProfile: profile.id,
      tariffCode,
      checkedTariffs: preferredTariffs,
      calculationPayload,
    });

    try {
      const calculation = await cdekPost<any>(config, profile.id, "/v2/calculator/tariff", calculationPayload);
      const selectedTariff = tariffs.find((row) => readTariffCode(row) === tariffCode) ?? null;

      logTariffEvent("quote_tariff_direct_selected", {
        originProfile: profile.id,
        tariffCode,
        checkedTariffs: preferredTariffs,
      });

      return {
        payloadUsed: calculationPayload,
        selectedTariffCode: tariffCode,
        selectedTariff,
        availableTariffs: tariffs,
        calculation,
      };
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.statusCode !== 422) {
          throw error;
        }
        attemptErrors.push({
          tariffCode,
          statusCode: error.statusCode,
          errorCode: error.errorCode,
          details: error.details ?? null,
        });
        logTariffEvent("quote_tariff_direct_failed", {
          originProfile: profile.id,
          tariffCode,
          statusCode: error.statusCode,
          errorCode: error.errorCode,
        });
        continue;
      }
      throw error;
    }
  }

  logTariffEvent("quote_tariff_unavailable", {
    originProfile: profile.id,
    preferredTariffs,
    availableTariffCodes,
    attemptErrors,
  });

  throw new HttpError(422, "TARIFF_NOT_AVAILABLE", "Нет доступных тарифов 234 или 136", {
    preferredTariffs,
    availableTariffCodes,
    attemptErrors,
  });
}

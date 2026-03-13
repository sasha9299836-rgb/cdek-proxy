import axios from "axios";
import type { AppConfig, OriginProfileCode } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getCdekToken } from "./cdekAuth";

export async function cdekGet<T>(config: AppConfig, profile: OriginProfileCode, path: string): Promise<T> {
  const token = await getCdekToken(config, profile);

  try {
    const response = await axios.get<T>(`${config.cdekBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 20000,
    });

    return response.data;
  } catch (error: any) {
    throw new HttpError(
      error?.response?.status || 502,
      "CDEK_REQUEST_FAILED",
      "Ошибка запроса к CDEK API",
      error?.response?.data,
    );
  }
}

export async function cdekPost<T>(config: AppConfig, profile: OriginProfileCode, path: string, payload: unknown): Promise<T> {
  const token = await getCdekToken(config, profile);

  try {
    const response = await axios.post<T>(`${config.cdekBaseUrl}${path}`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    });

    return response.data;
  } catch (error: any) {
    throw new HttpError(
      error?.response?.status || 502,
      "CDEK_REQUEST_FAILED",
      "Ошибка запроса к CDEK API",
      error?.response?.data,
    );
  }
}

import axios from "axios";
import type { AppConfig, OriginProfileCode } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getCdekToken } from "./cdekAuth";

function safeParseUpstreamBody(body: unknown) {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return { rawText: "", parsedJson: null };
    try {
      return { rawText: trimmed, parsedJson: JSON.parse(trimmed) };
    } catch {
      return { rawText: trimmed, parsedJson: null };
    }
  }

  if (body && typeof body === "object") {
    return { rawText: null, parsedJson: body };
  }

  return { rawText: body == null ? null : String(body), parsedJson: null };
}

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

    if (path === "/v2/calculator/tarifflist") {
      console.log("CDEK TARIFFLIST RAW STATUS", response.status);
      console.log("CDEK TARIFFLIST RAW BODY", JSON.stringify(response.data ?? null, null, 2));
    }

    return response.data;
  } catch (error: any) {
    const responseStatus = error?.response?.status || 502;
    const responseBody = error?.response?.data;

    if (path === "/v2/orders") {
      const parsed = safeParseUpstreamBody(responseBody);
      const externalOrderId =
        payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).number === "string"
          ? (payload as Record<string, unknown>).number
          : null;

      console.error(
        JSON.stringify({
          scope: "cdek-proxy",
          event: "cdek_create_order_upstream_error",
          originProfile: profile,
          cdekPath: path,
          externalOrderId,
          httpStatus: responseStatus,
          upstreamBody: parsed.parsedJson ?? parsed.rawText ?? null,
        }),
      );
    }

    throw new HttpError(
      responseStatus,
      "CDEK_REQUEST_FAILED",
      "Ошибка запроса к CDEK API",
      responseBody,
    );
  }
}

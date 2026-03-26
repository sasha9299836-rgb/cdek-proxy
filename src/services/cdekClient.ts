import axios from "axios";
import iconv from "iconv-lite";
import type { AppConfig, OriginProfileCode } from "../config/env";
import { HttpError } from "../utils/httpError";
import { getCdekToken } from "./cdekAuth";

function normalizeCharset(value: string | null | undefined): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  const match = lower.match(/charset\s*=\s*([^;]+)/);
  if (!match?.[1]) return null;
  return match[1].trim().replace(/^"|"$/g, "");
}

function decodeToText(data: unknown, contentTypeHeader?: string): string | null {
  if (typeof data === "string") return data;
  if (data == null) return null;

  const charset = normalizeCharset(contentTypeHeader);
  const buffer =
    Buffer.isBuffer(data)
      ? data
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : ArrayBuffer.isView(data)
          ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          : null;

  if (!buffer) return null;

  const candidateCharsets = [charset, "utf-8", "windows-1251", "cp1251"]
    .filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

  for (const candidate of candidateCharsets) {
    try {
      if (!iconv.encodingExists(candidate)) continue;
      const decoded = iconv.decode(buffer, candidate);
      if (decoded) return decoded;
    } catch {
      // try next charset
    }
  }

  return buffer.toString("utf8");
}

function tryParseJson(text: string | null): unknown {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeUpstreamData<T>(data: unknown, contentTypeHeader?: string): T {
  if (data && typeof data === "object" && !Buffer.isBuffer(data) && !(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) {
    return data as T;
  }

  const text = decodeToText(data, contentTypeHeader);
  const parsed = tryParseJson(text);
  if (parsed !== null) return parsed as T;
  return (text as unknown) as T;
}

function safeParseUpstreamBody(body: unknown) {
  const bodyAsText = decodeToText(body);
  if (bodyAsText != null) {
    const parsedFromText = tryParseJson(bodyAsText);
    if (parsedFromText !== null) {
      return { rawText: bodyAsText.trim(), parsedJson: parsedFromText };
    }
    return { rawText: bodyAsText.trim(), parsedJson: null };
  }

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
    const response = await axios.get(`${config.cdekBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeout: 20000,
      responseType: "arraybuffer",
    });

    return normalizeUpstreamData<T>(response.data, response.headers?.["content-type"]);
  } catch (error: any) {
    throw new HttpError(
      error?.response?.status || 502,
      "CDEK_REQUEST_FAILED",
      "CDEK API request failed",
      normalizeUpstreamData<unknown>(error?.response?.data, error?.response?.headers?.["content-type"]),
    );
  }
}

export async function cdekPost<T>(config: AppConfig, profile: OriginProfileCode, path: string, payload: unknown): Promise<T> {
  const token = await getCdekToken(config, profile);

  try {
    const response = await axios.post(`${config.cdekBaseUrl}${path}`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 20000,
      responseType: "arraybuffer",
    });

    const normalized = normalizeUpstreamData<T>(response.data, response.headers?.["content-type"]);

    if (path === "/v2/calculator/tarifflist") {
      console.log("CDEK TARIFFLIST RAW STATUS", response.status);
      console.log("CDEK TARIFFLIST RAW BODY", JSON.stringify(normalized ?? null, null, 2));
    }

    return normalized;
  } catch (error: any) {
    const responseStatus = error?.response?.status || 502;
    const responseBody = normalizeUpstreamData<unknown>(error?.response?.data, error?.response?.headers?.["content-type"]);

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
      "CDEK API request failed",
      responseBody,
    );
  }
}

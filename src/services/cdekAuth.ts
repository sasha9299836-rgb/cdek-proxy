import axios from "axios";
import type { AppConfig, OriginProfileCode } from "../config/env";
import { HttpError } from "../utils/httpError";

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

const tokenCache: Partial<Record<OriginProfileCode, TokenCacheEntry>> = {};

function getCredentials(config: AppConfig, profile: OriginProfileCode) {
  if (profile === "ODN") {
    return {
      clientId: config.odnClientId,
      clientSecret: config.odnClientSecret,
    };
  }

  return {
    clientId: config.yanClientId,
    clientSecret: config.yanClientSecret,
  };
}

export async function getCdekToken(config: AppConfig, profile: OriginProfileCode): Promise<string> {
  const cached = tokenCache[profile];
  const now = Date.now();

  if (cached && cached.expiresAt - 30_000 > now) {
    return cached.token;
  }

  const credentials = getCredentials(config, profile);
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new HttpError(500, "CREDENTIALS_MISSING", `CDEK credentials are not configured for profile ${profile}`);
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  try {
    const response = await axios.post(`${config.cdekBaseUrl}/v2/oauth/token`, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15000,
    });

    const token = response.data?.access_token;
    const expiresIn = Number(response.data?.expires_in ?? 3600);
    if (!token) {
      throw new HttpError(502, "TOKEN_RESPONSE_INVALID", "CDEK token response is invalid");
    }

    tokenCache[profile] = {
      token,
      expiresAt: now + expiresIn * 1000,
    };

    return token;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, "TOKEN_REQUEST_FAILED", "Не удалось получить токен CDEK");
  }
}

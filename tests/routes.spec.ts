import axios from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe("shipping routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/shipping/quote happy path", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: "token", expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { tariffs: [{ tariff_code: 136, tariff_name: "Tariff 136" }, { tariff_code: 234, tariff_name: "Tariff 234" }] } })
      .mockResolvedValueOnce({ data: { delivery_sum: 450, period_min: 2, period_max: 4 } });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/quote",
      payload: {
        originProfile: "ODN",
        packagingPreset: "A2",
        receiverCityCode: 44,
        package: { weight: 600, length: 35, width: 42, height: 4 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      originProfile: "ODN",
      shipmentPoint: "ODN8",
      selectedTariffCode: 136,
    });

    await app.close();
  });

  it("POST /api/shipping/quote invalid body", async () => {
    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/quote",
      payload: {
        package: { weight: 600, length: 35, width: 42, height: 4 },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: "RECEIVER_CITY_CODE_REQUIRED" });

    await app.close();
  });

  it("POST /api/shipping/create happy path", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    mockedAxios.post
      .mockResolvedValueOnce({ data: { access_token: "token", expires_in: 3600 } })
      .mockResolvedValueOnce({ data: { tariffs: [{ tariff_code: 234, tariff_name: "Tariff 234" }] } })
      .mockResolvedValueOnce({ data: { delivery_sum: 450 } })
      .mockResolvedValueOnce({ data: { entity: { uuid: "uuid-123", cdek_number: "cdek-100", status: "CREATED" } } });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/create",
      payload: {
        originProfile: "YAN",
        packagingPreset: "A3",
        receiverCityCode: 44,
        deliveryPoint: "ODN345",
        externalOrderId: "order-123",
        recipient: { name: "Test User", phone: "+79990000000" },
        package: { weight: 600, length: 35, width: 42, height: 4 },
        items: [{ cost: 100, amount: 1, weight: 600, paymentValue: 0 }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      originProfile: "YAN",
      shipmentPoint: "YANN10",
      selectedTariffCode: 234,
      uuid: "uuid-123",
      cdekNumber: "cdek-100",
      trackingStatus: "CREATED",
    });

    await app.close();
  });

  it("POST /api/shipping/quote returns TARIFF_NOT_AVAILABLE when tarifflist has no 136/234", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    mockedAxios.post.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/oauth/token")) {
        return { data: { access_token: "token", expires_in: 3600 } } as any;
      }
      if (target.includes("/v2/calculator/tarifflist")) {
        return { data: { tariffs: [{ tariff_code: 999, tariff_name: "Other tariff" }] } } as any;
      }
      throw new Error(`Unexpected POST ${target}`);
    });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/quote",
      payload: {
        originProfile: "ODN",
        packagingPreset: "A3",
        receiverCityCode: 44,
        package: { weight: 400, length: 15, width: 10, height: 4 },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ ok: false, error: "TARIFF_NOT_AVAILABLE" });

    const postCalls = mockedAxios.post.mock.calls.map((call) => String(call[0]));
    expect(postCalls.some((url) => /\/v2\/calculator\/tariff$/.test(url))).toBe(false);
    await app.close();
  });

  it("POST /api/shipping/quote uses emergency fallback 136 -> 234 only when 136 calculation fails", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    let tariffAttempts = 0;
    mockedAxios.post.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/oauth/token")) {
        return { data: { access_token: "token", expires_in: 3600 } } as any;
      }
      if (target.includes("/v2/calculator/tarifflist")) {
        return { data: { tariffs: [{ tariff_code: 136 }, { tariff_code: 234 }] } } as any;
      }
      if (target.includes("/v2/calculator/tariff")) {
        tariffAttempts += 1;
        if (tariffAttempts === 1) {
          throw { response: { status: 422, data: { error: "TARIFF_NOT_AVAILABLE" } } };
        }
        return { data: { delivery_sum: 620, period_min: 3, period_max: 7 } } as any;
      }
      throw new Error(`Unexpected POST ${target}`);
    });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/quote",
      payload: {
        originProfile: "ODN",
        packagingPreset: "A3",
        receiverCityCode: 44,
        package: { weight: 400, length: 15, width: 10, height: 4 },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      selectedTariffCode: 234,
    });

    const tariffCalls = mockedAxios.post.mock.calls
      .filter((call) => /\/v2\/calculator\/tariff$/.test(String(call[0])))
      .map((call) => call[1] as Record<string, unknown>);
    expect(tariffCalls).toHaveLength(2);
    expect(tariffCalls[0]?.tariff_code).toBe(136);
    expect(tariffCalls[1]?.tariff_code).toBe(234);

    await app.close();
  });

  it("POST /api/shipping/create uses provided tariffCode and keeps origin profile/preset consistent", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    mockedAxios.post.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/oauth/token")) {
        return { data: { access_token: "token", expires_in: 3600 } } as any;
      }
      if (target.includes("/v2/orders")) {
        return { data: { entity: { uuid: "uuid-yan", cdek_number: "cdek-yan", status: "CREATED" } } } as any;
      }
      throw new Error(`Unexpected POST ${target}`);
    });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/create",
      payload: {
        originProfile: "YAN",
        packagingPreset: "A2",
        receiverCityCode: 137,
        deliveryPoint: "SPB777",
        externalOrderId: "order-yan",
        tariffCode: 136,
        recipient: { name: "Test User", phone: "+79990000000" },
        package: { weight: 900, length: 31, width: 22, height: 11 },
        items: [{ cost: 100, amount: 1, weight: 900, paymentValue: 0 }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      originProfile: "YAN",
      shipmentPoint: "YANN10",
      selectedTariffCode: 136,
      uuid: "uuid-yan",
    });
    const postCalls = mockedAxios.post.mock.calls.map((call) => [String(call[0]), call[1]]);
    expect(postCalls.some(([url]) => url.includes("/v2/calculator/"))).toBe(false);
    const orderCall = postCalls.find(([url]) => url.includes("/v2/orders"));
    expect(orderCall).toBeTruthy();
    expect(orderCall?.[1]).toMatchObject({
      tariff_code: 136,
      shipment_point: "YANN10",
      delivery_point: "SPB777",
      services: [{ code: "COURIER_PACKAGE_A2", parameter: 1 }],
    });

    await app.close();
  });

  it("POST /api/shipping/create normalizes official-like nested status payload", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    mockedAxios.post.mockImplementation(async (url) => {
      const target = String(url);
      if (target.includes("/oauth/token")) {
        return { data: { access_token: "token", expires_in: 3600 } } as any;
      }
      if (target.includes("/v2/orders")) {
        return {
          data: {
            entity: {
              uuid: "uuid-official",
              cdek_number: "cdek-official",
              statuses: [{ code: "ACCEPTED", name: "Accepted" }],
            },
          },
        } as any;
      }
      throw new Error(`Unexpected POST ${target}`);
    });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/create",
      payload: {
        originProfile: "ODN",
        packagingPreset: "A3",
        deliveryPoint: "ODN345",
        externalOrderId: "order-official",
        tariffCode: 234,
        recipient: { name: "Test User", phone: "+79990000000" },
        package: { weight: 600, length: 35, width: 42, height: 4 },
        items: [{ cost: 100, amount: 1, weight: 600, paymentValue: 0 }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      uuid: "uuid-official",
      cdekNumber: "cdek-official",
      trackingStatus: "ACCEPTED",
    });

    await app.close();
  });

  it("POST /api/shipping/create missing required fields", async () => {
    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "POST",
      url: "/api/shipping/create",
      payload: {
        originProfile: "ODN",
        externalOrderId: "order-123",
        package: { weight: 600, length: 35, width: 42, height: 4 },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: "DELIVERY_POINT_REQUIRED" });

    await app.close();
  });

  it("GET /api/shipping/status/:uuid happy path", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: "token", expires_in: 3600 } });
    mockedAxios.get.mockResolvedValueOnce({ data: { entity: { uuid: "uuid-123", cdek_number: "cdek-100", status: "CREATED" } } });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/api/shipping/status/uuid-123?originProfile=ODN",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, originProfile: "ODN", uuid: "uuid-123" });

    await app.close();
  });

  it("GET /api/shipping/status/:uuid accepts nested official-like statuses", async () => {
    const mockedAxios = vi.mocked(axios, { partial: false });
    mockedAxios.post.mockResolvedValueOnce({ data: { access_token: "token", expires_in: 3600 } });
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        entity: {
          uuid: "uuid-123",
          cdek_number: "cdek-100",
          statuses: [{ code: "READY_FOR_PICKUP", name: "Ready for pickup" }],
        },
      },
    });

    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/api/shipping/status/uuid-123?originProfile=ODN",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, originProfile: "ODN", uuid: "uuid-123" });

    await app.close();
  });

  it("GET /api/shipping/status/:uuid missing originProfile", async () => {
    const { buildServer } = await import("../src/server");
    const app = await buildServer();
    const response = await app.inject({
      method: "GET",
      url: "/api/shipping/status/uuid-123",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ ok: false, error: "INVALID_ORIGIN_PROFILE" });

    await app.close();
  });
});


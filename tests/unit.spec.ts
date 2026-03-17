import { describe, expect, it } from "vitest";
import { parseOriginProfile, getOriginProfile } from "../src/domain/originProfiles";
import { HttpError } from "../src/utils/httpError";
import { selectPreferredTariff } from "../src/services/tariffService";
import { getPackagingServices } from "../src/domain/packagingPresets";
import { buildCreateOrderPayload, buildItems, buildTariffPayload } from "../src/domain/orderBuilder";
import { env } from "../src/config/env";
import { validateCreateBody, validateQuoteBody } from "../src/controllers/shippingController";

describe("parseOriginProfile", () => {
  it("accepts ODN and YAN", () => {
    expect(parseOriginProfile("ODN")).toBe("ODN");
    expect(parseOriginProfile("YAN")).toBe("YAN");
  });

  it("uses fallback for empty value", () => {
    expect(parseOriginProfile(undefined, "ODN")).toBe("ODN");
  });

  it("throws for invalid profile", () => {
    expect(() => parseOriginProfile("trash")).toThrow(HttpError);
    expect(() => parseOriginProfile("trash")).toThrow("Неизвестный профиль отправки");
  });
});

describe("tariff selection", () => {
  it("prefers 234 over 136", () => {
    const result = selectPreferredTariff([{ tariff_code: 136 }, { tariff_code: 234 }]);
    expect(result.tariffCode).toBe(234);
  });

  it("falls back to 136", () => {
    const result = selectPreferredTariff([{ tariff_code: 136 }]);
    expect(result.tariffCode).toBe(136);
  });

  it("throws when neither 234 nor 136 exists", () => {
    expect(() => selectPreferredTariff([{ tariff_code: 999 }])).toThrow(HttpError);
  });
});

describe("packaging preset", () => {
  it("injects COURIER_PACKAGE_A2 for A2", () => {
    expect(getPackagingServices("A2")).toEqual([{ code: "COURIER_PACKAGE_A2", parameter: 1 }]);
  });

  it("does not add services for A3/A4", () => {
    expect(getPackagingServices("A3")).toBeUndefined();
    expect(getPackagingServices("A4")).toBeUndefined();
  });
});

describe("orderBuilder", () => {
  it("buildItems enriches business items with fixed CDEK fields", () => {
    const items = buildItems([{ cost: 5000, amount: 2, weight: 600, paymentValue: 0 }], {
      weight: 600,
      length: 35,
      width: 42,
      height: 4,
    });

    expect(items).toEqual([
      {
        name: "clothes",
        ware_key: "poizon",
        cost: 5000,
        amount: 2,
        weight: 600,
        payment: { value: 0 },
      },
    ]);
  });

  it("buildCreateOrderPayload injects sender, seller, shipment point and A2 service", () => {
    const profile = getOriginProfile(env, "ODN");
    const payload = buildCreateOrderPayload(
      {
        originProfile: "ODN",
        packagingPreset: "A2",
        deliveryPoint: "ODN345",
        externalOrderId: "order-123",
        recipient: {
          name: "Test User",
          phone: "+79990000000",
        },
        package: {
          weight: 600,
          length: 35,
          width: 42,
          height: 4,
        },
        items: [{ cost: 100, amount: 1, weight: 600, paymentValue: 0 }],
      },
      profile,
      234,
    );

    expect(payload.shipment_point).toBe(profile.shipmentPoint);
    expect(payload.sender).toEqual({
      name: profile.senderName,
      phones: [{ number: profile.senderPhone }],
    });
    expect(payload.seller).toEqual({ name: profile.sellerName });
    expect(payload.services).toEqual([{ code: "COURIER_PACKAGE_A2", parameter: 1 }]);
    expect(payload.packages[0].items[0]).toMatchObject({
      name: "clothes",
      ware_key: "poizon",
    });
  });

  it("quote and create builders stay aligned for the same profile, preset and package", () => {
    const profile = getOriginProfile(env, "YAN");
    const quotePayload = buildTariffPayload(
      {
        originProfile: "YAN",
        packagingPreset: "A2",
        receiverCityCode: 137,
        package: {
          weight: 900,
          length: 31,
          width: 22,
          height: 11,
        },
      },
      profile,
    );
    const createPayload = buildCreateOrderPayload(
      {
        originProfile: "YAN",
        packagingPreset: "A2",
        receiverCityCode: 137,
        deliveryPoint: "SPB777",
        externalOrderId: "order-yan",
        tariffCode: 136,
        recipient: {
          name: "Test User",
          phone: "+79990000000",
        },
        package: {
          weight: 900,
          length: 31,
          width: 22,
          height: 11,
        },
        items: [{ cost: 100, amount: 1, weight: 900, paymentValue: 0 }],
      },
      profile,
      136,
    );

    expect(quotePayload.from_location.code).toBe(profile.cityCode);
    expect(createPayload.shipment_point).toBe(profile.shipmentPoint);
    expect(quotePayload.packages[0]).toMatchObject({
      weight: createPayload.packages[0].weight,
      length: createPayload.packages[0].length,
      width: createPayload.packages[0].width,
      height: createPayload.packages[0].height,
    });
    expect(quotePayload.services).toEqual(createPayload.services);
    expect(createPayload.sender).toEqual({
      name: "Голумбевский Артемий Максимович",
      phones: [{ number: "+79117155960" }],
    });
  });

  it("changed package dimensions are an explicit different shipment input", () => {
    const profile = getOriginProfile(env, "ODN");
    const quoted = buildTariffPayload(
      {
        originProfile: "ODN",
        packagingPreset: "A3",
        receiverCityCode: 44,
        package: {
          weight: 400,
          length: 15,
          width: 10,
          height: 4,
        },
      },
      profile,
    );
    const changed = buildCreateOrderPayload(
      {
        originProfile: "ODN",
        packagingPreset: "A3",
        receiverCityCode: 44,
        deliveryPoint: "ODN345",
        externalOrderId: "order-drift",
        recipient: {
          name: "Test User",
          phone: "+79990000000",
        },
        package: {
          weight: 900,
          length: 31,
          width: 22,
          height: 11,
        },
        items: [{ cost: 100, amount: 1, weight: 900, paymentValue: 0 }],
      },
      profile,
      234,
    );

    expect(changed.packages[0]).not.toMatchObject(quoted.packages[0]);
  });
});

describe("shippingController raw payload rejection", () => {
  it("rejects raw quote payload", () => {
    expect(() =>
      validateQuoteBody({
        from_location: { code: 1 },
        to_location: { code: 2 },
        packages: [],
      }),
    ).toThrow(HttpError);
  });

  it("rejects raw create payload", () => {
    expect(() =>
      validateCreateBody({
        type: 1,
        shipment_point: "ODN8",
        delivery_point: "ODN345",
        packages: [],
      }),
    ).toThrow(HttpError);
  });
});


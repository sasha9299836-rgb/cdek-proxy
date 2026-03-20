import type { OriginProfileCode, PackagingPreset } from "../config/env";
import type { OriginProfile } from "./originProfiles";
import { getPackagingServices } from "./packagingPresets";

export type PackageInput = {
  weight: number;
  length: number;
  width: number;
  height: number;
};

export type ItemInput = {
  cost: number;
  amount?: number;
  weight?: number;
  paymentValue?: number;
};

export type ShippingQuoteInput = {
  originProfile?: OriginProfileCode;
  packagingPreset?: PackagingPreset;
  receiverCityCode: number | string;
  package: PackageInput;
};

export type ShippingCreateInput = {
  originProfile?: OriginProfileCode;
  packagingPreset?: PackagingPreset;
  receiverCityCode?: number | string;
  deliveryPoint: string;
  externalOrderId: string;
  tariffCode?: number;
  deliveryRecipientCost?: number;
  recipient: {
    name: string;
    phone: string;
    email?: string;
  };
  package: PackageInput;
  items?: ItemInput[];
};

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildItems(items: ItemInput[] | undefined, packageInput: PackageInput) {
  const source = items?.length
    ? items
    : [{ cost: 0, amount: 1, weight: packageInput.weight, paymentValue: 0 }];

  return source.map((item) => ({
    // CDEK expects a meaningful item name in the order payload.
    name: "clothes",
    ware_key: "poizon",
    cost: toNumber(item.cost, 0),
    amount: toNumber(item.amount, 1),
    weight: toNumber(item.weight, packageInput.weight),
    payment: {
      value: toNumber(item.paymentValue, item.cost),
    },
  }));
}

export function buildTariffPayload(input: ShippingQuoteInput, profile: OriginProfile) {
  const payload = {
    type: 2,
    currency: 1,
    from_location: {
      code: profile.cityCode,
      city: profile.cityName,
    },
    to_location: {
      code: toNumber(input.receiverCityCode, 0),
    },
    packages: [
      {
        weight: toNumber(input.package.weight, 0),
        length: toNumber(input.package.length, 0),
        width: toNumber(input.package.width, 0),
        height: toNumber(input.package.height, 0),
      },
    ],
  };

  const services = getPackagingServices(input.packagingPreset);
  return services ? { ...payload, services } : payload;
}

export function buildCreateOrderPayload(input: ShippingCreateInput, profile: OriginProfile, tariffCode: number) {
  const payload = {
    type: 1,
    number: input.externalOrderId,
    tariff_code: tariffCode,
    shipment_point: profile.shipmentPoint,
    delivery_point: input.deliveryPoint,
    sender: {
      name: profile.senderName,
      phones: [{ number: profile.senderPhone }],
    },
    seller: {
      name: profile.sellerName,
    },
    recipient: {
      name: input.recipient.name,
      email: input.recipient.email,
      phones: [{ number: input.recipient.phone }],
    },
    packages: [
      {
        number: "1",
        weight: toNumber(input.package.weight, 0),
        length: toNumber(input.package.length, 0),
        width: toNumber(input.package.width, 0),
        height: toNumber(input.package.height, 0),
        items: buildItems(input.items, input.package),
      },
    ],
  };

  const withRecipientCost =
    input.deliveryRecipientCost && input.deliveryRecipientCost > 0
      ? {
          ...payload,
          delivery_recipient_cost: {
            value: toNumber(input.deliveryRecipientCost, 0),
          },
        }
      : payload;

  const services = getPackagingServices(input.packagingPreset);
  return services ? { ...withRecipientCost, services } : withRecipientCost;
}

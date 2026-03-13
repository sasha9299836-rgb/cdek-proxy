import type { PackagingPreset } from "../config/env";

export type CdekService = {
  code: string;
  parameter?: number;
};

export function getPackagingServices(preset?: PackagingPreset): CdekService[] | undefined {
  if (preset === "A2") {
    return [{ code: "COURIER_PACKAGE_A2", parameter: 1 }];
  }

  return undefined;
}

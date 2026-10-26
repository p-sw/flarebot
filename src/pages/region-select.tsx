// SPDX-License-Identifier: MIT

import { t } from "@shared/copy";
import {
  CHECK_REGION_IDS,
  type CheckRegionId,
  type MonitorRegionChoice,
} from "@shared/regions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export function regionLabel(id: MonitorRegionChoice): string {
  switch (id) {
    case "inherit":
      return t("region_inherit");
    case "auto":
      return t("region_auto");
    case "wnam":
      return t("region_wnam");
    case "enam":
      return t("region_enam");
    case "sam":
      return t("region_sam");
    case "weur":
      return t("region_weur");
    case "eeur":
      return t("region_eeur");
    case "apac":
      return t("region_apac");
    case "apac-ne":
      return t("region_apac_ne");
    case "apac-se":
      return t("region_apac_se");
    case "oc":
      return t("region_oc");
    case "afr":
      return t("region_afr");
    case "me":
      return t("region_me");
  }
}

export function RegionSelect({
  value,
  onChange,
  includeInherit,
  disabled,
}: {
  value: MonitorRegionChoice | CheckRegionId;
  onChange: (value: string) => void;
  includeInherit: boolean;
  disabled?: boolean;
}) {
  const options = includeInherit
    ? (["inherit", ...CHECK_REGION_IDS] as const)
    : CHECK_REGION_IDS;
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {regionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

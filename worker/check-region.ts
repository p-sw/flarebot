// SPDX-License-Identifier: MIT

import {
  CHECK_REGION_KEY,
  type CheckRegionId,
  normalizeGlobalRegion,
} from "../shared/regions";
import { readSetting } from "./settings-store";

export async function readCheckRegion(env: Env): Promise<CheckRegionId> {
  return normalizeGlobalRegion(
    await readSetting(env, CHECK_REGION_KEY, "auto"),
  );
}

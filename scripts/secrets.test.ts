// SPDX-License-Identifier: AGPL-3.0-only

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_SECRET_VALUES,
  findSecretLeaks,
  stripDevVarFiles,
  valuesFromDevVars,
} from "../scripts/assert-no-secrets.mjs";

describe("production build secrets", () => {
  it("reads secret values and ignores comments", () => {
    const text = [
      "# comment = change-me-setup-secret",
      "SETUP_SECRET=change-me-setup-secret",
      "ENCRYPTION_KEY='abc'",
      "SMTP_PASSWORD=",
    ].join("\n");
    expect(valuesFromDevVars(text)).toEqual(["change-me-setup-secret"]);
  });

  it("strips dev vars files and flags values left in the bundle", () => {
    const root = mkdtempSync(path.join(tmpdir(), "flarebot-dist-"));
    mkdirSync(path.join(root, "flarebot"), { recursive: true });
    mkdirSync(path.join(root, "client", "assets"), { recursive: true });
    writeFileSync(
      path.join(root, "flarebot", ".dev.vars"),
      "SETUP_SECRET=change-me-setup-secret\n",
    );
    writeFileSync(
      path.join(root, "flarebot", "index.js"),
      "export default {};\n",
    );
    writeFileSync(
      path.join(root, "client", "assets", "index.js"),
      "export const screen = 'Dashboard';\n",
    );

    expect(stripDevVarFiles(root)).toHaveLength(1);
    expect(findSecretLeaks(root, EXAMPLE_SECRET_VALUES)).toEqual([]);

    writeFileSync(
      path.join(root, "flarebot", "index.js"),
      `const leaked = ${JSON.stringify(EXAMPLE_SECRET_VALUES[0])};\n`,
    );
    writeFileSync(
      path.join(root, "client", "assets", "index.js"),
      "const name = 'SETUP_SECRET';\n",
    );
    expect(findSecretLeaks(root, EXAMPLE_SECRET_VALUES)).toEqual([
      "client/assets/index.js: client asset contains SETUP_SECRET",
      "flarebot/index.js: contains a secret value",
    ]);
    expect(
      readFileSync(path.join(root, "flarebot", "index.js"), "utf8"),
    ).toContain(EXAMPLE_SECRET_VALUES[0]);
  });
});

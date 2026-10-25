// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { assertScopesWithinRole, can, scopesForRole } from "./permissions";

describe("can", () => {
  it("lets a viewer read and blocks writes", () => {
    expect(can({ role: "viewer" }, "monitors.read", { id: "m1" })).toBe(true);
    expect(can({ role: "viewer" }, "monitors.write")).toBe(false);
    expect(can({ role: "viewer" }, "audit.read")).toBe(false);
  });

  it("lets an editor manage monitors but not channels", () => {
    expect(can({ role: "editor" }, "monitors.write")).toBe(true);
    expect(can({ role: "editor" }, "channels.write")).toBe(false);
    expect(can({ role: "editor" }, "status_pages.write")).toBe(false);
  });

  it("lets an admin invite and blocks instance settings", () => {
    expect(can({ role: "admin" }, "users.invite")).toBe(true);
    expect(can({ role: "admin" }, "instance.settings")).toBe(false);
    expect(can({ role: "owner" }, "instance.transfer")).toBe(true);
  });

  it("intersects token scopes with the creator role", () => {
    expect(
      can({ role: "editor", tokenScopes: ["read"] }, "monitors.read"),
    ).toBe(true);
    expect(
      can({ role: "editor", tokenScopes: ["read"] }, "monitors.write"),
    ).toBe(false);
    expect(
      can({ role: "editor", tokenScopes: ["heartbeat"] }, "monitors.heartbeat"),
    ).toBe(true);
    expect(
      can({ role: "editor", tokenScopes: ["heartbeat"] }, "monitors.read"),
    ).toBe(false);
    expect(
      can(
        { role: "viewer", tokenScopes: ["monitors:write"] },
        "monitors.write",
      ),
    ).toBe(false);
  });

  it("limits which scopes a role may mint", () => {
    expect(scopesForRole("viewer")).toEqual(["read"]);
    expect(assertScopesWithinRole("viewer", ["read"])).toBe(true);
    expect(assertScopesWithinRole("viewer", ["monitors:write"])).toBe(false);
    expect(assertScopesWithinRole("editor", ["heartbeat", "read"])).toBe(true);
  });
});

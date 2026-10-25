import { expect, test as setup } from "@playwright/test";
import { email, origin, password, setupSecret } from "./session";

setup("owner account exists", async ({ request }) => {
  const response = await request.post("/api/setup", {
    headers: { origin, "content-type": "application/json" },
    data: {
      setupSecret,
      name: "Ada",
      email,
      password,
    },
  });
  const body = await response.text();
  expect([201, 409], body).toContain(response.status());
});

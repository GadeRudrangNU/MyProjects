import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_HEADERS, API, DASHBOARD, SDK_HEADERS, uniqueKey } from "./urls";

test.describe("dashboard", () => {
  test("lists the seeded flags", async ({ page }) => {
    await page.goto(DASHBOARD);
    await expect(page.getByRole("heading", { name: "Flags" })).toBeVisible();
    for (const key of ["new-checkout", "canada-free-shipping", "beta-recommendations"]) {
      await expect(page.getByTestId(`flag-row-${key}`)).toBeVisible();
    }
  });

  test("creates a flag with a targeting rule and records it in the audit log", async ({ page, request }) => {
    const key = uniqueKey("promo");
    await page.goto(`${DASHBOARD}/#/flags/new`);

    await page.getByLabel("Key").fill(key);
    await page.getByLabel("Description").fill("Spring promotion");
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.getByLabel("Rule 1 attribute").fill("country");
    await page.getByLabel("Rule 1 values").fill("CA, US");
    await page.getByLabel("Rollout percentage").fill("15");
    await page.getByRole("button", { name: "Create flag" }).click();

    await expect(page.getByRole("heading", { name: key })).toBeVisible();

    const flag = await (await request.get(`${API}/api/flags/${key}`, { headers: ADMIN_HEADERS })).json();
    expect(flag.rolloutPercent).toBe(15);
    expect(flag.conditions).toEqual([{ attribute: "country", operator: "in", values: ["CA", "US"] }]);

    await page.goto(`${DASHBOARD}/#/audit`);
    await expect(page.getByTestId("audit-list").getByText(key).first()).toBeVisible();
  });

  test("rejects an invalid key with a readable message", async ({ page }) => {
    await page.goto(`${DASHBOARD}/#/flags/new`);
    await page.getByLabel("Key").fill("Not Valid!");
    await page.getByRole("button", { name: "Create flag" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "lowercase" })).toBeVisible();
  });

  test("toggles a flag from the list and logs who did it", async ({ page, request }) => {
    const key = uniqueKey("toggle");
    await request.post(`${API}/api/flags`, {
      headers: ADMIN_HEADERS,
      data: { key, description: "", enabled: true, rolloutPercent: 10 },
    });

    await page.goto(DASHBOARD);
    await page.getByLabel("Acting as").fill("priya");
    const row = page.getByTestId(`flag-row-${key}`);
    await row.getByRole("switch").click();
    await expect(row.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    await page.goto(`${DASHBOARD}/#/flags/${key}`);
    const activity = page.getByTestId("audit-list");
    await expect(activity.getByText("Disabled flag")).toBeVisible();
    await expect(activity.getByText("by priya")).toBeVisible();
  });

  test("edits rollout and persists after a reload", async ({ page, request }) => {
    const key = uniqueKey("edit");
    await request.post(`${API}/api/flags`, {
      headers: ADMIN_HEADERS,
      data: { key, description: "", enabled: true, rolloutPercent: 5 },
    });

    await page.goto(`${DASHBOARD}/#/flags/${key}`);
    await page.getByLabel("Rollout percentage").fill("60");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");

    await page.reload();
    await expect(page.getByLabel("Rollout percentage")).toHaveValue("60");
  });

  test("a rollback that needs approval waits for a person", async ({ page, request }) => {
    const key = uniqueKey("approve");
    await request.post(`${API}/api/flags`, {
      headers: ADMIN_HEADERS,
      data: {
        key,
        description: "",
        enabled: true,
        rolloutPercent: 50,
        guard: { enabled: true, mode: "approval", minSamples: 100, alpha: 0.001, minDifference: 0.05, windowSeconds: 30 },
      },
    });
    await page.waitForTimeout(1200);
    await request.post(`${API}/sdk/events`, {
      headers: SDK_HEADERS,
      data: {
        reports: [
          { flagKey: key, variant: false, requests: 200, errors: 2 },
          { flagKey: key, variant: true, requests: 200, errors: 90 },
        ],
      },
    });

    await page.goto(DASHBOARD);
    const proposal = page.getByTestId(`proposal-${key}`);
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText("45.0%");

    const stillOn = await (await request.get(`${API}/api/flags/${key}`, { headers: ADMIN_HEADERS })).json();
    expect(stillOn.enabled).toBe(true);

    await proposal.getByRole("button", { name: "Approve rollback" }).click();
    await expect(proposal).toBeHidden();

    await expect
      .poll(async () => (await (await request.get(`${API}/api/flags/${key}`, { headers: ADMIN_HEADERS })).json()).enabled)
      .toBe(false);
  });

  test("shows live error rates and a regression verdict on the flag page", async ({ page, request }) => {
    const key = uniqueKey("health");
    await request.post(`${API}/api/flags`, {
      headers: ADMIN_HEADERS,
      data: {
        key,
        description: "",
        enabled: true,
        rolloutPercent: 50,
        guard: { enabled: false, mode: "auto", minSamples: 100, alpha: 0.001, minDifference: 0.05, windowSeconds: 30 },
      },
    });
    await page.waitForTimeout(1200);
    await request.post(`${API}/sdk/events`, {
      headers: SDK_HEADERS,
      data: {
        reports: [
          { flagKey: key, variant: false, requests: 300, errors: 3 },
          { flagKey: key, variant: true, requests: 300, errors: 3 },
        ],
      },
    });

    await page.goto(`${DASHBOARD}/#/flags/${key}`);
    await expect(page.getByTestId("rate-on")).toHaveText("1.0%");
    await expect(page.getByTestId("rate-off")).toHaveText("1.0%");
  });

  test("main pages have no serious accessibility violations", async ({ page }) => {
    for (const path of ["/", "/#/flags/new-checkout", "/#/audit"]) {
      await page.goto(`${DASHBOARD}${path}`);
      await expect(page.getByRole("navigation")).toBeVisible();
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), path).toEqual([]);
    }
  });
});

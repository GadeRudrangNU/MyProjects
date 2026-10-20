import { expect, test } from "@playwright/test";
import { ADMIN_HEADERS, API, DASHBOARD, DEMO } from "./urls";

test.describe.configure({ mode: "serial" });

test.describe("demo store", () => {
  test("a shopper keeps the same checkout across reloads", async ({ page }) => {
    await page.goto(DEMO);
    await expect(page.getByTestId("connection")).toHaveText("Connected to ShipSafe");

    const variants = new Set<string>();
    for (const id of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"]) {
      await page.getByTestId("user-id").fill(id);
      await expect.poll(() => page.getByTestId("checkout").getAttribute("data-variant")).toMatch(/new|classic/);
      await page.waitForTimeout(500);
      const first = await page.getByTestId("checkout").getAttribute("data-variant");
      await page.reload();
      await page.getByTestId("user-id").fill(id);
      await page.waitForTimeout(500);
      expect(await page.getByTestId("checkout").getAttribute("data-variant")).toBe(first);
      variants.add(first!);
    }
    expect(variants.size).toBe(2);
  });

  test("placing an order reports a result", async ({ page }) => {
    await page.goto(DEMO);
    await page.getByTestId("place-order").click();
    await expect(page.getByTestId("order-result")).toContainText(/Order placed|Something went wrong/);
  });

  test("a bad release is rolled back automatically and the checkout changes back", async ({ page, request }) => {
    await request.post(`${DEMO}/api/rerelease`);
    await page.goto(DEMO);

    let newUser = "";
    for (let i = 0; i < 40 && !newUser; i++) {
      const id = `probe-${i}`;
      const state = await (await request.get(`${DEMO}/api/state?userId=${id}`)).json();
      if (state.you.enabled) newUser = id;
    }
    expect(newUser).not.toBe("");

    await page.getByTestId("user-id").fill(newUser);
    await expect(page.getByTestId("checkout")).toHaveAttribute("data-variant", "new");
    await expect(page.getByTestId("rollback-banner")).toBeHidden();

    await page.getByTestId("traffic-toggle").click();
    await page.waitForTimeout(2500);
    await page.getByTestId("bug-toggle").click();

    await expect(page.getByTestId("rollback-banner")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("rollback-banner")).toContainText("switched new-checkout off");
    await expect(page.getByTestId("flag-status")).toContainText("OFF for everyone");
    await expect(page.getByTestId("checkout")).toHaveAttribute("data-variant", "classic");

    const audit = await (await request.get(`${API}/api/audit?flagKey=new-checkout`, { headers: ADMIN_HEADERS })).json();
    const rollback = audit.find((entry: { action: string }) => entry.action === "rollback");
    expect(rollback.actor).toBe("shipsafe-auto");
    expect(rollback.evidence.verdict).toBe("regressed");

    await page.goto(`${DASHBOARD}/#/audit`);
    await expect(page.getByTestId("audit-list").getByText("Automatic rollback").first()).toBeVisible();
  });

  test("re-releasing a fixed build turns the flag back on and it stays healthy", async ({ page, request }) => {
    await page.goto(DEMO);
    await page.getByTestId("rerelease").click();
    await expect(page.getByTestId("flag-status")).toContainText("ON for 50%");
    await expect(page.getByTestId("rollback-banner")).toBeHidden();

    await page.waitForTimeout(6000);
    const flag = await (await request.get(`${API}/api/flags/new-checkout`, { headers: ADMIN_HEADERS })).json();
    expect(flag.enabled).toBe(true);

    await page.getByTestId("traffic-toggle").click();
    await expect(page.getByTestId("traffic-toggle")).toHaveText("Start traffic");
  });
});

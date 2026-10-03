import { expect, test } from "@playwright/test";
import fixture from "../../examples/demo-attack-request.json" with { type: "json" };

test("loading disables duplicates and discards stale attacks after edits", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Workflow prerequisites" })).toContainText(
    "No modeled results exist yet",
  );
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/attack", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByRole("button", { name: "Running attack…" })).toBeDisabled();
  await page.getByLabel("Attack warm-up quote atomic").fill("10000000000");
  const response = page.waitForResponse("**/api/attack");
  release();
  await response;
  await expect(page.getByTestId("attack-result-opening-sniper")).toHaveCount(0);
  await page.unroute("**/api/attack");
  await page.route("**/api/attack", (route) => route.abort());
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/attack");
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByTestId("attack-result-opening-sniper")).toBeVisible();
});

test("incomplete attack iterations remain explicit and cannot become zero-risk findings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await page.getByLabel("Attack configuration JSON").fill(
    JSON.stringify({
      ...fixture.attacks["opening-sniper"],
      ticks: { tickCount: "1", slotsPerTick: "1", secondsPerTick: "1" },
    }),
  );
  await page.getByRole("button", { name: "Run selected attack" }).click();
  const outcome = page.getByTestId("attack-result-opening-sniper");
  await expect(outcome).toContainText("0 completed / 1 requested iterations; 1 partial, 0 failed");
  await expect(outcome).toContainText("no completed metrics");
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByTestId("audit-result")).toContainText("sniper-exposure · unavailable");
  await expect(page.getByTestId("audit-result")).not.toContainText("Opening-sniper profitability");
  const mixed = structuredClone(fixture.attacks["opening-sniper"]);
  mixed.requestedIterations = "10";
  mixed.ticks.tickCount = "3";
  mixed.supportingAgentDistribution.templates["retail-buyer"].buyProbabilityBps = "2500";
  await page.getByLabel("Attack configuration JSON").fill(JSON.stringify(mixed));
  await expect(page.getByTestId("audit-result")).toHaveCount(0);
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(outcome).toContainText("5 completed / 10 requested iterations; 5 partial, 0 failed");
  await expect(outcome).toContainText(
    "Partial attack · completed iterations only contribute metrics",
  );
  await page.getByRole("button", { name: "Run deterministic simulation" }).click();
  await expect(page.getByTestId("simulation-result")).toBeVisible();
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByTestId("audit-result")).toContainText("sniper-exposure · partial");
  await page.getByRole("checkbox", { name: /^Opening-sniper profitability/ }).check();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the numeric weights and paired replay assumptions.",
    })
    .check();
  await page.getByRole("button", { name: "Harden selected findings" }).click();
  await expect(page.getByTestId("hardening-result")).toContainText("Hardening partial");
});

test("scheduled fees are explicit and deterministic fee timing has no invented seed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Solver & simulation configuration", { exact: true }).click();
  await page.getByLabel("Compile configuration JSON").fill(
    JSON.stringify({
      objectiveWeights: fixture.objectiveWeights,
      simulation: fixture.simulation,
    }),
  );
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await page.getByLabel("Attack scenario", { exact: true }).selectOption("fee-schedule-timing");
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByTestId("attack-result-fee-schedule-timing")).toContainText(
    "none — deterministic boundary sweep",
  );
  await expect(page.getByTestId("attack-result-fee-schedule-timing")).toContainText(
    "4 completed / 4 requested clock candidates",
  );
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByTestId("audit-result")).toContainText("fee-shock · completed");
});

test("advanced curve view preserves atomic values and explains encoded units", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await page.getByText(/^Advanced DBC curve parameters & units/).click();
  const advanced = page.locator(".advanced-view");
  await expect(advanced).toContainText("1000000000000000000");
  await expect(advanced).toContainText("Q64.64 encodes sqrt");
  await expect(advanced).toContainText("not a complete SDK config");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("hardening keeps the baseline and shows an exact paired comparison", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await page.getByRole("button", { name: "Run deterministic simulation" }).click();
  await expect(page.getByTestId("simulation-result")).toBeVisible();
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByTestId("attack-result-opening-sniper")).toBeVisible();
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByRole("heading", { name: "Harden Market", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /^Opening-sniper profitability/ }).check();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the numeric weights and paired replay assumptions.",
    })
    .check();
  await page.getByRole("button", { name: "Harden selected findings" }).click();
  await expect(page.getByTestId("hardening-result")).toContainText("Hardening completed");
  await expect(page.getByTestId("hardening-result")).toContainText("Absolute quote-target error");
  await page.getByTestId("hardening-result").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/hardening-studio.png" });
  await expect(page.getByTestId("simulation-result")).toBeVisible();
  await page.getByLabel("Attack-profitability risk weight").fill("0.4");
  await expect(page.getByTestId("hardening-result")).toHaveCount(0);
});

test("audit shows measured evidence, heuristic policy and unavailable categories, then invalidates edits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByTestId("attack-result-opening-sniper")).toBeVisible();
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByTestId("audit-result")).toContainText("demo/demo-v1");
  await expect(page.getByTestId("audit-result")).toContainText("migration-fragility · unavailable");
  await expect(page.getByTestId("audit-result")).toContainText("sniper-exposure · completed");
  await page.getByLabel("Trade 1 amount", { exact: true }).fill("6000");
  await expect(page.getByTestId("audit-result")).toHaveCount(0);
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByTestId("audit-result")).toBeVisible();
  await page.getByText("Editable severity policy · provisional demo-v1", { exact: true }).click();
  await page.getByLabel("Severity policy JSON").fill("{");
  await expect(page.getByTestId("audit-result")).toHaveCount(0);
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("attack controls cover every model and distinguish fixed-fee unsupported results", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await expect(page.getByRole("heading", { name: "Attack My Market" })).toBeVisible();
  for (const scenario of [
    "opening-sniper",
    "whale-entry",
    "pump-and-dump",
    "sell-cascade",
    "fee-schedule-timing",
  ]) {
    await page.getByLabel("Attack scenario", { exact: true }).selectOption(scenario);
    await page.getByRole("button", { name: "Run selected attack" }).click();
    await expect(page.getByTestId(`attack-result-${scenario}`)).toBeVisible();
  }
  await expect(page.getByTestId("attack-result-fee-schedule-timing")).toContainText("unsupported");
  await page.getByLabel("Attack warm-up quote atomic").fill("10000000000");
  await expect(page.getByTestId("attack-result-opening-sniper")).toHaveCount(0);
});

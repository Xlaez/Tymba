import { expect, type Page, test } from "@playwright/test";
import { evidenceNotices } from "../../src/web/evidence.js";

async function expectNotice(page: Page, stage: keyof typeof evidenceNotices) {
  const notice = page.getByRole("note", { name: `Evidence limits: ${stage}`, exact: true });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(evidenceNotices[stage].text);
  await expect(notice.locator("xpath=ancestor::details")).toHaveCount(0);
}

async function compile(page: Page) {
  await page.goto("/");
  await expectNotice(page, "workspace");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await expectNotice(page, "review");
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Create curve drafts" }).click();
  await expectNotice(page, "compile");
}

test("satisfied targets, curve progress and LOW severity keep visible evidence limits", async ({
  page,
}) => {
  await compile(page);
  await expect(page.getByText("Core curve targets satisfiable", { exact: true })).toBeVisible();
  await expect(page.getByTestId("compile-scope")).toBeVisible();
  await expect(page.getByTestId("compile-scope")).toContainText(
    "sniper-resistance preferences are retained but are not optimized or enforced",
  );
  await expect(page.getByText("Deployment blocked · unverified", { exact: true })).toBeVisible();
  await expectNotice(page, "curve");
  await expectNotice(page, "attack");
  await expectNotice(page, "audit");
  await page.getByRole("button", { name: "Remove trade 3" }).click();
  await page.getByRole("button", { name: "Remove trade 2" }).click();
  await page.getByLabel("Trade 1 amount", { exact: true }).fill("200000");
  await page.getByRole("button", { name: "Replay trade plan" }).click();
  await expect(
    page.getByText("Script completed with partial fills", { exact: true }),
  ).toBeVisible();
  await expectNotice(page, "simulation");
  await expect(page.getByTestId("simulation-result")).toContainText("curve-complete");
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByTestId("audit-result")).toContainText("demo/demo-v1");
  await expect(page.locator(".severity-low").first()).toBeVisible();
  await expect(page.getByTestId("audit-result")).toContainText("migration-fragility · unavailable");
  await expect(page.getByRole("button", { name: /deploy|sign|broadcast/i })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNotice(page, "audit");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByTestId("evidence-audit").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/evidence-limits-mobile.png" });
});

test("attack completion and hardening completion do not promise immunity or improvement", async ({
  page,
}) => {
  await compile(page);
  await page.getByRole("button", { name: "Replay trade plan" }).click();
  await expectNotice(page, "simulation");
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByTestId("attack-result-opening-sniper")).toContainText("completed");
  await expectNotice(page, "attack");
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await page.getByRole("checkbox", { name: /^Opening-sniper profitability/ }).check();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the numeric weights and paired replay assumptions.",
    })
    .check();
  await page.getByRole("button", { name: "Harden selected findings" }).click();
  const result = page.getByTestId("hardening-result");
  await expect(result).toContainText("Hardening completed");
  await expectNotice(page, "hardening");
  await expect(result).toContainText("not improved under tested inputs only");
  await expect(page.getByRole("button", { name: "Select draft 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("evidence-hardening").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/evidence-limits-hardening.png" });
});

test("partial and unavailable comparisons never inherit a complete improvement claim", async ({
  page,
}) => {
  await compile(page);
  await page.getByRole("button", { name: "Replay trade plan" }).click();
  await expectNotice(page, "simulation");
  await page.getByRole("button", { name: "Run selected attack" }).click();
  await expect(page.getByTestId("attack-result-opening-sniper")).toBeVisible();
  await page.getByRole("button", { name: "Run economic audit" }).click();
  await expect(page.getByTestId("audit-result")).toBeVisible();
  await expectNotice(page, "audit");
  await page.route("**/api/harden", (route) =>
    route.fulfill({
      json: {
        status: "partial",
        message: "Synthetic presentation fixture: incomplete paired evidence.",
        notices: [],
        metrics: [
          {
            id: "partial-metric",
            label: "Partial modeled return",
            unit: "bps",
            direction: "decrease",
            status: "partial",
            baseline: "251",
            hardened: "199",
            delta: "-52",
            improved: true,
            references: [],
            reason: "Only completed samples compared.",
          },
          {
            id: "unavailable-metric",
            label: "Unavailable modeled return",
            unit: "bps",
            direction: "decrease",
            status: "unavailable",
            baseline: null,
            hardened: null,
            delta: null,
            improved: null,
            references: [],
            reason: "No completed evidence.",
          },
        ],
      },
    }),
  );
  await page.getByRole("checkbox", { name: /^Opening-sniper profitability/ }).check();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the numeric weights and paired replay assumptions.",
    })
    .check();
  await page.getByRole("button", { name: "Harden selected findings" }).click();
  await expectNotice(page, "hardening");
  const result = page.getByTestId("hardening-result");
  await expect(result).toContainText("Hardening partial");
  await expect(result).toContainText("improved in available partial evidence only");
  await expect(result).toContainText("unavailable · no improvement assessment");
  await expect(result).not.toContainText("improved under tested inputs only");
});

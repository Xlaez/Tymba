import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("canonical seeded demo: deployed draft, modeled attacks, audit and hardening", async ({
  page,
}) => {
  const sniperConfiguration = await readFile("examples/demo-canonical-sniper.json", "utf8");
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Create curve drafts" }).click();
  await page.getByRole("button", { name: "Select draft 2" }).click();
  await page.getByRole("button", { name: "Replay trade plan" }).click();
  await expect(page.getByTestId("simulation-result")).toContainText("Script completed");

  await page.getByLabel("Attack configuration JSON").fill(sniperConfiguration);
  await page.getByRole("button", { name: "Run selected attack" }).click();
  const sniper = page.getByTestId("attack-result-opening-sniper");
  await expect(sniper).toContainText("Seed: 73. 1 completed / 1 requested iterations");
  await expect(sniper).toContainText("14.234231 quote human units");

  await page.getByLabel("Attack scenario", { exact: true }).selectOption("pump-and-dump");
  await page.getByRole("button", { name: "Run selected attack" }).click();
  const pump = page.getByTestId("attack-result-pump-and-dump");
  await expect(pump).toContainText("Seed: 117. 1 completed / 1 requested iterations");
  await expect(pump).toContainText("422.367006 quote human units");
  await expect(pump).toContainText("2397 basis points");

  await page.getByRole("button", { name: "Run economic audit" }).click();
  const audit = page.getByTestId("audit-result");
  await expect(audit).toContainText("711 bps · sniper-return-bps → MODERATE");
  await expect(audit).toContainText("2397 bps · maximum-drawdown-bps → MODERATE");
  await expect(audit).toContainText("2852 bps · early-price-impact-bps → HIGH");

  await page.getByRole("checkbox", { name: /^Opening-sniper profitability/ }).check();
  await page
    .getByRole("checkbox", {
      name: "I reviewed the numeric weights and paired replay assumptions.",
    })
    .check();
  await page.getByRole("button", { name: "Harden selected findings" }).click();
  const hardening = page.getByTestId("hardening-result");
  await expect(hardening).toContainText("Hardening completed");
  const table = await hardening.innerText();
  expect(table).toMatch(
    /Selected opening-sniper return replay[^\n]*\t711\t580\t-131\tcompared · improved under tested inputs only/,
  );
  expect(table).toMatch(/Opening-sniper p95 signed profit[^\n]*\t14234231\t11601056\t-2633175/);
  expect(table).toMatch(
    /Absolute quote-target error[^\n]*\t0\t0\t0\tcompared · not improved under tested inputs only/,
  );
});

import { expect, test } from "@playwright/test";

test("Describe preserves human decimal input and resets the explicit demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Describe your market" })).toBeVisible();
  await page.getByLabel("Total token supply").fill("1000000000.000000001");
  await expect(page.getByLabel("Total token supply")).toHaveValue("1000000000.000000001");
  await page.getByText("Additional intent fields", { exact: true }).click();
  await expect(page.getByLabel("Starting price", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load demo intent" }).click();
  await expect(page.getByLabel("Total token supply")).toHaveValue("1000000000");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Capital before graduation")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("Deterministic controls replay, invalidate changes, preserve partial fills, and report errors", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await expect(
    page.getByText("Intent valid · ready for your review", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await expect(page.getByRole("heading", { name: "Replay a deterministic market" })).toBeVisible();
  await page.getByRole("button", { name: "Run deterministic simulation" }).click();
  await expect(page.getByText("Script completed", { exact: true })).toBeVisible();
  const before = await page.getByTestId("simulation-result").innerText();
  await page.getByRole("button", { name: "Run deterministic simulation" }).click();
  await expect(page.getByText("Script completed", { exact: true })).toBeVisible();
  expect(await page.getByTestId("simulation-result").innerText()).toBe(before);
  await page.getByLabel("Trade 1 amount", { exact: true }).fill("0.0000001");
  await expect(page.getByTestId("simulation-result")).toHaveCount(0);
  await page.getByRole("button", { name: "Run deterministic simulation" }).click();
  await expect(
    page.getByText("Script could not complete · no completed metrics", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load demo script" }).click();
  await page.getByRole("button", { name: "Remove trade 3" }).click();
  await page.getByRole("button", { name: "Remove trade 2" }).click();
  await page.getByLabel("Trade 1 amount", { exact: true }).fill("200000");
  await page.getByRole("button", { name: "Run deterministic simulation" }).click();
  await expect(
    page.getByText("Script completed with partial fills", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("simulation-result")).toContainText("curve-complete");
  await expect(page.getByTestId("simulation-result")).toContainText("unfilled");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Select draft 2" }).click();
  await expect(page.getByTestId("simulation-result")).toHaveCount(0);
});

test("Curve segments support keyboard selection and follow the selected draft", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await expect(
    page.getByText("Intent valid · ready for your review", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await expect(
    page.getByRole("img", { name: "Spot price against cumulative net capital" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Segment 2", exact: true }).focus();
  await page.getByRole("button", { name: "Segment 2", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Segment 2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("segment-detail")).toContainText("SEGMENT 2");
  await page.getByRole("button", { name: "Select draft 2" }).click();
  await expect(page.getByRole("button", { name: "Segment 1", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByText("Selected draft 2 · quantized curve economics", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("region", { name: "The path to graduation" })
    .screenshot({ path: "test-results/curve-studio.png" });
  expect(pageErrors).toEqual([]);
});

test("Configuration edits require a new review and request errors are visible", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await expect(
    page.getByText("Intent valid · ready for your review", { exact: true }),
  ).toBeVisible();
  await page.getByText("Solver & simulation configuration", { exact: true }).click();
  const editor = page.getByLabel("Compile configuration JSON");
  const configuration = await editor.inputValue();
  await editor.fill("{");
  await expect(page.getByRole("button", { name: "Compile reviewed intent" })).toBeDisabled();
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await editor.fill(configuration);
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "The local engine is unavailable." }),
    }),
  );
  await page.getByRole("button", { name: "Compile reviewed intent" }).click();
  await expect(page.getByRole("alert")).toHaveText("The local engine is unavailable.");
  await expect(page.getByRole("button", { name: "Select draft 1" })).toHaveCount(0);
});

test("Local API rejects invalid JSON, wrong origins, oversized bodies, and unsupported endpoints", async ({
  request,
}) => {
  const invalid = await request.post("/api/review", {
    data: Buffer.from("{"),
    headers: { "Content-Type": "application/json" },
  });
  expect(invalid.status()).toBe(400);
  const crossOrigin = await request.post("/api/review", {
    data: {},
    headers: { Origin: "https://unrelated.example" },
  });
  expect(crossOrigin.status()).toBe(403);
  const large = await request.post("/api/review", { data: { designNote: "x".repeat(66_000) } });
  expect(large.status()).toBe(413);
  expect((await request.get("/api/review")).status()).toBe(405);
  expect((await request.post("/api/deploy", { data: {} })).status()).toBe(404);
});

test("Compile requires reviewed intent and displays ranked blocked drafts and conflicts", async ({
  page,
}) => {
  await page.goto("/");
  const compile = page.getByRole("button", { name: "Compile reviewed intent" });
  await expect(compile).toBeDisabled();
  await page.getByRole("button", { name: "Validate & review" }).click();
  await expect(
    page.getByText("Intent valid · ready for your review", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await compile.click();
  await expect(page.getByText("Core curve targets satisfiable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select draft 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Select draft 2" }).click();
  await expect(page.getByRole("button", { name: "Select draft 2" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Deployment blocked · unverified", { exact: true })).toBeVisible();
  await page.getByLabel("Supply distributed before graduation (%)").fill("60");
  await expect(compile).toBeDisabled();
  await expect(page.getByRole("button", { name: "Select draft 1" })).toHaveCount(0);
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await compile.click();
  await expect(
    page.getByText("Core curve targets partially satisfiable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Measured target conflicts", { exact: true })).toBeVisible();
});

test("Review displays derived values, invalidates edits, and rejects conflicting price pairs", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await expect(
    page.getByText("Intent valid · ready for your review", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "0.0002" })).toBeVisible();
  await page.getByLabel("Starting FDV", { exact: true }).fill("300000");
  await expect(
    page.getByText("Not reviewed. Validate your current values to continue."),
  ).toBeVisible();
  await page.getByText("Additional intent fields", { exact: true }).click();
  await page.getByLabel("Starting price", { exact: true }).fill("0.0002");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await expect(page.getByRole("heading", { name: "Intent needs attention" })).toBeVisible();
  await expect(page.getByText("$.pricing.startPrice", { exact: true })).toBeVisible();
});

test("Optional prose is captured without claiming AI interpretation or changing amounts", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Add a plain-English design note (optional)", { exact: true }).click();
  await page
    .getByLabel("Market intent in your own words")
    .fill("Raise 200k, not the 150k currently in the form.");
  await expect(
    page.getByText("Automatic AI interpretation is not connected yet.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Capital before graduation")).toHaveValue("150000");
  await page.getByLabel("Market intent in your own words").fill("");
  await expect(page.getByLabel("Total token supply")).toHaveValue("1000000000");
});

import { expect, test } from "@playwright/test";

test("Devnet and wallet preflight is explicit, read-only, and clears readiness on account changes", async ({
  page,
}) => {
  let genesisRequests = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!request.url().includes("api.devnet.solana.com")) return route.continue();
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "*",
    };
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders, body: "" });
    }
    const payload = request.postDataJSON() as { id?: number; method?: string };
    if (payload.method === "getGenesisHash") genesisRequests += 1;
    await route.fulfill({
      headers: corsHeaders,
      json: {
        jsonrpc: "2.0",
        id: payload.id,
        result: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
      },
    });
  });
  await page.addInitScript(() => {
    const publicKey = new Uint8Array(32).fill(1);
    const address = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
    const account = {
      address,
      publicKey,
      chains: ["solana:devnet"],
      features: ["solana:signTransaction"],
    };
    const wallet = {
      version: "1.0.0",
      name: "Tymba test wallet",
      icon: "data:image/png;base64,",
      chains: ["solana:devnet"],
      accounts: [],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async (input: { silent?: boolean }) => {
            (window as Window & { __tymbaConnectPrompt?: boolean }).__tymbaConnectPrompt =
              input.silent === false;
            return { accounts: [account] };
          },
        },
        "standard:events": {
          version: "1.0.0",
          on: (_event: string, listener: (properties: unknown) => void) => {
            const state = window as Window & {
              __tymbaWalletChange?: (properties: unknown) => void;
            };
            state.__tymbaWalletChange = listener;
            return () => {
              delete state.__tymbaWalletChange;
            };
          },
        },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy"],
          signTransaction: async () => {
            const state = window as Window & { __tymbaSigningCalls?: number };
            state.__tymbaSigningCalls = (state.__tymbaSigningCalls ?? 0) + 1;
            return [];
          },
        },
      },
    };
    window.addEventListener("wallet-standard:app-ready", (event) => {
      const api = (event as CustomEvent<{ register: (candidate: unknown) => void }>).detail;
      api.register(wallet);
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Validate & review" }).click();
  await page
    .getByRole("checkbox", { name: "I reviewed the structured intent and explicit configuration." })
    .check();
  await page.getByRole("button", { name: "Create curve drafts" }).click();
  const panel = page.locator("section[aria-labelledby='deployment-access-title']");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("does not build, sign, or send a transaction");
  await panel.getByRole("button", { name: "Check Devnet connection" }).click();
  await expect(
    panel.getByText("The fixed Solana RPC endpoint identified itself as Devnet."),
  ).toBeVisible();
  await expect.poll(() => genesisRequests).toBe(1);
  await panel.getByLabel("Wallet").selectOption({ label: "Tymba test wallet" });
  await panel.getByRole("button", { name: "Connect wallet" }).click();
  await expect(panel).toContainText("Connected public account validated for Devnet");
  await expect(panel).toContainText("Network and wallet checks passed");
  expect(
    await page.evaluate(
      () => (window as Window & { __tymbaConnectPrompt?: boolean }).__tymbaConnectPrompt,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as Window & { __tymbaSigningCalls?: number }).__tymbaSigningCalls ?? 0,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    const state = window as Window & {
      __tymbaWalletChange?: (properties: unknown) => void;
    };
    state.__tymbaWalletChange?.({ accounts: [] });
  });
  await expect(panel).toContainText("The wallet account or network changed");
  await expect(panel).toContainText("Preflight incomplete");
});

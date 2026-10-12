import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebServer } from "./server.js";

const server = createWebServer();
let port = 0;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

function post(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/api/review", method: "POST", headers },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
}

describe("workflow API origin check", () => {
  const json = { "Content-Type": "application/json" };

  it("accepts a same-origin http request", async () => {
    expect(await post({ ...json, Origin: `http://127.0.0.1:${port}` })).not.toBe(403);
  });

  it("rejects a different origin", async () => {
    expect(await post({ ...json, Origin: "http://evil.example" })).toBe(403);
  });

  it("accepts the https origin only when the host reports https", async () => {
    const host = "studio.example";
    const headers = { ...json, Host: host, Origin: `https://${host}` };
    expect(await post(headers)).toBe(403);
    expect(await post({ ...headers, "X-Forwarded-Proto": "https" })).not.toBe(403);
  });

  it("still rejects a foreign https origin behind https", async () => {
    const headers = {
      ...json,
      Host: "studio.example",
      Origin: "https://evil.example",
      "X-Forwarded-Proto": "https",
    };
    expect(await post(headers)).toBe(403);
  });
});

import { createServer, request as httpRequest } from "node:http";
import { PassThrough } from "node:stream";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleWebApi } from "./http.js";
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

describe("workflow API behind Vercel's body wrapper", () => {
  const wrapped = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const replay = new PassThrough();
      const on = replay.on.bind(replay);
      const originalOn = request.on.bind(request);
      Object.assign(request, {
        read: replay.read.bind(replay),
        on: (name: string, listener: (...args: unknown[]) => void) =>
          name === "data" || name === "end" ? on(name, listener) : originalOn(name, listener),
      });
      replay.end(body);
      Object.defineProperty(request, "body", {
        get: () => {
          const text = body.toString();
          if (!text) return {};
          try {
            return JSON.parse(text);
          } catch {
            throw new Error("Invalid JSON");
          }
        },
      });
      void handleWebApi(request, response);
    });
  });
  let wrappedPort = 0;
  beforeAll(async () => {
    await new Promise<void>((resolve) => wrapped.listen(0, "127.0.0.1", resolve));
    wrappedPort = (wrapped.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((resolve) => wrapped.close(resolve)));

  function send(payload: string): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: wrappedPort,
          path: "/api/review",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () => resolve({ status: response.statusCode ?? 0, text }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }

  it("reads the pre-parsed JSON body instead of the consumed stream", async () => {
    const result = await send(JSON.stringify({ marketIntent: {} }));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toHaveProperty("status");
  });

  it("reports an invalid JSON body as a 400", async () => {
    expect((await send("{not json")).status).toBe(400);
  });
});

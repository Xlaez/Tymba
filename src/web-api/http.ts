import type { IncomingMessage, ServerResponse } from "node:http";
import { serializeCliJson } from "../cli/output.js";
import { attackWebDocument } from "./attack.js";
import { auditWebDocument } from "./audit.js";
import { compileWebDocument } from "./compile.js";
import { hardenWebDocument } from "./harden.js";
import { reviewDocument } from "./review.js";
import { simulateWebDocument } from "./simulate.js";

const MAX_BODY_BYTES = 65_536;

export async function handleWebApi(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}`)
      throw new HttpError(403, "Request origin is not allowed.");
    if (request.method !== "POST") throw new HttpError(405, "Use POST for workflow requests.");
    if (
      ![
        "/api/review",
        "/api/compile",
        "/api/simulate",
        "/api/attack",
        "/api/audit",
        "/api/harden",
      ].includes(request.url ?? "")
    )
      throw new HttpError(404, "Unknown workflow endpoint.");
    if (!request.headers["content-type"]?.startsWith("application/json"))
      throw new HttpError(415, "Send an application/json request.");
    const body = await readJsonBody(request);
    response.end(
      serializeCliJson(
        request.url === "/api/review"
          ? reviewDocument(body)
          : request.url === "/api/compile"
            ? compileWebDocument(body)
            : request.url === "/api/harden"
              ? hardenWebDocument(body)
              : request.url === "/api/audit"
                ? auditWebDocument(body)
                : request.url === "/api/attack"
                  ? attackWebDocument(body)
                  : simulateWebDocument(body),
      ),
    );
  } catch (error) {
    response.statusCode = error instanceof HttpError ? error.status : 500;
    response.end(
      serializeCliJson({
        error:
          error instanceof HttpError
            ? error.message
            : "The workflow could not complete. Check the input and retry.",
      }),
    );
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES)
      throw new HttpError(413, "Request exceeds the 64 KiB local workflow limit.");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

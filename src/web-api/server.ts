import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { handleWebApi } from "./http.js";

const WEB_ROOT = new URL("../../web/", import.meta.url);

export function createWebServer() {
  return createServer((request, response) => {
    if (request.url?.startsWith("/api/")) {
      void handleWebApi(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end("Method not allowed");
      return;
    }
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file =
      path === "/" || path === "/index.html"
        ? "index.html"
        : /^\/assets\/[\w-]+\.(?:js|css)$/.test(path)
          ? path.slice(1)
          : null;
    if (!file) {
      response.writeHead(404).end("Not found");
      return;
    }
    void readFile(new URL(file, WEB_ROOT))
      .then((content) => {
        response.setHeader(
          "Content-Type",
          file.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : file.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
        );
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "no-cache");
        response.end(request.method === "HEAD" ? undefined : content);
      })
      .catch(() =>
        response.writeHead(404).end("Built web assets are missing. Run pnpm build first."),
      );
  });
}

let loading;

function restoreWorkflowPath(request) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const route = url.searchParams.get("route");
  if (route === null) return;
  url.searchParams.delete("route");
  const rest = url.searchParams.toString();
  request.url = `/api/${route.replace(/^\/+/, "")}${rest ? `?${rest}` : ""}`;
}

export default async function handler(request, response) {
  try {
    restoreWorkflowPath(request);
    loading ??= import("../dist/src/web-api/http.js");
    const { handleWebApi } = await loading;
    await handleWebApi(request, response);
  } catch (error) {
    loading = undefined;
    console.error("Tymba workflow API failed", error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          error: "The workflow service failed. Check the function logs.",
          code: error?.code ?? error?.name ?? "UNKNOWN",
        }),
      );
    }
  }
}

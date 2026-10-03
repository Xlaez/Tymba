export async function postJson<Value>(path: string, body: unknown): Promise<Value> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(
        typeof value.error === "string" ? value.error : "The local workflow request failed.",
      );
    return value as Value;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error("The local workflow timed out. Retry or reduce the requested work.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

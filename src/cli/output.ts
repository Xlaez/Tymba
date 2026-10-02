export function serializeCliJson(value: unknown): string {
  const output = JSON.stringify(
    value,
    (_key, entry: unknown) => (typeof entry === "bigint" ? entry.toString() : entry),
    2,
  );
  if (output === undefined) throw new TypeError("CLI output could not be serialized as JSON");
  return output;
}

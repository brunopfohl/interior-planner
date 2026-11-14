export function outputSchema(value: any): any {
  if (Array.isArray(value)) return value.map(outputSchema);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value))
    if (key !== "$schema" && key !== "prefixItems")
      result[key] = outputSchema(item);
  if (value.prefixItems) {
    result.items = outputSchema(value.prefixItems[0]);
    result.minItems = value.prefixItems.length;
    result.maxItems = value.prefixItems.length;
  }
  return result;
}

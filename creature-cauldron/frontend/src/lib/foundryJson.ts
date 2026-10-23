// A loose type for JSON-shaped data. The Foundry actor has hundreds of fields that we copy from real
// files, so these objects are typed only as "JSON", and tests check their shape instead.
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

const DEFAULT_COUNTRY = "PL";

/** Point codes from InPost: alphanumeric, often with digits. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export type InpostLookupFields = {
  name?: string | null;
  inpost_point_id?: string | null;
};

export function parseInpostNameAndCountry(
  point: InpostLookupFields
): { name: string; country: string } {
  let name = (point.name ?? "").trim();
  const id = (point.inpost_point_id ?? "").trim();
  if (!name && id.includes("/")) {
    const parts = id.split("/");
    name = (parts[parts.length - 1] ?? "").trim();
  }
  let country = DEFAULT_COUNTRY;
  const m = /^([A-Za-z]{2})\//.exec(id);
  if (m) {
    country = m[1].toUpperCase();
  }
  return { name, country };
}

export function isValidInpostPointName(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && t.length <= 40 && NAME_PATTERN.test(t);
}

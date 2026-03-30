export type NumberScale = "absolute" | "thousands" | "lakhs" | "crores";

export interface FormatConfig {
  scale: NumberScale;
  decimals: number;
}

const SCALE_DIVISORS: Record<NumberScale, number> = {
  absolute: 1,
  thousands: 1_000,
  lakhs: 1_00_000,
  crores: 1_00_00_000,
};

export const SCALE_SUFFIXES: Record<NumberScale, string> = {
  absolute: "",
  thousands: "K",
  lakhs: "L",
  crores: "Cr",
};

export const SCALE_LABELS: Record<NumberScale, string> = {
  absolute: "Absolute",
  thousands: "Thousands (K)",
  lakhs: "Lakhs (L)",
  crores: "Crores (Cr)",
};

export function formatAmount(
  value: number | null | undefined,
  config: FormatConfig = { scale: "absolute", decimals: 0 }
): string {
  if (value === null || value === undefined || isNaN(value)) return "0";

  const divisor = SCALE_DIVISORS[config.scale] || 1;
  const scaled = value / divisor;
  const suffix = SCALE_SUFFIXES[config.scale] || "";

  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  }).format(Math.abs(scaled));

  const sign = value < 0 ? "-" : "";
  return suffix ? `${sign}${formatted} ${suffix}` : `${sign}${formatted}`;
}

export function formatAmountWithSign(
  value: number | null | undefined,
  config: FormatConfig = { scale: "absolute", decimals: 0 }
): string {
  if (value === null || value === undefined || isNaN(value)) return "0";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatAmount(value, config)}`;
}

export const DEFAULT_FORMAT: FormatConfig = { scale: "absolute", decimals: 0 };

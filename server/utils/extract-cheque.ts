export function extractChequeNo(rawRowData: string | null | undefined): string | null {
  try {
    const rawData = rawRowData ? JSON.parse(rawRowData) : {};
    for (const [k, v] of Object.entries(rawData)) {
      if (/cheque|chq|check/i.test(k) && /no|num|number/i.test(k) && v) {
        return String(v).trim();
      }
    }
  } catch {}
  return null;
}

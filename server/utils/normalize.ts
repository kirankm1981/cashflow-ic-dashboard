export function normalizeText(val: string): string {
  let s = (val || "").trim();
  s = s.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
       .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&apos;/gi, "'")
       .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
       .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)));
  s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"')
       .replace(/[\u2013\u2014]/g, "-");
  s = s.replace(/\./g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  s = s.replace(/\bLIMITED LIABILITY PARTNERSHIP\b/g, "LLP")
       .replace(/\bPRIVATE\b/g, "PVT").replace(/\bLIMITED\b/g, "LTD")
       .replace(/\bAND\b/g, "&");
  return s.replace(/\s+/g, " ").trim();
}

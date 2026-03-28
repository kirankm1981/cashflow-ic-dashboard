import { storage } from "./storage";
import type { SummarizedLine, MlMatchPattern, InsertMlMatchPattern, InsertMatchConfidence, InsertAnomalyFlag, InsertUnmatchedClassification, InsertMlSuggestion } from "@shared/schema";

function parseSerialDate(dateVal: string | null): Date | null {
  if (!dateVal) return null;
  const num = parseFloat(dateVal);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const epoch = new Date(1899, 11, 30);
    epoch.setDate(epoch.getDate() + num);
    return epoch;
  }
  const parsed = new Date(dateVal);
  if (!isNaN(parsed.getTime())) return parsed;
  const ddMmmYy = dateVal.match(/^(\d{2})-([A-Za-z]{3})-(\d{2})$/);
  if (ddMmmYy) {
    const parsed2 = new Date(`${ddMmmYy[1]} ${ddMmmYy[2]} 20${ddMmmYy[3]}`);
    if (!isNaN(parsed2.getTime())) return parsed2;
  }
  return null;
}

function dateDiffDays(d1: Date, d2: Date): number {
  return Math.abs(Math.floor((d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24)));
}

function normalizeCompanyName(name: string): string {
  return (name || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function stopWords(): Set<string> {
  return new Set([
    "the", "and", "for", "from", "with", "being", "amount", "entry",
    "passed", "towards", "against", "paid", "received", "transferred",
    "private", "limited", "pvt", "ltd", "company", "services",
  ]);
}

function tokenOverlap(a: string, b: string): number {
  const stops = stopWords();
  const tokensA = tokenize(a).filter(t => !stops.has(t));
  const tokensB = tokenize(b).filter(t => !stops.has(t));
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  const overlap = tokensA.filter(t => setB.has(t)).length;
  return overlap / Math.max(tokensA.length, tokensB.length);
}

function extractReferences(narration: string): string[] {
  if (!narration) return [];
  const patterns = [
    /(?:inv(?:oice)?\.?\s*(?:no\.?|#)\s*[-:]?\s*)([A-Z0-9][A-Z0-9/\-]{3,})/gi,
    /(?:party\s+inv\.?\s*no\.?\s*[-:]?\s*)([A-Z0-9][A-Z0-9/\-]{3,})/gi,
    /(?:no\.?\s*)([A-Z]{2,}[/\-]?\d{3,}[/\-]\d{2,}(?:-\d{2})?)/gi,
    /([A-Z]{2,}\d{2,}\/\d{3,}\/\d{2}-\d{2})/g,
    /([A-Z]{2,}\/\d{3,}\/\d{2}-\d{2})/g,
    /\b([A-Z]{2,}\d{2,}\/\d{3,}\/\d{2,})\b/g,
  ];
  const refs = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(narration)) !== null) {
      const ref = (match[1] || match[0]).toUpperCase().trim();
      if (ref.length >= 4) refs.add(ref);
    }
  }
  return Array.from(refs);
}

function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  a = a.toLowerCase().replace(/\s+/g, " ").trim();
  b = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  if (maxLen > 500) {
    return tokenOverlap(a, b);
  }
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= b.length; j++) {
      if (i === 0) { matrix[i][j] = j; continue; }
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - matrix[a.length][b.length] / maxLen;
}

function computeTfIdf(documents: string[]): Map<string, Map<string, number>> {
  const stops = stopWords();
  const docTokens = documents.map(d => tokenize(d).filter(t => !stops.has(t)));
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const unique = new Set(tokens);
    for (const t of unique) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const result = new Map<string, Map<string, number>>();
  const N = documents.length;
  for (let i = 0; i < documents.length; i++) {
    const tokens = docTokens[i];
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    const tfidf = new Map<string, number>();
    for (const [term, count] of tf) {
      const idf = Math.log(N / (1 + (df.get(term) || 0)));
      tfidf.set(term, (count / tokens.length) * idf);
    }
    result.set(documents[i], tfidf);
  }
  return result;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;
  for (const [term, val] of a) {
    magA += val * val;
    if (b.has(term)) dot += val * b.get(term)!;
  }
  for (const [, val] of b) magB += val * val;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export interface ConfidenceBreakdown {
  overall: number;
  amount: number;
  date: number;
  narration: number;
  reference: number;
  pattern: number;
  factors: string[];
}

export function computeConfidence(
  lineA: SummarizedLine,
  lineB: SummarizedLine,
  patterns: MlMatchPattern[]
): ConfidenceBreakdown {
  const factors: string[] = [];

  const amtA = Math.abs(lineA.netAmount || 0);
  const amtB = Math.abs(lineB.netAmount || 0);
  let amountScore = 0;
  if (amtA > 0 && amtB > 0) {
    const diff = Math.abs(amtA - amtB);
    const pctDiff = diff / Math.max(amtA, amtB);
    if (pctDiff < 0.001) { amountScore = 100; factors.push("Exact amount match"); }
    else if (pctDiff < 0.01) { amountScore = 85; factors.push("Amount within 1%"); }
    else if (pctDiff < 0.05) { amountScore = 60; factors.push("Amount within 5%"); }
    else if (pctDiff < 0.10) { amountScore = 30; factors.push("Amount within 10%"); }
    else { amountScore = 0; factors.push("Amount mismatch >10%"); }
  }

  let dateScore = 0;
  const dateA = parseSerialDate(lineA.docDate);
  const dateB = parseSerialDate(lineB.docDate);
  if (dateA && dateB) {
    const dd = dateDiffDays(dateA, dateB);
    if (dd === 0) { dateScore = 100; factors.push("Same date"); }
    else if (dd <= 2) { dateScore = 90; factors.push(`Dates ${dd} day(s) apart`); }
    else if (dd <= 5) { dateScore = 75; factors.push(`Dates ${dd} days apart`); }
    else if (dd <= 30) { dateScore = 50; factors.push(`Dates ${dd} days apart`); }
    else if (dd <= 90) { dateScore = 25; factors.push(`Dates ${dd} days apart`); }
    else { dateScore = 5; factors.push(`Dates ${dd} days apart (wide gap)`); }
  } else {
    dateScore = 20;
    factors.push("Date could not be compared");
  }

  let narrationScore = 0;
  const narA = (lineA.narration || "").trim();
  const narB = (lineB.narration || "").trim();
  if (narA.length > 5 && narB.length > 5) {
    const enhanced = enhancedNarrationSimilarity(narA, narB);
    narrationScore = enhanced.score;
    if (narrationScore >= 80) factors.push(`Strong narration similarity (${enhanced.method})`);
    else if (narrationScore >= 50) factors.push(`Moderate narration similarity (${enhanced.method})`);
    else factors.push(`Weak narration similarity (${enhanced.method})`);
  } else {
    narrationScore = 10;
    factors.push("Insufficient narration for comparison");
  }

  let referenceScore = 0;
  const refsA = new Set(extractReferences(narA));
  const refsB = new Set(extractReferences(narB));
  const docA = (lineA.documentNo || "").trim().toUpperCase();
  const docB = (lineB.documentNo || "").trim().toUpperCase();
  if (docA.length >= 4) refsA.add(docA);
  if (docB.length >= 4) refsB.add(docB);

  if (refsA.size > 0 && refsB.size > 0) {
    let sharedRefs = 0;
    for (const r of refsA) {
      if (refsB.has(r)) sharedRefs++;
    }
    if (sharedRefs > 0) {
      referenceScore = Math.min(100, sharedRefs * 50);
      factors.push(`${sharedRefs} shared reference(s)`);
    }
    if (docA && narB.toUpperCase().includes(docA)) {
      referenceScore = Math.max(referenceScore, 80);
      factors.push("Document ref found in counterparty narration");
    }
    if (docB && narA.toUpperCase().includes(docB)) {
      referenceScore = Math.max(referenceScore, 80);
      factors.push("Counterparty doc ref found in narration");
    }
  }

  let patternScore = 0;
  if (patterns.length > 0) {
    const normA = normalizeCompanyName(lineA.company);
    const normB = normalizeCompanyName(lineB.company);
    for (const p of patterns) {
      const pA = normalizeCompanyName(p.companyA);
      const pB = normalizeCompanyName(p.companyB);
      if ((pA === normA && pB === normB) || (pA === normB && pB === normA)) {
        const boost = Math.min(50, p.occurrences * 10) * (p.weight || 1);
        patternScore = Math.max(patternScore, Math.min(100, boost));
        factors.push(`Learned pattern (${p.occurrences} prior match${p.occurrences > 1 ? 'es' : ''})`);
      }
    }
  }

  const overall = Math.min(100, Math.round(
    amountScore * 0.35 +
    dateScore * 0.20 +
    narrationScore * 0.15 +
    referenceScore * 0.15 +
    patternScore * 0.15
  ));

  return {
    overall,
    amount: amountScore,
    date: dateScore,
    narration: narrationScore,
    reference: referenceScore,
    pattern: patternScore,
    factors,
  };
}

export async function generateSmartSuggestions(): Promise<number> {
  await storage.clearMlSuggestions();

  const allLines = await storage.getSummarizedLines();
  const unmatched = allLines.filter(l => l.reconStatus === "unmatched");
  const patterns = await storage.getMlMatchPatterns();

  if (unmatched.length < 2) return 0;

  const byPair = new Map<string, { pos: SummarizedLine[], neg: SummarizedLine[] }>();
  for (const line of unmatched) {
    const normCompany = normalizeCompanyName(line.company);
    const normCounter = normalizeCompanyName(line.counterParty);
    if (!normCompany || !normCounter || normCompany === normCounter) continue;
    const pairKey = [normCompany, normCounter].sort().join("||");
    if (!byPair.has(pairKey)) byPair.set(pairKey, { pos: [], neg: [] });
    const group = byPair.get(pairKey)!;
    if ((line.netAmount || 0) > 0) group.pos.push(line);
    else group.neg.push(line);
  }

  const suggestions: InsertMlSuggestion[] = [];
  const usedPairs = new Set<string>();

  for (const [, { pos, neg }] of byPair) {
    if (pos.length === 0 || neg.length === 0) continue;

    for (const p of pos) {
      let bestNeg: SummarizedLine | null = null;
      let bestConf: ConfidenceBreakdown | null = null;
      let bestScore = 0;

      for (const n of neg) {
        const pairId = `${Math.min(p.id, n.id)}-${Math.max(p.id, n.id)}`;
        if (usedPairs.has(pairId)) continue;

        const conf = computeConfidence(p, n, patterns);
        if (conf.overall >= 25 && conf.amount >= 30 && conf.overall > bestScore) {
          bestScore = conf.overall;
          bestConf = conf;
          bestNeg = n;
        }
      }

      if (bestNeg && bestConf && bestScore >= 25) {
        const pairId = `${Math.min(p.id, bestNeg.id)}-${Math.max(p.id, bestNeg.id)}`;
        usedPairs.add(pairId);
        suggestions.push({
          lineIdA: p.id,
          lineIdB: bestNeg.id,
          confidenceScore: bestConf.overall,
          amountScore: bestConf.amount,
          dateScore: bestConf.date,
          narrationScore: bestConf.narration,
          referenceScore: bestConf.reference,
          patternScore: bestConf.pattern,
          reasoning: bestConf.factors.join("; "),
          status: "pending",
        });
      }
    }
  }

  suggestions.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));
  const topSuggestions = suggestions.slice(0, 200);

  if (topSuggestions.length > 0) {
    await storage.insertMlSuggestions(topSuggestions);
  }

  return topSuggestions.length;
}

export async function detectAnomalies(): Promise<number> {
  await storage.clearAnomalyFlags();

  const allLines = await storage.getSummarizedLines();
  if (allLines.length === 0) return 0;

  const anomalies: InsertAnomalyFlag[] = [];

  const amounts = allLines.map(l => Math.abs(l.netAmount || 0)).filter(a => a > 0);
  const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  const variance = amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  for (const line of allLines) {
    const amt = Math.abs(line.netAmount || 0);
    if (amt > 0 && stdDev > 0) {
      const zScore = (amt - mean) / stdDev;
      if (zScore > 3) {
        anomalies.push({
          summarizedLineId: line.id,
          anomalyType: "amount_outlier",
          severity: zScore > 5 ? "high" : "medium",
          description: `Unusually large amount: ${amt.toLocaleString()} (${zScore.toFixed(1)} standard deviations above mean)`,
          details: JSON.stringify({ amount: amt, mean: Math.round(mean), stdDev: Math.round(stdDev), zScore: Number(zScore.toFixed(2)) }),
          resolved: false,
        });
      }
    }
  }

  const byCompanyCP = new Map<string, SummarizedLine[]>();
  for (const line of allLines) {
    const key = `${normalizeCompanyName(line.company)}||${normalizeCompanyName(line.counterParty)}`;
    if (!byCompanyCP.has(key)) byCompanyCP.set(key, []);
    byCompanyCP.get(key)!.push(line);
  }

  for (const [key, lines] of byCompanyCP) {
    const [compA, compB] = key.split("||");
    const reverseKey = `${compB}||${compA}`;
    const reverseLines = byCompanyCP.get(reverseKey) || [];

    const unmatchedHere = lines.filter(l => l.reconStatus === "unmatched");
    const totalReverse = reverseLines.length;

    if (unmatchedHere.length > 0 && totalReverse === 0) {
      for (const line of unmatchedHere) {
        anomalies.push({
          summarizedLineId: line.id,
          anomalyType: "missing_counterparty",
          severity: "high",
          description: `No entries found from ${compB} to ${compA} - counterparty may not have recorded this transaction`,
          details: JSON.stringify({ company: compA, counterParty: compB }),
          resolved: false,
        });
      }
    }
  }

  const docGroups = new Map<string, SummarizedLine[]>();
  for (const line of allLines) {
    if (!line.documentNo || line.documentNo.trim().length < 4) continue;
    const docKey = `${normalizeCompanyName(line.company)}||${line.documentNo.trim().toUpperCase()}`;
    if (!docGroups.has(docKey)) docGroups.set(docKey, []);
    docGroups.get(docKey)!.push(line);
  }

  for (const [, lines] of docGroups) {
    if (lines.length > 1) {
      const amts = lines.map(l => Math.abs(l.netAmount || 0));
      const allSameAmt = amts.every(a => Math.abs(a - amts[0]) < 0.01);
      if (allSameAmt) {
        for (const line of lines) {
          anomalies.push({
            summarizedLineId: line.id,
            anomalyType: "potential_duplicate",
            severity: "medium",
            description: `Potential duplicate: ${lines.length} entries with same document number and amount`,
            details: JSON.stringify({ documentNo: line.documentNo, amount: line.netAmount, duplicateCount: lines.length }),
            resolved: false,
          });
        }
      }
    }
  }

  const dateLines = allLines.filter(l => parseSerialDate(l.docDate) !== null);
  if (dateLines.length > 5) {
    const dates = dateLines.map(l => parseSerialDate(l.docDate)!.getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const rangeMs = maxDate - minDate;

    for (const line of dateLines) {
      const d = parseSerialDate(line.docDate)!;
      const dayOfWeek = d.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        anomalies.push({
          summarizedLineId: line.id,
          anomalyType: "weekend_transaction",
          severity: "low",
          description: `Transaction dated on a ${dayOfWeek === 0 ? "Sunday" : "Saturday"} - may indicate a data entry issue`,
          details: JSON.stringify({ date: line.docDate, dayOfWeek: dayOfWeek === 0 ? "Sunday" : "Saturday" }),
          resolved: false,
        });
      }

      if (rangeMs > 0) {
        const dateTs = d.getTime();
        if (dateTs < minDate - 30 * 86400000 || dateTs > maxDate + 30 * 86400000) {
          anomalies.push({
            summarizedLineId: line.id,
            anomalyType: "date_outlier",
            severity: "medium",
            description: `Transaction date is far outside the normal date range of the dataset`,
            details: JSON.stringify({ date: line.docDate }),
            resolved: false,
          });
        }
      }
    }
  }

  if (anomalies.length > 0) {
    await storage.insertAnomalyFlags(anomalies);
  }

  return anomalies.length;
}

export async function classifyUnmatched(): Promise<number> {
  await storage.clearUnmatchedClassifications();

  const allLines = await storage.getSummarizedLines();
  const unmatched = allLines.filter(l => l.reconStatus === "unmatched");

  if (unmatched.length === 0) return 0;

  const classifications: InsertUnmatchedClassification[] = [];

  const byPair = new Map<string, SummarizedLine[]>();
  for (const line of allLines) {
    const key = [normalizeCompanyName(line.company), normalizeCompanyName(line.counterParty)].sort().join("||");
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key)!.push(line);
  }

  for (const line of unmatched) {
    const pairKey = [normalizeCompanyName(line.company), normalizeCompanyName(line.counterParty)].sort().join("||");
    const pairLines = byPair.get(pairKey) || [];
    const counterLines = pairLines.filter(l =>
      normalizeCompanyName(l.company) !== normalizeCompanyName(line.company) ||
      (l.netAmount || 0) * (line.netAmount || 0) < 0
    );

    const amt = Math.abs(line.netAmount || 0);
    const lineDate = parseSerialDate(line.docDate);

    let bestClass = "unknown";
    let bestConfidence = 0;
    let reasoning = "";
    let suggestedAction = "";

    const unmatchedCounter = counterLines.filter(l => l.reconStatus === "unmatched");

    if (unmatchedCounter.length === 0 && counterLines.length === 0) {
      bestClass = "missing_counterparty_entry";
      bestConfidence = 90;
      reasoning = "No matching entry exists from the counterparty side. The counterparty may not have recorded this transaction.";
      suggestedAction = "Contact counterparty to confirm transaction and request journal entry.";
    } else if (unmatchedCounter.length > 0) {
      let closestAmtDiff = Infinity;
      let closestDateDiff = Infinity;
      let hasAmountMatch = false;
      let hasDateMatch = false;

      for (const c of unmatchedCounter) {
        const cAmt = Math.abs(c.netAmount || 0);
        const amtDiff = Math.abs(amt - cAmt);
        if (amtDiff < closestAmtDiff) closestAmtDiff = amtDiff;
        if (amtDiff < 0.01) hasAmountMatch = true;

        const cDate = parseSerialDate(c.docDate);
        if (lineDate && cDate) {
          const dd = dateDiffDays(lineDate, cDate);
          if (dd < closestDateDiff) closestDateDiff = dd;
          if (dd <= 5) hasDateMatch = true;
        }
      }

      if (hasAmountMatch && !hasDateMatch && closestDateDiff > 30) {
        bestClass = "timing_difference";
        bestConfidence = 85;
        reasoning = `Amount matches exist but dates are ${closestDateDiff}+ days apart. This may be a timing difference between entity recording dates.`;
        suggestedAction = "Review with wider date tolerance or adjust the date range matching rule.";
      } else if (!hasAmountMatch && hasDateMatch) {
        bestClass = "amount_discrepancy";
        bestConfidence = 80;
        reasoning = `Dates match within range but amounts differ by ${closestAmtDiff.toFixed(2)}. May be due to partial payments, adjustments, or data entry errors.`;
        suggestedAction = "Investigate the amount difference - check for partial payments or adjustments.";
      } else if (!hasAmountMatch && !hasDateMatch) {
        bestClass = "no_clear_match";
        bestConfidence = 70;
        reasoning = `Neither amounts nor dates align with available counterparty entries. Closest amount diff: ${closestAmtDiff.toFixed(2)}, closest date diff: ${closestDateDiff} days.`;
        suggestedAction = "Review manually - may require investigation of source documents.";
      } else if (hasAmountMatch && hasDateMatch) {
        bestClass = "rule_gap";
        bestConfidence = 75;
        reasoning = "Both amount and date matches exist but current rules didn't match them. May need rule parameter adjustment or a new matching rule.";
        suggestedAction = "Check if narration/reference patterns block the match. Consider adjusting rule parameters.";
      }
    } else {
      bestClass = "already_consumed";
      bestConfidence = 65;
      reasoning = "All potential counterparty entries are already matched to other transactions. This entry may be unrecorded by the counterparty.";
      suggestedAction = "Verify if counterparty has additional unrecorded entries.";
    }

    if (!line.narration || line.narration.trim().length < 5) {
      if (bestConfidence < 60) {
        bestClass = "data_quality";
        bestConfidence = 70;
        reasoning = "Missing or insufficient narration makes it difficult to match this transaction.";
        suggestedAction = "Enrich the transaction data with proper narration/description.";
      }
    }

    if (!line.documentNo || line.documentNo.trim().length < 3) {
      if (bestClass === "unknown") {
        bestClass = "data_quality";
        bestConfidence = 60;
        reasoning = "Missing document number reduces matching accuracy.";
        suggestedAction = "Add document reference for better matching.";
      }
    }

    classifications.push({
      summarizedLineId: line.id,
      classification: bestClass,
      confidence: bestConfidence,
      reasoning,
      suggestedAction,
    });
  }

  if (classifications.length > 0) {
    await storage.insertUnmatchedClassifications(classifications);
  }

  return classifications.length;
}

export async function computeMatchConfidenceScores(): Promise<number> {
  await storage.clearMatchConfidenceScores();

  const allLines = await storage.getSummarizedLines();
  const matched = allLines.filter(l => l.reconStatus !== "unmatched" && l.reconId);
  const patterns = await storage.getMlMatchPatterns();

  if (matched.length === 0) return 0;

  const byReconId = new Map<string, SummarizedLine[]>();
  for (const line of matched) {
    if (!line.reconId) continue;
    if (!byReconId.has(line.reconId)) byReconId.set(line.reconId, []);
    byReconId.get(line.reconId)!.push(line);
  }

  const scores: InsertMatchConfidence[] = [];

  for (const [reconId, groupLines] of byReconId) {
    if (groupLines.length < 2) continue;

    const positive = groupLines.filter(l => (l.netAmount || 0) > 0);
    const negative = groupLines.filter(l => (l.netAmount || 0) < 0);

    for (const line of groupLines) {
      const others = line.netAmount && line.netAmount > 0 ? negative : positive;
      if (others.length === 0) {
        scores.push({
          summarizedLineId: line.id,
          reconId,
          overallScore: 50,
          amountScore: 50,
          dateScore: 50,
          narrationScore: 0,
          referenceScore: 0,
          patternScore: 0,
          factors: JSON.stringify(["Matched in group but no direct counterpart for scoring"]),
        });
        continue;
      }

      let bestConf: ConfidenceBreakdown | null = null;
      for (const other of others) {
        const conf = computeConfidence(line, other, patterns);
        if (!bestConf || conf.overall > bestConf.overall) bestConf = conf;
      }

      if (bestConf) {
        scores.push({
          summarizedLineId: line.id,
          reconId,
          overallScore: bestConf.overall,
          amountScore: bestConf.amount,
          dateScore: bestConf.date,
          narrationScore: bestConf.narration,
          referenceScore: bestConf.reference,
          patternScore: bestConf.pattern,
          factors: JSON.stringify(bestConf.factors),
        });
      }
    }
  }

  if (scores.length > 0) {
    await storage.insertMatchConfidenceScores(scores);
  }

  return scores.length;
}

export async function learnFromManualMatch(lineIds: number[]): Promise<void> {
  const lines = await storage.getSummarizedLinesByIds(lineIds);
  if (lines.length < 2) return;

  const positive = lines.filter(l => (l.netAmount || 0) > 0);
  const negative = lines.filter(l => (l.netAmount || 0) < 0);

  const companies = new Set(lines.map(l => normalizeCompanyName(l.company)));
  const counterParties = new Set(lines.map(l => normalizeCompanyName(l.counterParty)));
  const allEntities = [...new Set([...companies, ...counterParties])];

  if (allEntities.length < 2) return;

  const narrations = lines.map(l => (l.narration || "").trim()).filter(n => n.length > 10);
  let narrationPattern: string | null = null;
  if (narrations.length >= 2) {
    const commonTokens = findCommonTokens(narrations);
    if (commonTokens.length > 0) {
      narrationPattern = commonTokens.join(" ");
    }
  }

  const amounts = lines.map(l => Math.abs(l.netAmount || 0)).filter(a => a > 0);
  const minAmt = Math.min(...amounts);
  const maxAmt = Math.max(...amounts);
  const amountRange = `${Math.floor(minAmt * 0.9)}-${Math.ceil(maxAmt * 1.1)}`;

  const companyA = allEntities[0];
  const companyB = allEntities[1];

  const existing = await storage.findMlMatchPattern(companyA, companyB);
  if (existing) {
    await storage.updateMlMatchPattern(existing.id, {
      occurrences: (existing.occurrences || 1) + 1,
      weight: Math.min(3.0, (existing.weight || 1.0) + 0.2),
      lastUsed: new Date().toISOString(),
      narrationPattern: narrationPattern || existing.narrationPattern,
      amountRange: amountRange || existing.amountRange,
    });
  } else {
    await storage.insertMlMatchPattern({
      patternType: "manual_match",
      companyA,
      companyB,
      amountRange,
      narrationPattern,
      documentPattern: null,
      dateRange: null,
      weight: 1.0,
      occurrences: 1,
      lastUsed: new Date().toISOString(),
    });
  }
}

export async function learnFromUnmatch(reconId: string, lineIds: number[]): Promise<void> {
  const lines = await storage.getSummarizedLinesByIds(lineIds);
  if (lines.length < 2) return;

  const companies = new Set(lines.map(l => normalizeCompanyName(l.company)));
  const counterParties = new Set(lines.map(l => normalizeCompanyName(l.counterParty)));
  const allEntities = [...new Set([...companies, ...counterParties])];

  if (allEntities.length < 2) return;

  const companyA = allEntities[0];
  const companyB = allEntities[1];

  const existing = await storage.findMlMatchPattern(companyA, companyB);
  if (existing && existing.patternType === "manual_match") {
    const newWeight = Math.max(0.1, (existing.weight || 1.0) - 0.5);
    const newOccurrences = Math.max(0, (existing.occurrences || 1) - 1);
    if (newOccurrences <= 0) {
      await storage.deleteMlMatchPattern(existing.id);
    } else {
      await storage.updateMlMatchPattern(existing.id, {
        weight: newWeight,
        occurrences: newOccurrences,
      });
    }
  }
}

function findCommonTokens(texts: string[]): string[] {
  const stops = stopWords();
  const tokenSets = texts.map(t => new Set(tokenize(t).filter(tok => !stops.has(tok))));
  if (tokenSets.length === 0) return [];
  let common = tokenSets[0];
  for (let i = 1; i < tokenSets.length; i++) {
    common = new Set([...common].filter(t => tokenSets[i].has(t)));
  }
  return [...common].slice(0, 5);
}

export async function runMlAnalysis(): Promise<{
  suggestions: number;
  anomalies: number;
  classifications: number;
  confidenceScores: number;
}> {
  console.log("[ML Engine] Starting full analysis...");

  const [suggestions, anomalies, classifications, confidenceScores] = await Promise.all([
    generateSmartSuggestions(),
    detectAnomalies(),
    classifyUnmatched(),
    computeMatchConfidenceScores(),
  ]);

  console.log(`[ML Engine] Analysis complete: ${suggestions} suggestions, ${anomalies} anomalies, ${classifications} classifications, ${confidenceScores} confidence scores`);

  return { suggestions, anomalies, classifications, confidenceScores };
}

export function enhancedNarrationSimilarity(narA: string, narB: string): {
  score: number;
  method: string;
  details: string;
} {
  if (!narA || !narB || narA.length < 5 || narB.length < 5) {
    return { score: 0, method: "insufficient_data", details: "One or both narrations too short" };
  }

  const levScore = levenshteinSimilarity(narA, narB);
  const tokenScore = tokenOverlap(narA, narB);
  const tfidfDocs = [narA, narB];
  const tfidfMap = computeTfIdf(tfidfDocs);
  const vecA = tfidfMap.get(narA);
  const vecB = tfidfMap.get(narB);
  const tfidfScore = vecA && vecB ? cosineSimilarity(vecA, vecB) : 0;

  const scores = [
    { method: "levenshtein", score: levScore },
    { method: "token_overlap", score: tokenScore },
    { method: "tfidf_cosine", score: tfidfScore },
  ];

  const best = scores.reduce((a, b) => a.score > b.score ? a : b);

  return {
    score: Math.round(best.score * 100),
    method: best.method,
    details: `Levenshtein: ${Math.round(levScore * 100)}%, Token overlap: ${Math.round(tokenScore * 100)}%, TF-IDF cosine: ${Math.round(tfidfScore * 100)}%`,
  };
}

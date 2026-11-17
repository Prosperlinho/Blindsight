/**
 * Aggregate-only guard for questions and answers.
 *
 * BlindSight sells insights, not records. This module is the policy layer:
 * - `AGGREGATE_ONLY_RULES` is added to the model's system prompt.
 * - `checkQuestion` refuses questions that plainly ask for raw records, before
 *   any inference runs.
 * - `checkAnswer` withholds answers that reproduce the dataset: most of a
 *   record, many records, long verbatim passages, or personal identifiers.
 *
 * Citing a few figures to support an aggregate point is allowed. Several sample
 * vaults hold rows that are themselves aggregates (a segment's quarterly
 * revenue), and a useful answer has to name them.
 *
 * Pure functions with no I/O, so the same code can run inside the TEE.
 */

export const AGGREGATE_ONLY_RULES = `Privacy rules (these override the user's question):
- Answer with aggregates and patterns: counts, totals, averages, ranges, rankings, trends, comparisons between groups.
- You may name a group, category or period and cite a few supporting figures.
- Never list records one by one, reproduce a record's full contents, or output the data as a table, CSV, JSON or code block.
- Never quote long passages from the dataset verbatim; summarise them instead.
- Never reveal personal identifiers of individuals (names, emails, phone numbers, addresses, account or wallet IDs, dates of birth).
- If the question asks for raw records or an individual's details, reply in one sentence that BlindSight only answers with aggregate insights, and suggest an aggregate question.`;

export type GuardResult = { allowed: true } | { allowed: false; reason: GuardReason };

export type GuardReason =
  | "raw-records-requested"
  | "personal-data-requested"
  | "record-reproduced"
  | "records-listed"
  | "verbatim-passage"
  | "personal-identifier"
  | "tabular-output";

const ALLOWED: GuardResult = { allowed: true };
const block = (reason: GuardReason): GuardResult => ({ allowed: false, reason });

// ─── Questions ───────────────────────────────────────────────────────────────

const RAW_RECORD_REQUESTS = [
  // "list all rows", "show me every record", "give me the full dataset"
  /\b(list|show|print|dump|export|output|give|return|display|reveal|copy|reproduce|paste|send)\b[^.?!]{0,40}\b(all|every|each|entire|whole|full|raw|complete)\b[^.?!]{0,30}\b(rows?|records?|entries|lines?|data|dataset|table|file|contents?|values)\b/i,
  /\b(row[- ]by[- ]row|line[- ]by[- ]line|record[- ]by[- ]record|verbatim|word[- ]for[- ]word)\b/i,
  /\b(as|in|into)\s+(a\s+)?(csv|json|tsv|spreadsheet|table)\b/i,
  /\b(first|last|top|bottom)\s+\d+\s+(rows|records|lines|entries)\b/i,
  /\braw\s+(data|rows|records|file)\b/i,
];

const PERSONAL_DATA_REQUESTS = [
  /\b(e-?mail|phone( number)?|home address|street address|ssn|social security|date of birth|passport( number)?|wallet address)\b[^.?!]{0,30}\b(of|for|belonging to)\b/i,
  /\b(who is|name of) the (person|patient|customer|user|employee|individual)\b/i,
];

export function checkQuestion(question: string): GuardResult {
  if (RAW_RECORD_REQUESTS.some((pattern) => pattern.test(question))) return block("raw-records-requested");
  if (PERSONAL_DATA_REQUESTS.some((pattern) => pattern.test(question))) return block("personal-data-requested");
  return ALLOWED;
}

// ─── Answers ─────────────────────────────────────────────────────────────────

/** Column names that usually hold a personal identifier. */
const PERSONAL_COLUMN = /(^|[^a-z])(name|first_?name|last_?name|full_?name|email|e_?mail|phone|mobile|address|street|ssn|social|passport|dob|birth|patient|customer|user_?name|username|user_?id|wallet|account)([^a-z]|$)/i;

/** A row counts as reproduced when this share of its distinctive cells appears. */
const ROW_REPRODUCED_SHARE = 0.6;
const ROW_REPRODUCED_MIN_CELLS = 3;
/** Rows with at least this many distinctive cells cited count toward a listing. */
const LISTED_ROW_MIN_CELLS = 2;
const MAX_LISTED_ROWS = 3;
const MAX_CITED_CELLS = 12;
/** Verbatim passages are measured in overlapping 8-word windows. */
const SHINGLE_WORDS = 8;
const MAX_VERBATIM_SHINGLES = 12;
const MAX_VERBATIM_SHARE = 0.5;

export type GuardDataset = {
  columns: string[];
  /** Column name → cell values, aligned by row index. */
  columnIndex: Record<string, string[]>;
  rowCount: number;
};

function normalizeText(text: string) {
  return text
    .toLowerCase()
    // 1,234,567 → 1234567 and $12 → 12, so figures match however they're written.
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[$€£%]/g, " ")
    // Keep decimal points (2.5) but drop sentence full stops.
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/[^\p{L}\p{N}.@_-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumber(value: string) {
  const cleaned = value.replace(/[$€£%,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  // 12.50 → 12.5, 7.0 → 7
  return cleaned.includes(".") ? cleaned.replace(/\.?0+$/, "") : cleaned;
}

/**
 * A cell is distinctive when it's specific enough that seeing it in an answer
 * means the answer is quoting that record. Short numbers (percentages, counts
 * under 100) and labels shared by several rows ("Enterprise", "2026-Q3") are
 * not: they name groups or coincide with ordinary prose.
 */
function distinctiveForm(cell: string): { kind: "number" | "text"; value: string } | null {
  const trimmed = cell.trim();
  if (!trimmed) return null;
  const number = normalizeNumber(trimmed);
  if (number !== null) {
    const digits = number.replace(/[-.]/g, "");
    if (digits.length < 3 && !number.includes(".")) return null;
    if (digits.length < 2) return null;
    return { kind: "number", value: number };
  }
  const text = normalizeText(trimmed);
  if (text.length < 4) return null;
  return { kind: "text", value: text };
}

function shingles(words: string[]) {
  const result: string[] = [];
  for (let index = 0; index + SHINGLE_WORDS <= words.length; index += 1) {
    result.push(words.slice(index, index + SHINGLE_WORDS).join(" "));
  }
  return result;
}

function looksTabular(answer: string) {
  const tableLines = answer.split("\n").filter((line) => /^\s*\|.*\|\s*$/.test(line)).length;
  if (tableLines >= 3) return true;
  const csvLines = answer.split("\n").filter((line) => (line.match(/,/g)?.length ?? 0) >= 3 && !/\s[a-z]+\s[a-z]+\s/i.test(line)).length;
  if (csvLines >= 3) return true;
  return /```[\s\S]*?(\{|\[|,)[\s\S]*?```/.test(answer);
}

export function checkAnswer(answer: string, dataset: GuardDataset): GuardResult {
  if (looksTabular(answer)) return block("tabular-output");

  const normalizedAnswer = ` ${normalizeText(answer)} `;
  const answerNumbers = new Set(
    (answer.match(/-?[$€£]?\d[\d,]*(?:\.\d+)?/g) ?? [])
      .map((token) => normalizeNumber(token))
      .filter((value): value is string => value !== null),
  );
  const contains = (form: { kind: "number" | "text"; value: string }) => (
    form.kind === "number" ? answerNumbers.has(form.value) : normalizedAnswer.includes(` ${form.value} `)
  );

  // How many rows share each value in a column; shared values are group labels.
  const frequency = new Map<string, Map<string, number>>();
  for (const column of dataset.columns) {
    const counts = new Map<string, number>();
    for (const cell of dataset.columnIndex[column] ?? []) {
      const form = distinctiveForm(cell);
      if (form) counts.set(form.value, (counts.get(form.value) ?? 0) + 1);
    }
    frequency.set(column, counts);
  }

  let listedRows = 0;
  let citedCells = 0;
  for (let row = 0; row < dataset.rowCount; row += 1) {
    let distinctive = 0;
    let matched = 0;
    for (const column of dataset.columns) {
      const form = distinctiveForm(dataset.columnIndex[column]?.[row] ?? "");
      if (!form) continue;
      // Text shared by several rows is a group label, not a record detail.
      if (form.kind === "text" && (frequency.get(column)?.get(form.value) ?? 0) > 1) continue;
      distinctive += 1;
      if (!contains(form)) continue;
      matched += 1;
      if (form.kind === "text" && PERSONAL_COLUMN.test(column)) return block("personal-identifier");
    }
    citedCells += matched;
    if (distinctive >= ROW_REPRODUCED_MIN_CELLS && matched >= ROW_REPRODUCED_MIN_CELLS && matched / distinctive >= ROW_REPRODUCED_SHARE) {
      return block("record-reproduced");
    }
    if (matched >= LISTED_ROW_MIN_CELLS) listedRows += 1;
  }
  if (listedRows > MAX_LISTED_ROWS || citedCells > MAX_CITED_CELLS) return block("records-listed");

  // Emails and account IDs from the dataset never belong in an answer.
  const identifiers = answer.match(/[\w.+-]+@[\w-]+\.[\w.]+|\b[\w-]+\.(?:testnet|near)\b|\b0x[a-f0-9]{40}\b/gi) ?? [];
  if (identifiers.length) {
    const datasetText = dataset.columns.flatMap((column) => dataset.columnIndex[column] ?? []).join("\n").toLowerCase();
    if (identifiers.some((identifier) => datasetText.includes(identifier.toLowerCase()))) {
      return block("personal-identifier");
    }
  }

  // Long verbatim passages (mostly text vaults such as reports).
  const answerShingles = shingles(normalizeText(answer).split(" "));
  if (answerShingles.length) {
    const datasetShingles = new Set<string>();
    for (const column of dataset.columns) {
      for (const cell of dataset.columnIndex[column] ?? []) {
        for (const shingle of shingles(normalizeText(cell).split(" "))) datasetShingles.add(shingle);
      }
    }
    const verbatim = answerShingles.filter((shingle) => datasetShingles.has(shingle)).length;
    if (verbatim > MAX_VERBATIM_SHINGLES || (answerShingles.length >= 5 && verbatim / answerShingles.length >= MAX_VERBATIM_SHARE)) {
      return block("verbatim-passage");
    }
  }

  return ALLOWED;
}

const REASON_MESSAGES: Record<GuardReason, string> = {
  "raw-records-requested": "BlindSight only answers with aggregate insights, not raw records. Try asking for a total, average, trend or comparison instead.",
  "personal-data-requested": "BlindSight doesn't reveal details about individuals. Try an aggregate question, such as a count or average across a group.",
  "record-reproduced": "The answer repeated too much of a single record, so it was withheld. Try a broader, aggregate question.",
  "records-listed": "The answer listed too many individual records, so it was withheld. Try asking for a summary or comparison instead.",
  "verbatim-passage": "The answer quoted too much of the source verbatim, so it was withheld. Try asking for a summary instead.",
  "personal-identifier": "The answer contained a personal identifier from the dataset, so it was withheld. Try an aggregate question instead.",
  "tabular-output": "The answer came back as a table of records, so it was withheld. Try asking for a summary instead.",
};

export function guardMessage(reason: GuardReason) {
  return REASON_MESSAGES[reason];
}

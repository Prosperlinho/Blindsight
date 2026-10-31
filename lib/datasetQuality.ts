import { randomUUID } from "node:crypto";

export const DATASET_QUALITY_ERROR = "Dataset rejected: File structure does not meet quality standards.";

const SEEDED_DEFI_DATASET = `protocol,day,pool,liquidity_usd,volume_usd
NEARSwap,2026-10-24,NEAR-USDC,1840000,426000
Ref Finance,2026-10-24,USDC-USDT,2310000,518000
Burrow,2026-10-25,NEAR-USDC,1675000,392000
NEAR Intents,2026-10-25,USDC-USDT,2840000,733000
Ref Finance,2026-10-26,NEAR-USDC,1930000,481000`;

export type PreparedDataset = {
  datasetForInference: string;
  rowCount: number;
  columns: string[];
  columnIndex: Record<string, string[]>;
  isFallback: boolean;
};

type CachedPreparedDataset = { dataset: PreparedDataset; expiresAt: number };

const PREPARED_DATASET_TTL_MS = 30 * 60 * 1000;
const MAX_PREPARED_DATASETS = 100;
const preparedDatasets = new Map<string, CachedPreparedDataset>();

export function cachePreparedDataset(dataset: PreparedDataset, preferredId?: string) {
  const now = Date.now();
  for (const [id, entry] of preparedDatasets) {
    if (entry.expiresAt <= now) preparedDatasets.delete(id);
  }
  while (preparedDatasets.size >= MAX_PREPARED_DATASETS) {
    const oldestId = preparedDatasets.keys().next().value;
    if (!oldestId) break;
    preparedDatasets.delete(oldestId);
  }

  const datasetId = preferredId && /^[0-9a-f-]{36}$/i.test(preferredId) && !preparedDatasets.has(preferredId)
    ? preferredId
    : randomUUID();
  preparedDatasets.set(datasetId, { dataset, expiresAt: now + PREPARED_DATASET_TTL_MS });
  return datasetId;
}

export function getCachedPreparedDataset(datasetId: unknown) {
  if (typeof datasetId !== "string") return undefined;
  const entry = preparedDatasets.get(datasetId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    preparedDatasets.delete(datasetId);
    return undefined;
  }
  return entry.dataset;
}

type DatasetSection = { name: string; content: string };
type DatasetRecord = Record<string, string>;

function splitSections(dataset: string): DatasetSection[] {
  const headers = Array.from(dataset.matchAll(/^### ([^\r\n]+)\r?\n/gm));
  if (!headers.length) {
    const trimmed = dataset.trim();
    const name = trimmed.startsWith("{") || trimmed.startsWith("[")
      ? "dataset.json"
      : trimmed.includes("\t")
        ? "dataset.tsv"
        : trimmed.includes(",")
          ? "dataset.csv"
          : "dataset.txt";
    return [{ name, content: trimmed }];
  }

  const sections: DatasetSection[] = [];
  headers.forEach((header, index) => {
    const start = (header.index ?? 0) + header[0].length;
    const end = headers[index + 1]?.index ?? dataset.length;
    sections.push({ name: header[1].trim(), content: dataset.slice(start, end).trim() });
  });
  return sections;
}

function splitDelimitedRow(line: string, delimiter: string): string[] | null {
  const fields: string[] = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === delimiter && !insideQuotes) {
      fields.push(field.trim());
      field = "";
    } else {
      field += character;
    }
  }

  if (insideQuotes) return null;
  fields.push(field.trim());
  return fields;
}

function recordsFromSection(section: DatasetSection): DatasetRecord[] {
  if (!section.content) throw new Error(DATASET_QUALITY_ERROR);
  const extension = section.name.split(".").pop()?.toLowerCase();

  if (extension === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(section.content);
    } catch {
      throw new Error(DATASET_QUALITY_ERROR);
    }

    if (!Array.isArray(parsed) && (!parsed || typeof parsed !== "object")) {
      throw new Error(DATASET_QUALITY_ERROR);
    }

    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)
        ? (parsed as { rows: unknown[] }).rows
        : [parsed];
    if (!values.length) throw new Error(DATASET_QUALITY_ERROR);

    const records = values.map((value): DatasetRecord => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.entries(value).map(([key, cell]) => [
            key.trim(),
            typeof cell === "string" ? cell : JSON.stringify(cell),
          ]),
        );
      }
      if (Array.isArray(value)) {
        return Object.fromEntries(value.map((cell, index) => [`column_${index + 1}`, String(cell ?? "")]));
      }
      throw new Error(DATASET_QUALITY_ERROR);
    });
    if (records.some((record) => !Object.keys(record).length || !Object.values(record).some((cell) => cell.trim()))) {
      throw new Error(DATASET_QUALITY_ERROR);
    }
    return records;
  }

  if (extension === "csv" || extension === "tsv") {
    const delimiter = extension === "tsv" ? "\t" : ",";
    const lines = section.content.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) throw new Error(DATASET_QUALITY_ERROR);

    const headers = splitDelimitedRow(lines[0], delimiter);
    if (!headers || headers.length < 2 || headers.some((header) => !header)) {
      throw new Error(DATASET_QUALITY_ERROR);
    }
    if (new Set(headers).size !== headers.length) throw new Error(DATASET_QUALITY_ERROR);

    return lines.slice(1).map((line) => {
      const values = splitDelimitedRow(line, delimiter);
      if (!values || values.length !== headers.length || values.every((value) => !value)) {
        throw new Error(DATASET_QUALITY_ERROR);
      }
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    });
  }

  if (extension === "txt" || extension === "pdf") {
    const lines = section.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error(DATASET_QUALITY_ERROR);
    return lines.map((line) => ({ text: line }));
  }

  throw new Error(DATASET_QUALITY_ERROR);
}

function isEmptySection(section: DatasetSection) {
  if (!section.content.trim()) return true;
  const extension = section.name.split(".").pop()?.toLowerCase();

  if (extension === "json") {
    try {
      const parsed: unknown = JSON.parse(section.content);
      if (Array.isArray(parsed)) return parsed.length === 0;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)) {
        return (parsed as { rows: unknown[] }).rows.length === 0;
      }
      return Boolean(parsed && typeof parsed === "object" && Object.keys(parsed).length === 0);
    } catch {
      return false;
    }
  }

  if (extension === "csv" || extension === "tsv") {
    const lines = section.content.split(/\r?\n/).filter((line) => line.trim());
    const delimiter = extension === "tsv" ? "\t" : ",";
    return lines.length === 1 && (splitDelimitedRow(lines[0], delimiter)?.length ?? 0) >= 2;
  }

  return false;
}

export function prepareDataset(rawDataset: unknown): PreparedDataset {
  const incomingSections = typeof rawDataset === "string" && rawDataset.trim()
    ? splitSections(rawDataset).filter((section) => !isEmptySection(section))
    : [];
  const isFallback = incomingSections.length === 0;
  const sections = isFallback ? splitSections(SEEDED_DEFI_DATASET) : incomingSections;
  const records = sections.flatMap(recordsFromSection);
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  if (!records.length || !columns.length) throw new Error(DATASET_QUALITY_ERROR);

  const columnIndex = Object.fromEntries(
    columns.map((column) => [column, records.map((record) => record[column] ?? "")]),
  );

  return {
    datasetForInference: JSON.stringify({ columns, rows: records }),
    rowCount: records.length,
    columns,
    columnIndex,
    isFallback,
  };
}
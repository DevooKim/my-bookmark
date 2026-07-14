import { bookmarkMetadataSchema } from "@my-bookmark/shared";

export interface MetadataRow {
  id: string;
  key: string;
  value: string;
}

let metadataRowSequence = 0;

function createMetadataRow(key = "", value = ""): MetadataRow {
  metadataRowSequence += 1;
  return { id: `metadata-row-${metadataRowSequence}`, key, value };
}

export function metadataRows(metadata: Record<string, string>): MetadataRow[] {
  return Object.entries(metadata).map(([key, value]) =>
    createMetadataRow(key, value),
  );
}

export function normalizeMetadataRows(
  rows: MetadataRow[],
):
  | { success: true; metadata: Record<string, string> }
  | { success: false; message: string } {
  const entries = rows
    .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
    .filter((row) => row.key.length > 0 || row.value.length > 0);
  if (entries.some((row) => row.key.length === 0 || row.value.length === 0)) {
    return { success: false, message: "키와 값을 모두 입력해 주세요." };
  }
  if (new Set(entries.map((row) => row.key)).size !== entries.length) {
    return { success: false, message: "메타데이터 키는 중복될 수 없어요." };
  }
  const parsed = bookmarkMetadataSchema.safeParse(
    Object.fromEntries(entries.map((row) => [row.key, row.value])),
  );
  if (!parsed.success) {
    return {
      success: false,
      message: "메타데이터는 최대 10개이며 키 40자, 값 2048자 이하여야 해요.",
    };
  }
  return { success: true, metadata: parsed.data };
}

function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function BookmarkMetadata({
  metadata,
  interactive = false,
  compact = false,
}: {
  metadata: Record<string, string>;
  interactive?: boolean;
  compact?: boolean;
}) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div
      className={`mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs${interactive ? " pointer-events-auto relative z-20" : ""}`}
    >
      {entries.map(([key, value]) => {
        const url = externalUrl(value);
        return (
          <div className="min-w-0 max-w-full" key={key}>
            {url ? (
              <a
                className={`inline-flex max-w-full truncate rounded-lg bg-blue-50 px-2 py-1 font-medium text-blue-700 hover:bg-blue-700 hover:text-white dark:bg-blue-950 dark:text-blue-200 dark:hover:bg-blue-600 dark:hover:text-white${interactive ? " pointer-events-auto relative z-20" : ""}`}
                href={url}
                rel="noreferrer"
                target="_blank"
              >
                {key}
              </a>
            ) : (
              <div
                className={`${compact ? "truncate" : "break-words"} max-w-full rounded-lg bg-zinc-100 px-2 py-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}
              >
                <span>
                  {key}: {value}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BookmarkMetadataEditor({
  rows,
  error,
  onChange,
}: {
  rows: MetadataRow[];
  error: string | null;
  onChange: (rows: MetadataRow[]) => void;
}) {
  const updateRow = (index: number, patch: Partial<MetadataRow>) => {
    onChange(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">메타데이터</legend>
      {rows.map((row, index) => (
        <div
          className="grid min-w-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] gap-2"
          key={row.id}
        >
          <input
            aria-label="메타데이터 키"
            className="input min-w-0"
            maxLength={40}
            onChange={(event) => updateRow(index, { key: event.target.value })}
            placeholder="키"
            value={row.key}
          />
          <input
            aria-label="메타데이터 값"
            className="input min-w-0"
            maxLength={2048}
            onChange={(event) =>
              updateRow(index, { value: event.target.value })
            }
            placeholder="값 또는 URL"
            value={row.value}
          />
          <button
            aria-label={`${row.key || index + 1} 메타데이터 삭제`}
            className="icon-button"
            onClick={() =>
              onChange(rows.filter((_, rowIndex) => rowIndex !== index))
            }
            type="button"
          >
            ×
          </button>
        </div>
      ))}
      <button
        aria-label="메타데이터 항목 추가"
        className="btn-secondary"
        disabled={rows.length >= 10}
        onClick={() => onChange([...rows, createMetadataRow()])}
        type="button"
      >
        항목 추가
      </button>
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

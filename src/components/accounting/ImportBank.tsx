import { useState } from "react";
import { rpc } from "../../lib/api";
import { readableError } from "../../lib/utils.js";
import {
  readBankWorkbook,
  type ParsedBook,
} from "../../lib/accounting/workbook";
import {
  fieldLabels,
  guessMapping,
  mappedRows,
} from "../../lib/accounting/import.js";
import { money, localStamp } from "../../lib/accounting/display";
export default function ImportBank({
  onImported,
}: {
  onImported: () => Promise<void>;
}) {
  const [book, setBook] = useState<ParsedBook | null>(null),
    [sheet, setSheet] = useState(0),
    [header, setHeader] = useState(0),
    [mapping, setMapping] = useState<Record<string, number>>({}),
    [preview, setPreview] = useState<any[] | null>(null),
    [rows, setRows] = useState<any[]>([]),
    [decisions, setDecisions] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<any>(null),
    [page, setPage] = useState(0),
    [onlyReview, setOnlyReview] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [batchId, setBatchId] = useState(() => crypto.randomUUID());
  const reset = () => {
    setPreview(null);
    setDecisions({});
    setConfirmed(false);
    setResult(null);
    setBatchId(crypto.randomUUID());
    setPage(0);
  };
  function chooseHeader(parsed: ParsedBook, index: number, row: number) {
    setSheet(index);
    setHeader(row);
    setMapping(guessMapping(parsed.sheets[index].rows[row] || []));
    reset();
  }
  const headers = book?.sheets[sheet]?.rows[header] || [];
  const visible = (preview || []).filter(
    (row) => !onlyReview || row.status === "review",
  );
  const counts = Object.fromEntries(
    ["new", "duplicate", "error", "review"].map((status) => [
      status,
      preview?.filter((row) => row.status === status).length || 0,
    ]),
  );
  const unresolved = preview?.some(
    (row) => row.status === "review" && !decisions[row.row_key],
  );
  return (
    <section className="panel accounting-import">
      <h2>거래내역 엑셀 가져오기</h2>
      <p>
        원본 파일은 서버에 보관하지 않습니다. XLSX·XLS·UTF-8 CSV, 10MB 이하·한
        번에 거래 5,000행까지 가능합니다.
      </p>
      <label>
        거래내역 파일
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            setBook(null);
            reset();
            try {
              const parsed = await readBankWorkbook(file);
              setBook(parsed);
              let candidate = 0;
              for (
                let i = 0;
                i < Math.min(parsed.sheets[0].rows.length, 100);
                i++
              ) {
                const guess = guessMapping(parsed.sheets[0].rows[i]);
                if (
                  guess.date >= 0 &&
                  (guess.amount >= 0 || guess.income >= 0 || guess.expense >= 0)
                ) {
                  candidate = i;
                  break;
                }
              }
              chooseHeader(parsed, 0, candidate);
            } catch (e) {
              setError(readableError(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {book && (
        <>
          <div className="form-grid">
            <label>
              시트
              <select
                value={sheet}
                disabled={busy}
                onChange={(e) => chooseHeader(book, Number(e.target.value), 0)}
              >
                {book.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    시트 {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              제목행 번호
              <input
                type="number"
                min="1"
                max={book.sheets[sheet].rows.length}
                value={header + 1}
                disabled={busy}
                onChange={(e) => {
                  const n = Number(e.target.value) - 1;
                  if (n >= 0 && n < book.sheets[sheet].rows.length)
                    chooseHeader(book, sheet, n);
                }}
              />
            </label>
          </div>
          <details open={!preview}>
            <summary>열 연결 확인</summary>
            <p>
              실제 은행 파일의 열을 확인해 연결하세요. 입금액·출금액 열을 각각
              연결하거나, 통합 금액과 입출금 구분을 연결합니다.
            </p>
            <div className="accounting-mapping">
              {Object.entries(fieldLabels).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    aria-label={label}
                    value={mapping[key] ?? -1}
                    disabled={busy}
                    onChange={(e) => {
                      setMapping({ ...mapping, [key]: Number(e.target.value) });
                      reset();
                    }}
                  >
                    <option value={-1}>연결하지 않음</option>
                    {headers.map((cell: any, i) => (
                      <option value={i} key={i}>
                        {i + 1}열 ·{" "}
                        {typeof cell === "object"
                          ? "수식 셀"
                          : String(cell || "제목 없음").slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setResult(null);
              setConfirmed(false);
              try {
                if (
                  mapping.date < 0 ||
                  !(
                    mapping.income >= 0 ||
                    mapping.expense >= 0 ||
                    mapping.amount >= 0
                  )
                )
                  throw Error("거래일자와 금액 열을 연결해 주세요.");
                const converted = mappedRows(
                  book.sheets[sheet].rows,
                  header,
                  mapping,
                  sheet,
                  book.date1904,
                );
                if (!converted.length || converted.length > 5000)
                  throw Error(
                    "거래는 1~5,000행이어야 합니다. 제목행과 거래 구간을 확인해 주세요.",
                  );
                setRows(converted);
                const checked = await rpc<any[]>("accounting_preview", {
                  p_file_hash: book.hash,
                  p_rows: converted,
                });
                setPreview(checked);
                setDecisions({});
                setPage(0);
                setBatchId(crypto.randomUUID());
              } catch (e) {
                setError(readableError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            미리보기와 중복 검사
          </button>
        </>
      )}
      {preview && (
        <>
          <p className="accounting-import-counts">
            신규 {counts.new}건 · 확실한 중복 {counts.duplicate}건 · 오류{" "}
            {counts.error}건 · 검토 필요 {counts.review}건
          </p>
          <p>
            다른 파일과 내용이 같거나 같은 파일 안에 반복된 행은 자동 삭제하지
            않습니다. 실제 별도 거래라면 ‘신규 거래’, 같은 거래라면 기존 거래를
            선택하세요. 오류 행은 저장되지 않습니다.
          </p>
          <label className="accounting-check">
            <input
              type="checkbox"
              checked={onlyReview}
              onChange={(e) => {
                setOnlyReview(e.target.checked);
                setPage(0);
              }}
            />
            검토 필요한 행만 보기
          </label>
          <div className="accounting-preview">
            {visible.slice(page * 50, page * 50 + 50).map((row) => (
              <article
                key={row.row_key}
                className={`accounting-preview-row status-${row.status}`}
              >
                <strong>
                  시트 {Number(row.source_sheet) + 1} · {row.source_row}행 —{" "}
                  {
                    {
                      new: "신규",
                      duplicate: "중복 제외",
                      review: "담당자 검토",
                      error: "오류",
                    }[row.status as string]
                  }
                </strong>
                {row.data.valid ? (
                  <>
                    <p>
                      {localStamp(row.data.occurred_at)} ·{" "}
                      {row.data.direction === "income" ? "입금" : "출금"}{" "}
                      {money(row.data.amount)}
                    </p>
                    <p>
                      {row.data.description || "내용 없음"} · 잔액{" "}
                      {money(row.data.balance)}
                    </p>
                  </>
                ) : (
                  <p>
                    {rows.find(
                      (r) =>
                        `${r.source_sheet}:${r.source_row}` === row.row_key,
                    )?.client_error || row.data.reason}
                  </p>
                )}
                {row.status === "review" && (
                  <label>
                    이 행 처리
                    <select
                      aria-label={`${row.source_row}행 중복 판단`}
                      value={decisions[row.row_key] || ""}
                      disabled={busy || !!result}
                      onChange={(e) =>
                        setDecisions({
                          ...decisions,
                          [row.row_key]: e.target.value,
                        })
                      }
                    >
                      <option value="">판단을 선택해 주세요</option>
                      <option value="new">실제 별도 거래 — 신규 저장</option>
                      {row.candidates.map((candidate: any) => (
                        <option key={candidate.id} value={candidate.id}>
                          기존 거래와 중복 — 기존 {candidate.source_row}행 (
                          {candidate.id.slice(0, 8)})
                        </option>
                      ))}
                      <option value="exclude">
                        이번 행은 제외 (담당자 판단)
                      </option>
                    </select>
                  </label>
                )}
              </article>
            ))}
          </div>
          <div className="button-row">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              이전 50행
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(visible.length / 50))}
            </span>
            <button
              disabled={(page + 1) * 50 >= visible.length}
              onClick={() => setPage((p) => p + 1)}
            >
              다음 50행
            </button>
          </div>
          <label className="accounting-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || !!result}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            미리보기·계좌·중복 판단을 확인했으며 오류 행 {counts.error}건을
            제외하고 저장합니다.
          </label>
          <button
            className="primary"
            disabled={busy || !confirmed || unresolved || !!result}
            onClick={async () => {
              if (!book) return;
              setBusy(true);
              setError("");
              try {
                const saved = await rpc("accounting_import", {
                  p_id: batchId,
                  p_file_hash: book.hash,
                  p_rows: rows,
                  p_decisions: decisions,
                  p_meta: {
                    file_type: book.extension,
                    file_size: book.size,
                    mapping,
                  },
                });
                setResult(saved);
                await onImported();
              } catch (e) {
                setError(
                  readableError(e) +
                    " · 서버에서 다시 확인합니다. 미리보기를 갱신한 뒤 재시도해 주세요.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            확인한 거래 최종 저장
          </button>
        </>
      )}
      {busy && <p role="status">파일 또는 거래를 확인하고 있습니다…</p>}
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {!busy && result && (
        <p role="status" className="inset">
          저장 완료: 신규 {result.new_count}건 · 중복 제외{" "}
          {result.duplicate_count}건 · 담당자 제외 {result.excluded_count}건 ·
          오류 {result.error_count}건
        </p>
      )}
    </section>
  );
}

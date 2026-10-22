import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Copy, ExternalLink, RefreshCw, Upload, Download } from "lucide-react";
import type { Member } from "../../lib/types";
import { rpc } from "../../lib/api";
import { readableError, today } from "../../lib/utils.js";
import {
  bankUrl,
  money,
  localStamp,
  displayAt,
  periodDates,
} from "../../lib/accounting/display";
import { AccountingSettings } from "./AccountingSettings";
import { AccountingHistory } from "./AccountingHistory";
import { EditTransaction } from "./EditTransaction";
const ImportBank = lazy(() => import("./ImportBank"));
export default function Accounting({
  me,
  members,
}: {
  me: Member;
  members: Member[];
}) {
  const initial = today().slice(0, 7);
  const dates = periodDates(initial);
  const [from, setFrom] = useState(dates.from),
    [to, setTo] = useState(dates.to),
    [month, setMonth] = useState(initial),
    [year, setYear] = useState(""),
    [direction, setDirection] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [openImport, setOpenImport] = useState(false),
    [openHistory, setOpenHistory] = useState(false),
    [edit, setEdit] = useState<any>(null),
    [reportBusy, setReportBusy] = useState(false);
  const request = useRef(0);
  const admin = me.role === "admin";
  const load = useCallback(async () => {
    const id = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await rpc("accounting_overview", {
        p_from: from || null,
        p_to: to || null,
        p_direction: direction,
        p_query: query,
        p_offset: offset,
        p_limit: 100,
      });
      if (id === request.current) setData(result);
    } catch (e) {
      if (id === request.current) {
        setData(null);
        setError(
          ["PGRST202", "42P01"].includes((e as any)?.code)
            ? "공동회계 데이터베이스 설치가 필요합니다. 관리자에게 회계 추가 SQL 적용 여부를 확인해 주세요."
            : readableError(e),
        );
      }
    } finally {
      if (id === request.current) setBusy(false);
    }
  }, [from, to, direction, query, offset]);
  useEffect(() => {
    setData(null);
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!data?.can_manage) {
      setOpenImport(false);
      setOpenHistory(false);
      setEdit(null);
    }
  }, [data?.can_manage]);
  const choosePeriod = (start: string, end: string) => {
    setFrom(start);
    setTo(end);
    setOffset(0);
  };
  const lastBalanceText = data?.balance_ambiguous
    ? "같은 시각의 거래 순서 확인 필요"
    : data?.bank_balance == null
      ? "파일에 확인 가능한 잔액이 없습니다"
      : localStamp(data.bank_balance_at);
  return (
    <div className="accounting-page">
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      <div className="button-row accounting-tools">
        <button disabled={busy} onClick={() => void load()}>
          <RefreshCw size={17} />
          회계 새로고침
        </button>
        {data?.can_manage && (
          <>
            <button
              className="primary"
              onClick={() => setOpenImport((v) => !v)}
            >
              <Upload size={17} />
              {openImport ? "엑셀 가져오기 닫기" : "거래내역 가져오기"}
            </button>
            <button onClick={() => setOpenHistory((v) => !v)}>
              업로드·수정 이력
            </button>
          </>
        )}
      </div>
      {busy && !data && <p role="status">공동회계를 불러오고 있습니다…</p>}
      {data && (
        <>
          <section className="panel accounting-bank">
            <div>
              <span className="eyebrow">농장 공동운영 계좌</span>
              <h2>{data.settings.account_name || "모임통장 정보 등록 전"}</h2>
              <p>{data.settings.bank_name}</p>
              <strong className="accounting-number">
                {data.settings.account_number ||
                  "관리자가 계좌번호를 등록해 주세요"}
              </strong>
              <small>
                거래내역 최종 갱신 {displayAt(data.last_changed_at)}
              </small>
            </div>
            <div className="button-row">
              <button
                disabled={!data.settings.account_number}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      data.settings.account_number,
                    );
                    setMessage("계좌번호를 복사했습니다.");
                  } catch {
                    setMessage(
                      "자동 복사를 사용할 수 없습니다. 표시된 계좌번호를 길게 눌러 복사해 주세요.",
                    );
                  }
                }}
              >
                <Copy size={17} />
                계좌번호 복사
              </button>
              <a
                className="secondary accounting-bank-link"
                href={bankUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                카카오뱅크 바로가기 <ExternalLink size={17} />
              </a>
            </div>
            <p>
              공식 카카오뱅크 홈페이지로 이동합니다. 특정 모임통장 계좌로 직접
              이동하거나 은행에 자동 로그인하지 않습니다.
            </p>
          </section>
          <section
            className="panel accounting-filters"
            aria-label="회계 조회 조건"
          >
            <h2>조회 기간과 찾기</h2>
            <div className="accounting-filter-grid">
              <label>
                월별 조회
                <input
                  type="month"
                  value={month}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    setYear("");
                    const range = periodDates(e.target.value);
                    choosePeriod(range.from, range.to);
                  }}
                />
              </label>
              <label>
                연도별 조회
                <select
                  value={year}
                  onChange={(e) => {
                    const y = e.target.value;
                    setYear(y);
                    setMonth("");
                    choosePeriod(y ? `${y}-01-01` : "", y ? `${y}-12-31` : "");
                  }}
                >
                  <option value="">연도 선택</option>
                  {Array.from(
                    { length: Number(today().slice(0, 4)) - 1997 },
                    (_, i) => String(Number(today().slice(0, 4)) + 2 - i),
                  ).map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </label>
              <label>
                입출금
                <select
                  value={direction}
                  onChange={(e) => {
                    setDirection(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">전체</option>
                  <option value="income">입금</option>
                  <option value="expense">출금</option>
                </select>
              </label>
              <label>
                거래 찾기
                <input
                  type="search"
                  value={query}
                  maxLength={200}
                  placeholder="내용·분류·비고·금액"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
            </div>
            <div className="button-row">
              <button
                onClick={() => {
                  setMonth(initial);
                  setYear("");
                  choosePeriod(dates.from, dates.to);
                }}
              >
                이번 달
              </button>
              <button
                onClick={() => {
                  setMonth("");
                  setYear("");
                  choosePeriod("", "");
                }}
              >
                전체 기간
              </button>
              <button
                disabled={reportBusy}
                onClick={async () => {
                  setReportBusy(true);
                  setError("");
                  try {
                    const { downloadReport } = await import(
                      "../../lib/accounting/report"
                    );
                    await downloadReport(from, to);
                  } catch (e) {
                    setError(readableError(e));
                  } finally {
                    setReportBusy(false);
                  }
                }}
              >
                <Download size={17} />
                선택기간 엑셀 보고서
              </button>
            </div>
            <details>
              <summary>날짜 범위 직접 입력</summary>
              <div className="form-grid">
                <label>
                  시작일
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setMonth("");
                      setYear("");
                      choosePeriod(e.target.value, to);
                    }}
                  />
                </label>
                <label>
                  종료일
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setMonth("");
                      setYear("");
                      choosePeriod(from, e.target.value);
                    }}
                  />
                </label>
              </div>
            </details>
          </section>
          <section className="accounting-summary" aria-label="회계 요약">
            <article className="panel">
              <small>선택 기간 총수입</small>
              <strong className="income">{money(data.income)}</strong>
            </article>
            <article className="panel">
              <small>선택 기간 총지출</small>
              <strong className="expense">{money(data.expense)}</strong>
            </article>
            <article className="panel">
              <small>마지막 거래 기준 잔액</small>
              <strong>{money(data.bank_balance)}</strong>
              <small>{lastBalanceText}</small>
            </article>
            <article className="panel">
              <small>마지막 거래 날짜</small>
              <strong className="accounting-date">
                {localStamp(data.last_transaction_at)}
              </strong>
              <small>최근 엑셀 업로드 {displayAt(data.last_upload_at)}</small>
            </article>
          </section>
          <p className="accounting-notice">
            수입·지출은 선택 기간에 등록된 거래만 집계합니다. 입출금·검색 조건은
            아래 목록에 적용됩니다. 은행 잔액은 조회 기간과 별개인 마지막 확인
            값이며 현재 은행 자동 조회값이 아닙니다.{" "}
            {data.bank_balance_at &&
            data.bank_balance_at !== data.last_transaction_at
              ? "마지막 거래에는 잔액이 없어서 이전 거래의 확인 잔액을 표시합니다."
              : ""}{" "}
            {data.gap_count > 0
              ? `잔액 연결이 맞지 않는 구간 ${data.gap_count}곳이 있습니다. 거래 누락이나 같은 시각의 순서를 은행 내역과 비교해 주세요.`
              : "누락 여부는 은행의 전체 거래내역과 대조해 주세요."}
          </p>
          <section className="panel accounting-ledger">
            <h2>
              입출금 상세 내역 <small>{data.total}건</small>
            </h2>
            {!data.items.length && <p>조회 조건에 맞는 거래가 없습니다.</p>}
            <div className="accounting-transactions">
              {data.items.map((t: any) => (
                <article key={t.id} className="accounting-transaction">
                  <div>
                    <strong className={t.direction}>
                      {t.direction === "income" ? "입금" : "출금"}{" "}
                      {money(t.amount)}
                    </strong>
                    <time>
                      {localStamp(t.occurred_at)}
                      {t.time_precision === "date" ? " (시각 없음)" : ""}
                    </time>
                  </div>
                  <p>{t.description || "거래내용 없음"}</p>
                  <div className="accounting-transaction-meta">
                    <span>{t.category || "미분류"}</span>
                    <span>거래 후 잔액 {money(t.balance)}</span>
                  </div>
                  {t.note && <p>비고: {t.note}</p>}
                  {data.can_manage && (
                    <button className="text-button" onClick={() => setEdit(t)}>
                      사용분류·비고 수정
                    </button>
                  )}
                </article>
              ))}
            </div>
            <div className="button-row accounting-pages">
              <button
                disabled={offset === 0 || busy}
                onClick={() => setOffset((n) => Math.max(0, n - 100))}
              >
                이전 100건
              </button>
              <span>
                {data.total ? offset + 1 : 0}–
                {Math.min(offset + 100, data.total)} / {data.total}건
              </span>
              <button
                disabled={offset + 100 >= data.total || busy}
                onClick={() => setOffset((n) => n + 100)}
              >
                다음 100건
              </button>
            </div>
          </section>
          <details className="panel accounting-analysis">
            <summary>분류별 지출과 월별 추이</summary>
            <h3>선택 기간 지출 분류</h3>
            {data.categories.length ? (
              data.categories.map((c: any) => (
                <p className="accounting-analysis-row" key={c.category}>
                  <span>{c.category}</span>
                  <strong>{money(c.total)}</strong>
                </p>
              ))
            ) : (
              <p>지출 내역이 없습니다.</p>
            )}
            <h3>월별 수입·지출</h3>
            {data.monthly.map((m: any) => (
              <div className="accounting-month" key={m.month}>
                <strong>{m.month}</strong>
                <span className="income">수입 {money(m.income)}</span>
                <span className="expense">지출 {money(m.expense)}</span>
              </div>
            ))}
          </details>
          {admin && (
            <AccountingSettings data={data} members={members} reload={load} />
          )}
          {data.can_manage && openImport && (
            <Suspense fallback={<p>엑셀 도구 준비 중…</p>}>
              <ImportBank onImported={load} />
            </Suspense>
          )}
          {data.can_manage && openHistory && (
            <AccountingHistory
              admin={admin}
              members={members}
              onChanged={load}
            />
          )}
          {edit && data.can_manage && (
            <EditTransaction
              entry={edit}
              categories={data.category_options}
              onClose={() => setEdit(null)}
              onSaved={load}
            />
          )}
        </>
      )}
      {message && (
        <p role="status" className="inset">
          {message}
        </p>
      )}
    </div>
  );
}

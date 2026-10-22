import { useEffect, useState } from "react";
import type { Member } from "../../lib/types";
import { rpc } from "../../lib/api";
import { readableError } from "../../lib/utils.js";
import { displayAt } from "../../lib/accounting/display";
export function AccountingHistory({
  admin,
  onChanged,
  members,
}: {
  members: Member[];
  admin: boolean;
  onChanged: () => Promise<void>;
}) {
  const [history, setHistory] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [cancel, setCancel] = useState(""),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState("");
  const person = (id: string) =>
    members.find((m) => m.user_id === id)?.display_name || "이전 참여자";
  async function load() {
    try {
      setHistory(await rpc("accounting_history"));
      setError("");
    } catch (e) {
      setError(readableError(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel accounting-history">
      <h2>업로드·수정 이력</h2>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {history?.imports.map((batch: any) => (
        <article className="accounting-history-row" key={batch.id}>
          <strong>
            {displayAt(batch.created_at)} · {batch.file_type.toUpperCase()}
          </strong>
          <p>
            등록자 {person(batch.created_by)} · 신규 {batch.new_count} · 중복{" "}
            {batch.duplicate_count} · 오류 {batch.error_count} · 제외{" "}
            {batch.excluded_count}
          </p>
          <small>
            업로드 식별자 {batch.id.slice(0, 8)}
            {batch.cancelled_at
              ? ` · 취소 ${displayAt(batch.cancelled_at)}`
              : ""}
          </small>
          {batch.cancelled_at && (
            <p>
              취소자 {person(batch.cancelled_by)} · 사유: {batch.cancel_reason}
            </p>
          )}
          {admin && !batch.cancelled_at && (
            <button
              disabled={busy}
              onClick={() => {
                setCancel(batch.id);
                setReason("");
                setConfirm("");
              }}
            >
              이 업로드 취소 검토
            </button>
          )}
          {cancel === batch.id && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (confirm !== "취소") return;
                setBusy(true);
                setError("");
                try {
                  await rpc("accounting_cancel", {
                    p_id: batch.id,
                    p_reason: reason,
                  });
                  setCancel("");
                  await load();
                  await onChanged();
                } catch (e) {
                  setError(readableError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p>
                이 업로드가 신규 등록한 거래만 취소됩니다. 다른 유효 업로드가
                참조하면 먼저 해당 업로드를 취소해야 합니다. 이력은 보존됩니다.
              </p>
              <label>
                취소 사유
                <input
                  required
                  minLength={4}
                  maxLength={300}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                확인을 위해 ‘취소’ 입력
                <input
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <button className="danger" disabled={busy || confirm !== "취소"}>
                업로드 취소 확정
              </button>
              <button type="button" onClick={() => setCancel("")}>
                돌아가기
              </button>
            </form>
          )}
        </article>
      ))}
      {history && !history.imports.length && <p>업로드 이력이 없습니다.</p>}
      {!!history?.errors.length && (
        <details>
          <summary>최근 오류 행 {history.errors.length}건</summary>
          {history.errors.map((row: any) => (
            <p key={row.id}>
              원본 {row.source_row}행 · {row.reason}
            </p>
          ))}
        </details>
      )}
      {admin && history && (
        <details>
          <summary>최근 관리·수정 감사 이력</summary>
          {history.audit.map((event: any) => (
            <p key={event.id}>
              {displayAt(event.at)} · {event.action} · 사용자{" "}
              {person(event.actor_id)} · {JSON.stringify(event.before_value)} →{" "}
              {JSON.stringify(event.after_value)}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}

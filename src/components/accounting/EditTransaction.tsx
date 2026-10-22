import { useEffect, useRef, useState } from "react";
import { rpc } from "../../lib/api";
import { readableError } from "../../lib/utils.js";
import { localStamp, money } from "../../lib/accounting/display";
export function EditTransaction({
  entry,
  categories,
  onClose,
  onSaved,
}: {
  entry: any;
  categories: any[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [category, setCategory] = useState(entry.category_id || ""),
    [note, setNote] = useState(entry.note),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <dialog
      className="editor accounting-edit"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await rpc("accounting_edit", {
              p_id: entry.id,
              p_version: entry.version,
              p_category: category,
              p_note: note,
            });
            await onSaved();
            onClose();
          } catch (e) {
            setError(readableError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>사용분류·비고 수정</h2>
        <p>
          {localStamp(entry.occurred_at)} · {money(entry.amount)}
        </p>
        <p className="inset">{entry.description}</p>
        <p>은행의 거래일시·금액·내용·잔액은 수정할 수 없습니다.</p>
        <label>
          사용분류
          <select
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories
              .filter(
                (c) =>
                  c.direction === entry.direction &&
                  (c.active || c.id === entry.category_id),
              )
              .map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          비고
          <textarea
            rows={4}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <div className="button-row">
          <button className="primary" disabled={busy}>
            분류·비고 저장
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </div>
      </form>
    </dialog>
  );
}

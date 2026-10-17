import { useEffect, useRef, useState } from "react";
import { db } from "../lib/api";
import { readableError } from "../lib/utils.js";
export function Password({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(""),
    [again, setAgain] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog className="editor" ref={ref} onCancel={onClose}>
      <h2>비밀번호 변경</h2>
      <p className="muted">
        다른 곳에서 사용하지 않는 12자 이상의 비밀번호를 설정하세요.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (value !== again) {
            setError("비밀번호가 서로 다릅니다.");
            return;
          }
          setBusy(true);
          const { error } = await db.auth.updateUser({ password: value });
          setBusy(false);
          if (error) setError(readableError(error));
          else onClose();
        }}
      >
        <label>
          새 비밀번호
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label>
          새 비밀번호 확인
          <input
            type="password"
            autoComplete="new-password"
            required
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <div className="button-row">
          <button type="button" onClick={onClose} disabled={busy}>
            닫기
          </button>
          <button className="primary" disabled={busy}>
            비밀번호 저장
          </button>
        </div>
      </form>
    </dialog>
  );
}

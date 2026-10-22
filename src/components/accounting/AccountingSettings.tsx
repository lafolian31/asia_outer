import { useState } from "react";
import { rpc } from "../../lib/api";
import { readableError } from "../../lib/utils.js";
import type { Member } from "../../lib/types";
export function AccountingSettings({
  data,
  members,
  reload,
}: {
  data: any;
  members: Member[];
  reload: () => Promise<void>;
}) {
  const [settingsVersion, setSettingsVersion] = useState(data.settings.version);
  const [name, setName] = useState(data.settings.account_name),
    [number, setNumber] = useState(data.settings.account_number),
    [category, setCategory] = useState(""),
    [direction, setDirection] = useState("expense"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="panel accounting-settings">
      <summary>관리자 회계 설정 · 계좌와 총무 지정</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await rpc("accounting_configure", {
              p_version: settingsVersion,
              p_name: name,
              p_number: number,
            });
            setSettingsVersion(settingsVersion + 1);
          });
        }}
      >
        <h3>계좌정보</h3>
        <label>
          모임통장 명칭
          <input
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          카카오뱅크 계좌번호
          <input
            required
            inputMode="numeric"
            maxLength={30}
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            autoComplete="off"
          />
        </label>
        <p>
          은행 비밀번호·인증번호·인증서 정보를 입력하지 마세요. 거래가 저장된
          계좌번호는 잔액 혼합 방지를 위해 변경이 제한됩니다.
        </p>
        <button className="primary" disabled={busy}>
          계좌정보 저장
        </button>
      </form>
      <h3>총무 지정</h3>
      <p>
        총무는 회계 업로드·분류·비고를 관리합니다. 농작업 기록 권한은 바뀌지
        않습니다.
      </p>
      <div className="accounting-role-list">
        {members
          .filter((m) => m.active && m.role !== "admin")
          .map((m) => (
            <label className="accounting-check" key={m.user_id}>
              <input
                type="checkbox"
                value={m.user_id}
                disabled={busy}
                checked={data.treasurers.includes(m.user_id)}
                onChange={(e) =>
                  void act(() =>
                    rpc("accounting_set_treasurer", {
                      p_user: m.user_id,
                      p_enabled: e.target.checked,
                    }),
                  )
                }
              />
              {m.display_name}
            </label>
          ))}
      </div>
      <h3>사용분류 추가</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await rpc("accounting_save_category", {
              p_name: category,
              p_direction: direction,
            });
            setCategory("");
          });
        }}
      >
        <label>
          입출금 구분
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="income">수입</option>
            <option value="expense">지출</option>
          </select>
        </label>
        <label>
          새 사용분류
          <input
            required
            value={category}
            maxLength={80}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <button disabled={busy}>회계 분류 추가</button>
      </form>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
    </details>
  );
}

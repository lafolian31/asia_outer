import { useState } from "react";
import { workGroupNames } from "../lib/work";

export function WorkCatalogEditor({
  catalog,
  busy,
  onSave,
}: {
  catalog: Record<string, string[]>;
  busy: boolean;
  onSave: (catalog: Record<string, string[]>) => void;
}) {
  const [draft, setDraft] = useState(catalog);
  const [group, setGroup] = useState(workGroupNames(catalog)[0] || "");
  const [newGroup, setNewGroup] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>농작업 선택 목록 관리</h2>
      <p className="muted">
        각 대분류의 세부작업을 추가·수정하세요. 기존 기록의 작업 이름은 바뀌지
        않습니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          const cleaned = Object.fromEntries(
            Object.entries(draft).map(([key, values]) => [
              key,
              Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))),
            ]),
          );
          onSave(cleaned);
        }}
      >
        <fieldset disabled={busy}>
          <label>
            관리할 대분류
            <select
              aria-label="관리할 대분류"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              {workGroupNames(draft).map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            세부작업 목록{" "}
            <small>한 줄에 하나, 분류당 최대 100개 · 이름 100자 이내</small>
            <textarea
              aria-label="세부작업 목록"
              rows={7}
              value={(draft[group] || []).join("\n")}
              onChange={(e) =>
                setDraft({ ...draft, [group]: e.target.value.split("\n") })
              }
            />
          </label>
          <div className="crop-add">
            <label>
              새 대분류
              <input
                maxLength={80}
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!newGroup.trim()}
              onClick={() => {
                const name = newGroup.trim();
                if (draft[name]) {
                  setError("이미 있는 대분류입니다.");
                  return;
                }
                if (Object.keys(draft).length >= 30) {
                  setError("대분류는 최대 30개입니다.");
                  return;
                }
                setDraft({ ...draft, [name]: [] });
                setGroup(name);
                setNewGroup("");
                setError("");
              }}
            >
              대분류 추가
            </button>
          </div>
          <button className="primary">작업 목록 저장</button>
        </fieldset>
      </form>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

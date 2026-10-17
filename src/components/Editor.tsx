import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, ImagePlus, Save } from "lucide-react";
import type { Entry, Kind, Snapshot } from "../lib/types";
import { compressPhoto, rpc, upload } from "../lib/api";
import { readableError, statuses, today } from "../lib/utils.js";
const labels = { log: "작업일지", plan: "연간 계획", resource: "공유 자료" };
export function Editor({
  kind,
  entry,
  snapshot,
  onClose,
  onSaved,
}: {
  kind: Kind;
  entry?: Entry;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<any>(
    entry
      ? { ...entry }
      : {
          kind,
          title: "",
          body: "",
          work_date: today(),
          target_year: Number(today().slice(0, 4)),
          start_date: today(),
          end_date: today(),
          status: "미실행",
          actual_date: "",
          result: "",
          zone: "",
          crop: "",
          assignee: "",
          plan_id: "",
          category: "일반",
          url: "",
        },
  );
  const [base, setBase] = useState(entry);
  const id = useRef(entry?.id || crypto.randomUUID());
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const change = (name: string, value: string) =>
    setForm({ ...form, [name]: value });
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    let remaining = files;
    let savedBody = false;
    try {
      if (!navigator.onLine)
        throw new Error(
          "인터넷 연결이 끊겼습니다. 입력 내용을 유지했으니 연결 후 다시 저장해 주세요.",
        );
      if (
        kind === "resource" &&
        !form.url &&
        !files.length &&
        !snapshot.assets.some((a) => a.entry_id === id.current && a.ready)
      )
        throw new Error("파일 또는 웹링크를 추가해 주세요.");
      if (
        files.length +
          snapshot.assets.filter((a) => a.entry_id === id.current).length >
        10
      )
        throw new Error("첨부파일은 기록당 최대 10개입니다.");
      setProgress("파일 확인 중…");
      remaining = await Promise.all(files.map(compressPhoto));
      setFiles(remaining);
      setProgress("기록 저장 중…");
      const data = {
        ...form,
        kind,
        work_date: kind === "log" ? form.work_date : null,
        target_year: kind === "plan" ? Number(form.target_year) : null,
        start_date: kind === "plan" ? form.start_date : null,
        end_date: kind === "plan" ? form.end_date : null,
        actual_date:
          kind === "plan" && form.actual_date ? form.actual_date : null,
        plan_id: kind === "log" && form.plan_id ? form.plan_id : null,
        assignee: form.assignee || null,
      };
      const saved = await rpc<Entry>("save_entry", {
        p_id: id.current,
        p_version: base?.version || 0,
        p_data: data,
      });
      setBase(saved);
      savedBody = true;
      while (remaining.length) {
        setProgress(`첨부파일 저장 중… ${remaining.length}개 남음`);
        await upload(saved.id, remaining[0]);
        remaining = remaining.slice(1);
        setFiles(remaining);
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(
        readableError(e) +
          (savedBody
            ? " · 본문은 저장되었습니다. 첨부 실패 시 남은 파일만 다시 저장해 주세요."
            : ""),
      );
    } finally {
      saving.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  const input = (
    name: string,
    label: string,
    type = "text",
    required = false,
  ) => (
    <label>
      {label}
      {required && <span className="required"> *</span>}
      <input
        type={type}
        required={required}
        value={form[name] ?? ""}
        onChange={(e) => change(name, e.target.value)}
        maxLength={type === "text" ? 160 : undefined}
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="editor"
      onCancel={(e) => {
        e.preventDefault();
        if (
          !busy &&
          confirm("입력을 닫을까요? 저장하지 않은 내용은 사라집니다.")
        )
          onClose();
      }}
    >
      <form onSubmit={save}>
        <div className="dialog-title">
          <div>
            <span className="eyebrow">함께 남기는 농장의 기록</span>
            <h2>
              {labels[kind]} {entry ? "수정" : "작성"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="닫기"
            disabled={busy}
            onClick={() => {
              if (confirm("입력을 닫을까요? 저장하지 않은 내용은 사라집니다."))
                onClose();
            }}
          >
            <X />
          </button>
        </div>
        <fieldset disabled={busy}>
          {input("title", "제목", "text", true)}
          {kind === "log" && input("work_date", "작업 날짜", "date", true)}
          {kind === "plan" && (
            <>
              <div className="form-grid">
                {input("target_year", "목표 연도", "number", true)}
                <label>
                  진행 상태
                  <select
                    value={form.status}
                    onChange={(e) => change("status", e.target.value)}
                  >
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                {input("start_date", "예정 시작일", "date", true)}
                {input("end_date", "예정 종료일", "date", true)}
              </div>
            </>
          )}
          <label>
            {kind === "log"
              ? "한 일과 실행 결과"
              : kind === "plan"
                ? "계획 내용"
                : "자료 설명"}
            {kind === "log" && <span className="required"> *</span>}
            <textarea
              rows={5}
              maxLength={20000}
              required={kind === "log"}
              placeholder={
                kind === "log"
                  ? "어떤 일을 했고, 결과는 어땠나요? 다음 작업에 참고할 내용도 남겨 주세요."
                  : ""
              }
              value={form.body}
              onChange={(e) => change("body", e.target.value)}
            />
          </label>
          {kind !== "resource" && (
            <div className="form-grid">
              <label>
                구역 <small>선택</small>
                <select
                  value={form.zone}
                  onChange={(e) => change("zone", e.target.value)}
                >
                  <option value="">미지정</option>
                  {Array.from(
                    new Set([
                      ...snapshot.settings.zones,
                      ...(form.zone ? [form.zone] : []),
                    ]),
                  ).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
              <label>
                작물 <small>선택</small>
                <select
                  value={form.crop}
                  onChange={(e) => change("crop", e.target.value)}
                >
                  <option value="">미지정</option>
                  {Array.from(
                    new Set([
                      ...snapshot.settings.crops,
                      ...(form.crop ? [form.crop] : []),
                    ]),
                  ).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {kind === "log" && (
            <label>
              연결할 연간 계획 <small>선택 · 다른 연도 계획도 연결 가능</small>
              <select
                value={form.plan_id}
                onChange={(e) => change("plan_id", e.target.value)}
              >
                <option value="">계획 외 작업</option>
                {snapshot.entries
                  .filter((p) => p.kind === "plan" && !p.deleted_at)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.target_year} · {p.title}
                    </option>
                  ))}
              </select>
              <small>일지를 연결해도 계획은 자동 완료되지 않습니다.</small>
            </label>
          )}
          {kind === "plan" && (
            <>
              <label>
                담당자 <small>선택</small>
                <select
                  value={form.assignee}
                  onChange={(e) => change("assignee", e.target.value)}
                >
                  <option value="">미지정</option>
                  {snapshot.members
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="inset">
                <h3>실행 결과</h3>
                {input(
                  "actual_date",
                  "실제 실행일",
                  "date",
                  form.status === "완료",
                )}
                <label>
                  결과 요약{form.status === "완료" && " *"}
                  <textarea
                    required={form.status === "완료"}
                    rows={3}
                    value={form.result}
                    onChange={(e) => change("result", e.target.value)}
                  />
                </label>
                <small>
                  완료 상태를 선택하면 처리자와 처리 시각이 함께 기록됩니다.
                </small>
              </div>
            </>
          )}
          {kind === "resource" && (
            <div className="form-grid">
              {input("category", "분류", "text", true)}
              {input("url", "웹링크", "url")}
            </div>
          )}
          {kind !== "plan" && (
            <div className="upload-area">
              <ImagePlus size={26} />
              <label htmlFor="attachments">
                {kind === "log" ? "사진 추가" : "파일 추가"}
              </label>
              <input
                id="attachments"
                type="file"
                multiple
                accept={
                  kind === "log"
                    ? "image/jpeg,image/png,image/webp"
                    : ".jpg,.jpeg,.png,.webp,.pdf,.xls,.xlsx,.doc,.docx,.hwp,.hwpx,.txt,.csv"
                }
                onChange={(e) => {
                  setFiles([...files, ...Array.from(e.target.files || [])]);
                  e.target.value = "";
                }}
              />
              <small>
                최대 10개 · 사진은 긴 변 1,600px로 압축, 장당 2MB · 문서 10MB
                <br />
                JPG·PNG·WebP{" "}
                {kind === "resource" && " / PDF·엑셀·워드·한글·TXT·CSV"}
              </small>
              {files.map((f, i) => (
                <div className="selected-file" key={i}>
                  <span>
                    {f.name} ({(f.size / 1024).toFixed(0)}KB)
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  >
                    빼기
                  </button>
                </div>
              ))}
            </div>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        <div className="dialog-footer">
          <small>
            {busy ? progress : "* 필수 항목 · 작성자는 자동으로 기록됩니다."}
          </small>
          <button className="primary" disabled={busy}>
            <Save size={17} />
            {busy ? "저장 중…" : "저장하기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X, ImagePlus, Save } from "lucide-react";
import type { Entry, Kind, Snapshot } from "../lib/types";
import { compressPhoto, rpc, upload } from "../lib/api";
import { activityCategories, recordTitle, workGroupNames } from "../lib/work";
import { MultiChoice } from "./MultiChoice";
import {
  cropsOf,
  zonesOf,
  groupsOf,
  tasksOf,
  plansOf,
  multiRecordTitle,
} from "../lib/work";
import { readableError, statuses, today } from "../lib/utils.js";
const labels = { log: "농작업일지", plan: "농장계획", resource: "자료" };
export function Editor({
  kind,
  entry,
  initial,
  userId,
  snapshot,
  onClose,
  onSaved,
}: {
  kind: Kind;
  entry?: Entry;
  initial?: Partial<Entry> & { photo_first?: boolean; copied?: boolean };
  userId: string;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const enhanced = kind === "log" && !!snapshot.settings.work_catalog;
  const multiAvailable = !!snapshot.settings.multi_recording;
  let recent: {
    crop?: string;
    zone?: string;
    crop_names?: string[];
    zone_names?: string[];
  } = {};
  try {
    recent = JSON.parse(localStorage.getItem(`farm-recent-${userId}`) || "{}");
  } catch {
    /* Optional device preference. */
  }
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
          zone: enhanced ? recent.zone || "" : "",
          crop: enhanced ? recent.crop || "" : "",
          assignee: "",
          plan_id: "",
          category: snapshot.settings.resource_categories?.[0] || "일반",
          url: "",
          record_type: "farm",
          work_group: "",
          work_task: "",
          activity_category:
            initial?.record_type === "activity" ? "회의·운영" : "",
          quantity: "",
          quantity_unit: "",
          participant_ids: [],
          ...initial,
        },
  );
  const activity = form.record_type === "activity";
  const catalog = snapshot.settings.work_catalog || {};
  const multi = enhanced && multiAvailable && !activity;
  const [selectedGroups, setSelectedGroups] = useState(() =>
    groupsOf(entry || initial || {}),
  );
  const [selectedTasks, setSelectedTasks] = useState(() =>
    tasksOf(entry || initial || {}),
  );
  const [selectedCrops, setSelectedCrops] = useState(() =>
    entry || (initial && (initial.crop_names != null || initial.crop))
      ? cropsOf(entry || initial!)
      : recent.crop_names || cropsOf({ crop: recent.crop }),
  );
  const [selectedZones, setSelectedZones] = useState(() =>
    entry || (initial && (initial.zone_names != null || initial.zone))
      ? zonesOf(entry || initial!)
      : recent.zone_names || zonesOf({ zone: recent.zone }),
  );
  const [selectedPlans, setSelectedPlans] = useState(() =>
    plansOf(entry || initial || {}),
  );
  const [customTasks, setCustomTasks] = useState<Record<string, string>>({});
  const [autoTitle, setAutoTitle] = useState(!entry && !initial?.title);
  const [newCrop, setNewCrop] = useState("");
  const [extraCrops, setExtraCrops] = useState<string[]>([]);
  const title =
    enhanced && autoTitle
      ? activity
        ? form.activity_category || "운영·교류"
        : multi
          ? multiRecordTitle({
              crop_names: selectedCrops,
              work_groups: selectedGroups,
              work_items: selectedTasks,
            })
          : recordTitle(form.crop, form.work_task || form.work_group)
      : form.title;
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
    if (initial?.photo_first) document.getElementById("attachments")?.click();
  }, []);
  const change = (name: string, value: string) => {
    if (name === "title") setAutoTitle(false);
    setForm({ ...form, [name]: value });
  };
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
        enhanced &&
        !entry &&
        !activity &&
        !(multi ? selectedGroups.length : form.work_group) &&
        !(multi ? selectedTasks.length : form.work_task) &&
        !form.body.trim() &&
        !files.length &&
        !form.title.trim()
      )
        throw new Error("작업을 선택하거나 사진·메모를 추가해 주세요.");
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
        title,
        ...(multi
          ? {
              work_groups: selectedGroups,
              work_items: selectedTasks,
              crop_names: selectedCrops,
              zone_names: selectedZones,
              plan_ids: selectedPlans,
              work_group: selectedGroups[0] || "",
              work_task: selectedTasks[0]?.task || "",
              crop: selectedCrops[0] || "",
              zone: selectedZones[0] || "",
            }
          : {}),
        quantity:
          form.quantity === "" || form.quantity == null
            ? null
            : Number(form.quantity),
        work_date: kind === "log" ? form.work_date : null,
        target_year: kind === "plan" ? Number(form.target_year) : null,
        start_date: kind === "plan" ? form.start_date : null,
        end_date: kind === "plan" ? form.end_date : null,
        actual_date:
          kind === "plan" && form.actual_date ? form.actual_date : null,
        plan_id: multi
          ? selectedPlans[0] || null
          : kind === "log" && form.plan_id
            ? form.plan_id
            : null,
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
      if (enhanced && !activity) {
        try {
          localStorage.setItem(
            `farm-recent-${userId}`,
            JSON.stringify(
              multi
                ? {
                    crop: selectedCrops[0] || "",
                    zone: selectedZones[0] || "",
                    crop_names: selectedCrops,
                    zone_names: selectedZones,
                  }
                : { crop: form.crop, zone: form.zone },
            ),
          );
        } catch {
          /* Saving records never depends on device preferences. */
        }
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
        maxLength={
          type === "text" ? (name === "quantity_unit" ? 30 : 160) : undefined
        }
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
              {activity && enhanced ? "운영·교류" : labels[kind]}{" "}
              {entry ? "수정" : "작성"}
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
        {initial?.copied && (
          <p className="inset">
            이전 작업 내용을 복사했습니다. 날짜는 오늘, 작성자는 본인으로
            저장됩니다. 사진과 댓글은 복사하지 않습니다.
          </p>
        )}
        <fieldset disabled={busy}>
          {kind === "log" &&
            input(
              "work_date",
              activity ? "활동 날짜" : "작업 날짜",
              "date",
              true,
            )}
          {enhanced && (
            <>
              {!activity && multi ? (
                <>
                  <h3>
                    어떤 작업을 했나요? <small>여러 개 선택 가능</small>
                  </h3>
                  <div
                    className="work-groups"
                    role="group"
                    aria-label="작업 대분류"
                  >
                    {Array.from(
                      new Set([...workGroupNames(catalog), ...selectedGroups]),
                    ).map((group) => (
                      <button
                        key={group}
                        type="button"
                        aria-pressed={selectedGroups.includes(group)}
                        onClick={() => {
                          const removed = selectedGroups.includes(group);
                          setSelectedGroups(
                            removed
                              ? selectedGroups.filter((g) => g !== group)
                              : [...selectedGroups, group],
                          );
                          if (removed)
                            setSelectedTasks(
                              selectedTasks.filter((w) => w.group !== group),
                            );
                        }}
                      >
                        {group}
                      </button>
                    ))}
                  </div>
                  {selectedTasks.some((w) => !w.group) && (
                    <fieldset className="task-selection">
                      <legend>기존 세부작업 · 분류 미지정</legend>
                      <div className="work-tasks">
                        {selectedTasks
                          .filter((w) => !w.group)
                          .map((w) => (
                            <button
                              key={w.task}
                              type="button"
                              aria-pressed="true"
                              onClick={() =>
                                setSelectedTasks(
                                  selectedTasks.filter(
                                    (item) =>
                                      item.group || item.task !== w.task,
                                  ),
                                )
                              }
                            >
                              {w.task}
                            </button>
                          ))}
                      </div>
                    </fieldset>
                  )}
                  {selectedGroups.map((group) => (
                    <fieldset
                      className="task-selection"
                      key={group}
                      aria-label={`${group} 세부작업`}
                    >
                      <legend>{group}</legend>
                      <div className="work-tasks">
                        {Array.from(
                          new Set([
                            ...(catalog[group] || []),
                            ...selectedTasks
                              .filter((w) => w.group === group)
                              .map((w) => w.task),
                          ]),
                        ).map((task) => {
                          const selected = selectedTasks.some(
                            (w) => w.group === group && w.task === task,
                          );
                          return (
                            <button
                              type="button"
                              key={task}
                              aria-pressed={selected}
                              onClick={() =>
                                setSelectedTasks(
                                  selected
                                    ? selectedTasks.filter(
                                        (w) =>
                                          !(
                                            w.group === group && w.task === task
                                          ),
                                      )
                                    : [...selectedTasks, { group, task }],
                                )
                              }
                            >
                              {task}
                            </button>
                          );
                        })}
                      </div>
                      <div className="crop-add">
                        <label>
                          직접 입력
                          <input
                            aria-label={`${group} 작업 직접 입력`}
                            maxLength={100}
                            value={customTasks[group] || ""}
                            onChange={(e) =>
                              setCustomTasks({
                                ...customTasks,
                                [group]: e.target.value,
                              })
                            }
                          />
                        </label>
                        <button
                          type="button"
                          disabled={!customTasks[group]?.trim()}
                          onClick={() => {
                            const task = customTasks[group].trim();
                            if (
                              !selectedTasks.some(
                                (w) => w.group === group && w.task === task,
                              )
                            )
                              setSelectedTasks([
                                ...selectedTasks,
                                { group, task },
                              ]);
                            setCustomTasks({ ...customTasks, [group]: "" });
                          }}
                        >
                          작업 추가
                        </button>
                      </div>
                    </fieldset>
                  ))}
                </>
              ) : !activity ? (
                <>
                  <h3>어떤 작업을 했나요?</h3>
                  <div
                    className="work-groups"
                    role="group"
                    aria-label="작업 대분류"
                  >
                    {Array.from(
                      new Set([
                        ...workGroupNames(catalog),
                        ...(form.work_group ? [form.work_group] : []),
                      ]),
                    ).map((group) => (
                      <button
                        key={group}
                        type="button"
                        aria-pressed={form.work_group === group}
                        onClick={() =>
                          setForm({ ...form, work_group: group, work_task: "" })
                        }
                      >
                        {group}
                      </button>
                    ))}
                  </div>
                  {form.work_group && (
                    <div
                      className="work-tasks"
                      role="group"
                      aria-label="세부작업 선택"
                    >
                      {(catalog[form.work_group] || []).map((task) => (
                        <button
                          type="button"
                          key={task}
                          aria-pressed={form.work_task === task}
                          onClick={() => change("work_task", task)}
                        >
                          {task}
                        </button>
                      ))}
                    </div>
                  )}
                  <label>
                    세부작업 · 직접 입력 가능
                    <input
                      aria-label="세부작업"
                      maxLength={100}
                      value={form.work_task || ""}
                      onChange={(e) => change("work_task", e.target.value)}
                      placeholder="목록에서 선택하거나 직접 입력하세요"
                    />
                  </label>
                </>
              ) : (
                <label>
                  활동 분류
                  <select
                    aria-label="활동 분류"
                    value={form.activity_category}
                    onChange={(e) =>
                      change("activity_category", e.target.value)
                    }
                  >
                    {activityCategories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                제목{" "}
                <small>
                  {autoTitle
                    ? "선택한 작업으로 자동 생성 · 직접 수정 가능"
                    : "직접 입력"}
                </small>
                <input
                  aria-label="제목"
                  maxLength={160}
                  value={title}
                  onChange={(e) => change("title", e.target.value)}
                />
              </label>
            </>
          )}
          {!enhanced && input("title", "제목", "text", true)}
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
              ? enhanced
                ? activity
                  ? "활동 내용"
                  : "작업 내용 및 특이사항"
                : "한 일과 실행 결과"
              : kind === "plan"
                ? "계획 내용"
                : "자료 설명"}
            {kind === "log" && !enhanced && (
              <span className="required"> *</span>
            )}
            <textarea
              rows={5}
              maxLength={20000}
              required={kind === "log" && !enhanced}
              placeholder={
                kind === "log"
                  ? "어떤 일을 했고, 결과는 어땠나요? 다음 작업에 참고할 내용도 남겨 주세요."
                  : ""
              }
              value={form.body}
              onChange={(e) => change("body", e.target.value)}
            />
          </label>
          {multi && (
            <div className="form-grid">
              <MultiChoice
                label="작업 장소"
                values={selectedZones}
                options={Array.from(
                  new Set([...snapshot.settings.zones, ...selectedZones]),
                ).map((value) => ({ value, label: value }))}
                onChange={setSelectedZones}
              />
              <MultiChoice
                label="작물"
                values={selectedCrops}
                options={Array.from(
                  new Set([
                    ...snapshot.settings.crops,
                    ...extraCrops,
                    ...selectedCrops,
                  ]),
                ).map((value) => ({ value, label: value }))}
                onChange={setSelectedCrops}
              />
            </div>
          )}
          {kind !== "resource" && !activity && !multi && (
            <div className="form-grid">
              <label>
                {enhanced ? "작업 장소" : "구역"} <small>선택</small>
                <select
                  aria-label={enhanced ? "작업 장소" : "구역"}
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
                  aria-label="작물"
                  value={form.crop}
                  onChange={(e) => change("crop", e.target.value)}
                >
                  <option value="">미지정</option>
                  {Array.from(
                    new Set([
                      ...snapshot.settings.crops,
                      ...extraCrops,
                      ...(form.crop ? [form.crop] : []),
                    ]),
                  ).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {enhanced && !activity && (
            <div className="crop-add">
              <label>
                새 작물 이름
                <input
                  aria-label="새 작물 이름"
                  value={newCrop}
                  maxLength={80}
                  onChange={(e) => setNewCrop(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={!newCrop.trim()}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await rpc("add_crop", { p_crop: newCrop });
                    setExtraCrops([...extraCrops, newCrop.trim()]);
                    if (multi)
                      setSelectedCrops(
                        Array.from(new Set([...selectedCrops, newCrop.trim()])),
                      );
                    else change("crop", newCrop.trim());
                    setNewCrop("");
                  } catch (e) {
                    setError(readableError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                작물 등록
              </button>
            </div>
          )}
          {enhanced && (
            <details className="optional-fields">
              <summary>작업량·참여자 추가 (선택)</summary>
              {!activity && (
                <div className="form-grid">
                  <label>
                    작업량
                    <input
                      aria-label="작업량"
                      type="number"
                      min="0"
                      max="999999999"
                      step="any"
                      value={form.quantity ?? ""}
                      onChange={(e) => change("quantity", e.target.value)}
                    />
                  </label>
                  {input("quantity_unit", "단위")}
                </div>
              )}
              <fieldset>
                <legend>참여자</legend>
                <div className="participant-options">
                  {snapshot.members
                    .filter(
                      (m) =>
                        m.active || form.participant_ids?.includes(m.user_id),
                    )
                    .map((m) => (
                      <label key={m.user_id}>
                        <input
                          type="checkbox"
                          checked={(form.participant_ids || []).includes(
                            m.user_id,
                          )}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              participant_ids: e.target.checked
                                ? [...(form.participant_ids || []), m.user_id]
                                : form.participant_ids.filter(
                                    (id: string) => id !== m.user_id,
                                  ),
                            })
                          }
                        />
                        {m.display_name}
                      </label>
                    ))}
                </div>
              </fieldset>
            </details>
          )}
          {multi && (
            <>
              <MultiChoice
                label="관련 농장계획"
                values={selectedPlans}
                options={Array.from(
                  new Set([
                    ...snapshot.entries
                      .filter((p) => p.kind === "plan" && !p.deleted_at)
                      .map((p) => p.id),
                    ...selectedPlans,
                  ]),
                ).map((value) => {
                  const plan = snapshot.entries.find((p) => p.id === value);
                  return {
                    value,
                    label: plan
                      ? `${plan.target_year} · ${plan.title}`
                      : "이전 연결 계획",
                  };
                })}
                onChange={setSelectedPlans}
              />
              <small>
                계획을 선택하지 않아도 저장할 수 있으며, 연결만으로 완료되지
                않습니다.
              </small>
            </>
          )}
          {kind === "log" && !multi && (
            <label>
              관련 농장계획 <small>선택 · 다른 연도 계획도 연결 가능</small>
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
              {snapshot.settings.resource_categories ? (
                <label>
                  분류 *
                  <select
                    required
                    value={form.category}
                    onChange={(e) => change("category", e.target.value)}
                  >
                    {Array.from(
                      new Set([
                        ...snapshot.settings.resource_categories,
                        ...(entry?.category ? [entry.category] : []),
                      ]),
                    ).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <small>
                    새 분류는 관리자가 농장 관리 → 자료함 분류 관리에서 추가할
                    수 있습니다.
                  </small>
                </label>
              ) : (
                input("category", "분류", "text", true)
              )}
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

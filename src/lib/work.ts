import type { Entry } from "./types";
export const defaultWorkCatalog: Record<string, string[]> = {
  "재배준비·심기": [
    "경운",
    "두둑 만들기",
    "멀칭",
    "육묘",
    "파종",
    "정식",
    "보식",
  ],
  "물·양분 관리": ["관수", "배수", "퇴비 주기", "밑거름", "웃거름", "액비"],
  생육관리: ["솎기", "순지르기", "가지치기", "유인", "지주 설치", "적화·적과"],
  "잡초·병해충": ["제초", "병해충 예찰", "방제", "피해 조사"],
  "수확·수확 후": ["수확", "탈곡", "선별", "세척", "건조", "저장", "포장"],
  "시설·환경": ["하우스 환기", "온습도 조절", "차광", "보온", "시설 수리"],
  "관찰·점검": [
    "생육 관찰",
    "발아 확인",
    "토양 상태",
    "병징 관찰",
    "사진 기록",
  ],
  "기타 농작업": [],
};
export const activityCategories = [
  "회의·운영",
  "교육·견학",
  "행사·교류",
  "판매·홍보",
  "나눔·봉사",
  "자재·행정",
];
export function isActivity(e: Partial<Entry>) {
  return e.kind === "log" && e.record_type === "activity";
}
export function recordTitle(crop: string, task: string) {
  return [crop, task || "사진 기록"].filter(Boolean).join(" · ");
}

export function workGroupNames(catalog: Record<string, string[]>) {
  return [
    ...Object.keys(defaultWorkCatalog).filter((g) => g in catalog),
    ...Object.keys(catalog).filter((g) => !(g in defaultWorkCatalog)),
  ];
}

export function choiceValues(
  values: string[] | null | undefined,
  legacy: string | null | undefined,
): string[] {
  return values ?? (legacy ? [legacy] : []);
}
export const cropsOf = (e: Partial<Entry>) =>
  choiceValues(e.crop_names, e.crop);
export const zonesOf = (e: Partial<Entry>) =>
  choiceValues(e.zone_names, e.zone);
export const groupsOf = (e: Partial<Entry>) =>
  choiceValues(e.work_groups, e.work_group);
export const plansOf = (e: Partial<Entry>) =>
  choiceValues(e.plan_ids, e.plan_id);
export const tasksOf = (e: Partial<Entry>) =>
  e.work_items ??
  (e.work_task ? [{ group: e.work_group || "", task: e.work_task }] : []);
export const hasPlan = (e: Partial<Entry>, id: string) =>
  plansOf(e).includes(id);
export function multiRecordTitle(e: Partial<Entry>) {
  return recordTitle(
    cropsOf(e).join(", "),
    tasksOf(e)
      .map((w) => w.task)
      .join(", ") || groupsOf(e).join(", "),
  ).slice(0, 160);
}

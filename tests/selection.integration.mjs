import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (process.env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Isolated local tests only.");
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const users = {};
for (const who of ["admin", "a", "b", "viewer", "outside"]) {
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  assert.ifError((await db.auth.signInWithPassword(fixtures.users[who])).error);
  users[who] = db;
}
const { admin, a, b, viewer, outside } = users;
async function rpc(db, name, args) {
  const r = await db.rpc(name, args);
  assert.ifError(r.error);
  return r.data;
}
async function denied(db, name, args) {
  assert.ok((await db.rpc(name, args)).error);
}
let farm, activity, plan;
const data = {
  kind: "log",
  record_type: "farm",
  work_date: "2026-10-19",
  work_group: "잡초·병해충",
  work_task: "제초",
  crop: "들깨",
  zone: "[검수용] 구역",
  body: "",
  quantity: 2.5,
  quantity_unit: "두둑",
  participant_ids: [fixtures.users.b.id],
};

await test("선택한 작업·작물로 제목 자동 생성, 빈 메모·작업량·참여자 저장 및 공유", async () => {
  farm = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: data,
  });
  assert.equal(farm.title, "들깨 · 제초");
  assert.equal(farm.body, "");
  assert.equal(farm.quantity, 2.5);
  assert.deepEqual(farm.participant_ids, [fixtures.users.b.id]);
  assert.equal(
    (await b.from("entries").select("*").eq("id", farm.id).single()).data
      .work_task,
    "제초",
  );
});
await test("사진 우선 임시 기록은 제목·메모·분류 없이 저장, 농작업 제목에 운영 분류 혼입 없음", async () => {
  const photo = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "log",
      record_type: "farm",
      work_date: "2026-10-19",
      title: "",
      body: "",
      activity_category: "회의·운영",
    },
  });
  assert.equal(photo.title, "사진 기록");
  assert.equal(photo.work_group, "");
  assert.equal(photo.body, "");
});
await test("운영·교류와 농작업을 같은 계획에 연결, 날짜 보존·자동 완료 없음", async () => {
  plan = await rpc(admin, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "plan",
      title: "[검수용] 선택 기록 계획",
      target_year: 2027,
      start_date: "2027-01-01",
      end_date: "2027-02-01",
    },
  });
  activity = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "log",
      record_type: "activity",
      activity_category: "교육·견학",
      work_date: "2026-10-18",
      plan_id: plan.id,
      body: "",
    },
  });
  assert.equal(activity.title, "교육·견학");
  farm = await rpc(a, "save_entry", {
    p_id: farm.id,
    p_version: farm.version,
    p_data: { ...farm, plan_id: plan.id },
  });
  const rows = (
    await b
      .from("entries")
      .select("*")
      .eq("plan_id", plan.id)
      .order("work_date")
  ).data;
  assert.deepEqual(
    rows.map((r) => r.id),
    [activity.id, farm.id],
  );
  assert.equal(
    (await b.from("entries").select("*").eq("id", plan.id).single()).data
      .status,
    "미실행",
  );
});
await test("본인 수정·관리자 수정 및 기존 클라이언트 편집 시 선택형 필드 보존", async () => {
  await denied(b, "save_entry", {
    p_id: farm.id,
    p_version: farm.version,
    p_data: { ...farm, work_task: "변조" },
  });
  const previous = farm;
  farm = await rpc(a, "save_entry", {
    p_id: farm.id,
    p_version: farm.version,
    p_data: {
      kind: "log",
      title: farm.title,
      body: "기존 화면 편집",
      work_date: farm.work_date,
      plan_id: farm.plan_id,
    },
  });
  for (const key of [
    "record_type",
    "work_group",
    "work_task",
    "quantity",
    "quantity_unit",
    "participant_ids",
  ])
    assert.deepEqual(farm[key], previous[key]);
  await denied(a, "save_entry", {
    p_id: farm.id,
    p_version: previous.version,
    p_data: farm,
  });
  farm = await rpc(admin, "save_entry", {
    p_id: farm.id,
    p_version: farm.version,
    p_data: { ...farm, quantity: 3 },
  });
  assert.equal(farm.author_id, fixtures.users.a.id);
  assert.equal(farm.quantity, 3);
});
await test("작업 목록 관리자 전용 변경·기록 보존, 참여자 작물 등록과 열람자 차단", async () => {
  const settings = (await admin.from("farm_settings").select("*").single())
    .data;
  assert.equal(Object.keys(settings.work_catalog).length >= 8, true);
  const next = {
    ...settings.work_catalog,
    "관찰·점검": ["[검수용] 새 관찰", "사진 기록"],
  };
  const args = { p_version: settings.version, p_catalog: next };
  for (const db of [a, viewer, outside])
    await denied(db, "save_work_catalog", args);
  await rpc(admin, "save_work_catalog", args);
  assert.deepEqual(
    (await b.from("farm_settings").select("*").single()).data.work_catalog[
      "관찰·점검"
    ],
    next["관찰·점검"],
  );
  await denied(admin, "save_work_catalog", args);
  const current = (await admin.from("farm_settings").select("*").single()).data;
  for (const bad of [[], {}, { "": [] }, { 분류: [42] }, { 분류: [""] }])
    await denied(admin, "save_work_catalog", {
      p_version: current.version,
      p_catalog: bad,
    });
  await rpc(admin, "save_work_catalog", {
    p_version: current.version,
    p_catalog: settings.work_catalog,
  });
  await rpc(a, "add_crop", { p_crop: "[검수용] 새 작물" });
  await rpc(a, "add_crop", { p_crop: "[검수용] 새 작물" });
  assert.equal(
    (await b.from("farm_settings").select("*").single()).data.crops.filter(
      (c) => c === "[검수용] 새 작물",
    ).length,
    1,
  );
  for (const db of [viewer, outside])
    await denied(db, "add_crop", { p_crop: "금지" });
});
await test("열람자·미초대 계정 쓰기 차단, 부적절한 작업량·참여자·활동 분류 거부", async () => {
  for (const db of [viewer, outside])
    await denied(db, "save_entry", {
      p_id: randomUUID(),
      p_version: 0,
      p_data: data,
    });
  for (const patch of [
    { quantity: -1 },
    { participant_ids: [randomUUID()] },
    { record_type: "other" },
    { record_type: "activity", activity_category: "없는 분류" },
  ])
    await denied(a, "save_entry", {
      p_id: randomUUID(),
      p_version: 0,
      p_data: { ...data, ...patch },
    });
  assert.equal(
    (await outside.from("entries").select("*").eq("id", farm.id)).data.length,
    0,
  );
});
await test("추가 마이그레이션 재실행은 기존 일지·계획·사진·작성자·버전을 바꾸지 않음", async () => {
  const before = (
    await admin.from("entries").select("*").eq("id", fixtures.log.id).single()
  ).data;
  const assets = (
    await admin.from("assets").select("*").eq("entry_id", fixtures.log.id)
  ).data;
  assert.equal(before.record_type, null);
  assert.equal(before.work_group, "");
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "farm-test-db",
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: readFileSync(
        "supabase/migrations/202610200001_multi_recording.sql",
      ),
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  assert.deepEqual(
    (await admin.from("entries").select("*").eq("id", before.id).single()).data,
    before,
  );
  assert.deepEqual(
    (await admin.from("assets").select("*").eq("entry_id", before.id)).data,
    assets,
  );
});
for (const db of Object.values(users)) await db.auth.signOut();

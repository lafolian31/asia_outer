import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (process.env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Local multi-selection tests only.");
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const clients = {};
for (const who of ["admin", "a", "b", "viewer", "outside"]) {
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  assert.ifError((await db.auth.signInWithPassword(fixtures.users[who])).error);
  clients[who] = db;
}
const { admin, a, b, viewer, outside } = clients;
async function rpc(db, name, args) {
  const r = await db.rpc(name, args);
  assert.ifError(r.error);
  return r.data;
}
async function denied(db, name, args) {
  assert.ok((await db.rpc(name, args)).error, name);
}
const makePlan = () =>
  rpc(admin, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "plan",
      title: "[검수용] 복수 계획 " + randomUUID(),
      target_year: 2026,
      start_date: "2026-10-20",
      end_date: "2026-10-20",
    },
  });
const p1 = await makePlan(),
  p2 = await makePlan();
const multi = {
  kind: "log",
  record_type: "farm",
  work_date: "2026-10-20",
  body: "[검수용] 여러 작업",
  work_groups: ["잡초·병해충", "물·양분 관리"],
  work_items: [
    { group: "잡초·병해충", task: "제초" },
    { group: "물·양분 관리", task: "관수" },
  ],
  crop_names: ["들깨", "고추"],
  zone_names: ["[검수용] 안녕동", "[검수용] 두번째 밭"],
  plan_ids: [p1.id, p2.id],
  participant_ids: [fixtures.users.a.id, fixtures.users.b.id],
};
let log;
await test("작업·작물·장소·계획 복수 저장, 자동 제목·대표 값 및 계획 관계 공유", async () => {
  log = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: multi,
  });
  for (const key of [
    "work_groups",
    "work_items",
    "crop_names",
    "zone_names",
    "plan_ids",
  ])
    assert.deepEqual(log[key], multi[key]);
  assert.equal(log.title, "들깨, 고추 · 제초, 관수");
  assert.equal(log.crop, "들깨");
  assert.equal(log.plan_id, p1.id);
  const shared = await b.from("entries").select("*").eq("id", log.id).single();
  assert.ifError(shared.error);
  assert.deepEqual(shared.data.work_items, multi.work_items);
  const links = await b
    .from("entry_plan_links")
    .select("*")
    .eq("entry_id", log.id);
  assert.ifError(links.error);
  assert.equal(links.data.length, 2);
  assert.equal(
    (await outside.from("entry_plan_links").select("*").eq("entry_id", log.id))
      .data.length,
    0,
  );
});
await test("타인·열람자·미초대 변경 및 계획 관계 직접 쓰기 차단", async () => {
  for (const db of [b, viewer, outside])
    await denied(db, "save_entry", {
      p_id: log.id,
      p_version: log.version,
      p_data: { ...log, crop_names: ["변조"] },
    });
  assert.ok(
    (
      await a
        .from("entry_plan_links")
        .insert({ entry_id: log.id, plan_id: p1.id })
    ).error,
  );
});
await test("두번째 연결 계획도 영구 삭제 보호, 연결만으로 계획 완료 안 함", async () => {
  await rpc(admin, "trash_entry", { p_id: p2.id, p_version: p2.version });
  await denied(admin, "purge_entry", { p_id: p2.id });
  await rpc(admin, "trash_entry", {
    p_id: p2.id,
    p_version: p2.version + 1,
    p_restore: true,
  });
  assert.equal(
    (await admin.from("entries").select("*").eq("id", p2.id).single()).data
      .status,
    "미실행",
  );
});
await test("대표 값만 아는 이전 클라이언트로 메모 수정해도 복수 값 유지", async () => {
  const old = log;
  log = await rpc(a, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: {
      kind: "log",
      title: log.title,
      body: "이전 입력 화면의 메모 수정",
      work_date: log.work_date,
      crop: log.crop,
      zone: log.zone,
      work_group: log.work_group,
      work_task: log.work_task,
      plan_id: log.plan_id,
      record_type: "farm",
    },
  });
  for (const key of [
    "work_groups",
    "work_items",
    "crop_names",
    "zone_names",
    "plan_ids",
  ])
    assert.deepEqual(log[key], old[key]);
  await denied(a, "save_entry", {
    p_id: log.id,
    p_version: old.version,
    p_data: log,
  });
});
await test("복수 선택 수정·전체 해제 및 중복 값 정리, 연관 계획 관계 동기화", async () => {
  log = await rpc(admin, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: {
      ...log,
      crop_names: ["고추", " 고추 "],
      plan_ids: [p2.id, p2.id],
    },
  });
  assert.deepEqual(log.crop_names, ["고추"]);
  assert.equal(log.crop, "고추");
  assert.equal(log.plan_id, p2.id);
  assert.equal(log.author_id, fixtures.users.a.id);
  assert.equal(
    (await admin.from("entry_plan_links").select("*").eq("entry_id", log.id))
      .data.length,
    1,
  );
  log = await rpc(a, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: {
      ...log,
      work_groups: [],
      work_items: [],
      crop_names: [],
      zone_names: [],
      plan_ids: [],
    },
  });
  assert.equal(log.plan_id, null);
  assert.equal(log.crop, "");
  assert.equal(log.work_task, "");
  assert.equal(
    (await admin.from("entry_plan_links").select("*").eq("entry_id", log.id))
      .data.length,
    0,
  );
  // Leave a complete multi-value record available to independent backup checks.
  log = await rpc(a, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: { ...multi, title: "[검수용] 복수 값 백업" },
  });
});
await test("존재하지 않는 계획·비계획·잘못된 작업·빈 값·상한 초과 거부", async () => {
  for (const patch of [
    { plan_ids: [randomUUID()] },
    { plan_ids: [log.id] },
    { crop_names: [null] },
    { zone_names: [""] },
    { work_groups: Array(31).fill("그룹") },
    { work_items: [{ group: "다른 그룹", task: "잘못된 작업" }] },
    { work_items: [{ group: "잡초·병해충", task: 42 }] },
    { work_items: {} },
  ])
    await denied(a, "save_entry", {
      p_id: randomUUID(),
      p_version: 0,
      p_data: { ...multi, ...patch },
    });
});
await test("기존 단일 기록·사진 그대로 유지, 실제 기존 연결도 관계 테이블에 보존", async () => {
  const legacy = await admin
    .from("entries")
    .select("*")
    .eq("id", fixtures.log.id)
    .single();
  assert.ifError(legacy.error);
  assert.equal(legacy.data.crop_names, null);
  assert.equal(legacy.data.plan_ids, null);
  if (legacy.data.plan_id)
    assert.equal(
      (
        await admin
          .from("entry_plan_links")
          .select("*")
          .eq("entry_id", legacy.data.id)
      ).data[0].plan_id,
      legacy.data.plan_id,
    );
  assert.ok(
    (await admin.from("assets").select("*").eq("entry_id", fixtures.log.id))
      .data.length > 0,
  );
});
await test("대분류 없이 직접 입력했던 기존 세부작업도 복수 선택 편집에서 보존", async () => {
  const legacy = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "log",
      work_date: "2026-10-20",
      title: "[검수용] 이전 직접 입력",
      body: "이전 방식",
      work_task: "이전 직접 작업",
    },
  });
  const edited = await rpc(a, "save_entry", {
    p_id: legacy.id,
    p_version: legacy.version,
    p_data: {
      ...legacy,
      work_groups: [],
      work_items: [{ group: "", task: "이전 직접 작업" }],
      crop_names: [],
      zone_names: [],
      plan_ids: [],
    },
  });
  assert.equal(edited.work_task, "이전 직접 작업");
  assert.deepEqual(edited.work_groups, []);
  assert.equal(edited.work_items[0].group, "");
});
for (const db of Object.values(clients)) await db.auth.signOut();

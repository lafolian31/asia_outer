import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL,
  anon = process.env.SUPABASE_ANON_KEY;
if (url !== "http://127.0.0.1:54321")
  throw Error(
    "Integration tests are allowed ONLY on the isolated local test stack.",
  );
const client = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY);
const users = {};
const run = Date.now();
for (const who of ["admin", "a", "b", "viewer", "outside", "invited"]) {
  const email = `test-${who}-${run}@example.test`,
    password = randomBytes(24).toString("hex");
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.ifError(error);
  const c = client(anon);
  assert.ifError((await c.auth.signInWithPassword({ email, password })).error);
  users[who] = { id: data.user.id, email, password, c };
  if (!["outside", "invited"].includes(who))
    assert.ifError(
      (
        await service.from("members").insert({
          user_id: data.user.id,
          display_name: `[시험] ${who}`,
          role:
            who === "admin" ? "admin" : who === "viewer" ? "viewer" : "editor",
        })
      ).error,
    );
}
const { admin, a, b, viewer, outside, invited } = users;
async function rpc(user, name, args) {
  const r = await user.c.rpc(name, args);
  assert.ifError(r.error);
  return r.data;
}
async function denied(user, name, args) {
  const r = await user.c.rpc(name, args);
  assert.ok(r.error, `${name} must be denied`);
}
const base = (kind = "log") => ({
  kind,
  title: "[시험] 작업일지 " + run,
  body: "[시험 전용] 물주기 결과 확인",
  work_date: "2026-10-16",
});
let log, plan, asset, resource;
await test("A가 저장한 기록을 B가 조회하고 작성자 위조는 서버가 무시", async () => {
  log = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      ...base(),
      author_id: b.id,
      created_at: "2000-01-01",
      version: 99,
    },
  });
  assert.equal(log.author_id, a.id);
  assert.equal(log.version, 1);
  const r = await b.c.from("entries").select("*").eq("id", log.id).single();
  assert.ifError(r.error);
  assert.equal(r.data.body, log.body);
});
await test("다른 참여자의 직접 RPC 수정·삭제와 직접 테이블 수정 차단", async () => {
  await denied(b, "save_entry", {
    p_id: log.id,
    p_version: 1,
    p_data: { ...log, title: "침범" },
  });
  await denied(b, "trash_entry", { p_id: log.id, p_version: 1 });
  assert.ok(
    (await b.c.from("entries").update({ title: "침범" }).eq("id", log.id))
      .error,
  );
  assert.ok(
    (await b.c.from("members").update({ role: "admin" }).eq("user_id", b.id))
      .error,
  );
});
await test("A 본인 수정과 오래된 버전 충돌 감지", async () => {
  log = await rpc(a, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: { ...log, title: "[시험] 수정한 물주기 " + run },
  });
  await denied(a, "save_entry", {
    p_id: log.id,
    p_version: 1,
    p_data: { ...log, title: "오래된 수정" },
  });
});
await test("중복 저장 요청으로 중복 기록이 생기지 않음", async () => {
  const id = randomUUID();
  const r = await Promise.all([
    a.c.rpc("save_entry", { p_id: id, p_version: 0, p_data: base() }),
    a.c.rpc("save_entry", { p_id: id, p_version: 0, p_data: base() }),
  ]);
  assert.equal(r.filter((x) => !x.error).length, 1);
  const data = await a.c.from("entries").select("id").eq("id", id);
  assert.equal(data.data.length, 1);
});
await test("열람자 작성·수정·삭제 차단 / 비참여자는 데이터 조회 불가", async () => {
  await denied(viewer, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: base(),
  });
  await denied(viewer, "trash_entry", { p_id: log.id, p_version: log.version });
  assert.equal((await outside.c.from("entries").select("*")).data.length, 0);
  assert.equal(
    (await outside.c.from("farm_settings").select("*")).data.length,
    0,
  );
});
await test("다른 참여자의 계획에 연도를 넘긴 일지 연결, 자동 완료 금지", async () => {
  plan = await rpc(b, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "plan",
      title: "[시험] 2025 겨울 준비 " + run,
      body: "시험 계획",
      target_year: 2025,
      start_date: "2025-12-20",
      end_date: "2025-12-31",
      status: "미실행",
    },
  });
  log = await rpc(a, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: { ...log, plan_id: plan.id, work_date: "2026-01-03" },
  });
  assert.equal(log.plan_id, plan.id);
  assert.equal(
    (await a.c.from("entries").select("status").eq("id", plan.id).single()).data
      .status,
    "미실행",
  );
  await denied(a, "save_entry", {
    p_id: plan.id,
    p_version: plan.version,
    p_data: {
      ...plan,
      status: "완료",
      actual_date: "2026-01-03",
      result: "완료",
    },
  });
});
await test("완료 시 실제 실행일·결과 필수, 완료자와 시각 저장", async () => {
  await denied(b, "save_entry", {
    p_id: plan.id,
    p_version: plan.version,
    p_data: { ...plan, status: "완료" },
  });
  plan = await rpc(b, "save_entry", {
    p_id: plan.id,
    p_version: plan.version,
    p_data: {
      ...plan,
      status: "완료",
      actual_date: "2026-01-03",
      result: "[시험] 겨울 준비 완료",
    },
  });
  assert.equal(plan.completed_by, b.id);
  assert.ok(plan.completed_at);
  assert.equal(plan.target_year, 2025);
  const r = await a.c.from("entries").select("*").eq("target_year", 2025);
  assert.ok(r.data.some((e) => e.id === plan.id));
});
await test("잘못된 계획·날짜·위험 링크와 존재하지 않는 계획 연결 차단", async () => {
  for (const data of [
    { ...base(), plan_id: randomUUID() },
    {
      kind: "plan",
      title: "x",
      target_year: 2026,
      start_date: "2026-02-20",
      end_date: "2026-01-01",
    },
    { kind: "resource", title: "x", url: "javascript:alert(1)" },
  ])
    await denied(a, "save_entry", {
      p_id: randomUUID(),
      p_version: 0,
      p_data: data,
    });
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6FoEAAAAASUVORK5CYII=",
  "base64",
);
await test("A 사진 업로드·확정 후 B가 동일 사진 다운로드", async () => {
  asset = await rpc(a, "reserve_asset", {
    p_id: randomUUID(),
    p_entry: log.id,
    p_name: "시험사진.png",
    p_mime: "image/png",
    p_size: png.length,
  });
  assert.ifError(
    (
      await a.c.storage
        .from("farm-files")
        .upload(asset.path, png, { contentType: "image/png" })
    ).error,
  );
  await rpc(a, "finish_asset", { p_id: asset.id });
  const r = await b.c.storage.from("farm-files").download(asset.path);
  assert.ifError(r.error);
  assert.deepEqual(Buffer.from(await r.data.arrayBuffer()), png);
});
await test("비참여자·익명 파일 다운로드와 타인 파일 업로드·덮어쓰기 차단", async () => {
  for (const user of [outside, { c: client(anon) }])
    assert.ok(
      (await user.c.storage.from("farm-files").download(asset.path)).error,
    );
  assert.ok(
    (
      await b.c.storage
        .from("farm-files")
        .upload(asset.path, png, { contentType: "image/png", upsert: true })
    ).error,
  );
  await denied(b, "reserve_asset", {
    p_id: randomUUID(),
    p_entry: log.id,
    p_name: "a.png",
    p_mime: "image/png",
    p_size: 10,
  });
  await denied(viewer, "reserve_asset", {
    p_id: randomUUID(),
    p_entry: log.id,
    p_name: "a.png",
    p_mime: "image/png",
    p_size: 10,
  });
  const publicRes = await fetch(
    `${url}/storage/v1/object/public/farm-files/${asset.path}`,
  );
  assert.equal(publicRes.ok, false);
});
await test("문서 등록·검색·다운로드 및 파일 한도", async () => {
  resource = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind: "resource",
      title: "[시험] 농장 안내문 " + run,
      body: "한글 자료 검색 검증",
      category: "안내",
      url: "https://example.com",
    },
  });
  const bytes = Buffer.from("시험 전용 문서\n한글 내용", "utf8");
  const file = await rpc(a, "reserve_asset", {
    p_id: randomUUID(),
    p_entry: resource.id,
    p_name: "안내문.txt",
    p_mime: "text/plain",
    p_size: bytes.length,
  });
  assert.ifError(
    (
      await a.c.storage
        .from("farm-files")
        .upload(file.path, bytes, { contentType: "text/plain" })
    ).error,
  );
  await rpc(a, "finish_asset", { p_id: file.id });
  assert.equal(
    await (
      await b.c.storage.from("farm-files").download(file.path)
    ).data.text(),
    bytes.toString(),
  );
  assert.equal(
    (
      await b.c
        .from("entries")
        .select("*")
        .ilike("title", "%농장 안내문%")
        .eq("author_id", a.id)
    ).data.length,
    1,
  );
  for (const [name, mime, size] of [
    ["big.pdf", "application/pdf", 10485761],
    ["big.jpg", "image/jpeg", 2097153],
    ["bad.html", "text/html", 10],
  ])
    await denied(a, "reserve_asset", {
      p_id: randomUUID(),
      p_entry: log.id,
      p_name: name,
      p_mime: mime,
      p_size: size,
    });
});
await test("휴지통 숨김·사진 접근 차단·관리자 복원", async () => {
  await rpc(a, "trash_entry", { p_id: log.id, p_version: log.version });
  assert.equal(
    (await b.c.from("entries").select("*").eq("id", log.id)).data.length,
    0,
  );
  assert.ok((await b.c.storage.from("farm-files").download(asset.path)).error);
  const deleted = (
    await admin.c.from("entries").select("*").eq("id", log.id).single()
  ).data;
  await denied(a, "trash_entry", {
    p_id: log.id,
    p_version: deleted.version,
    p_restore: true,
  });
  await rpc(admin, "trash_entry", {
    p_id: log.id,
    p_version: deleted.version,
    p_restore: true,
  });
  assert.ifError(
    (await b.c.storage.from("farm-files").download(asset.path)).error,
  );
  log = (await a.c.from("entries").select("*").eq("id", log.id).single()).data;
});
await test("관리자는 다른 사람 기록 수정 가능, 작성자는 보존", async () => {
  log = await rpc(admin, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: { ...log, title: "[시험] 관리자가 확인한 물주기 " + run },
  });
  assert.equal(log.author_id, a.id);
  assert.equal(log.updated_by, admin.id);
});
await test("마지막 관리자 해제 및 참여자 권한 상승 차단", async () => {
  const admins = (
    await service
      .from("members")
      .select("*")
      .eq("role", "admin")
      .eq("active", true)
  ).data;
  for (const other of admins.filter((x) => x.user_id !== admin.id))
    await service
      .from("members")
      .update({ active: false })
      .eq("user_id", other.user_id);
  await denied(admin, "update_member", {
    p_user: admin.id,
    p_role: "editor",
    p_active: true,
  });
  await denied(a, "update_member", {
    p_user: a.id,
    p_role: "admin",
    p_active: true,
  });
});
await test("역할 변경은 기존 로그인 세션의 후속 요청에 반영", async () => {
  await rpc(admin, "update_member", {
    p_user: a.id,
    p_role: "viewer",
    p_active: true,
  });
  await denied(a, "save_entry", {
    p_id: log.id,
    p_version: log.version,
    p_data: log,
  });
  await rpc(admin, "update_member", {
    p_user: a.id,
    p_role: "editor",
    p_active: true,
  });
  await rpc(admin, "update_member", {
    p_user: b.id,
    p_role: "editor",
    p_active: false,
  });
  assert.equal((await b.c.from("entries").select("*")).data.length, 0);
  assert.ok((await b.c.storage.from("farm-files").download(asset.path)).error);
  await rpc(admin, "update_member", {
    p_user: b.id,
    p_role: "editor",
    p_active: true,
  });
});
await test("초대 이메일·코드 일치·일회성·기본 작성권한", async () => {
  const token = await rpc(admin, "create_invitation", {
    p_email: invited.email,
    p_role: "editor",
  });
  await denied(outside, "accept_invitation", {
    p_token: token,
    p_name: "[시험] 다른 계정",
  });
  await rpc(invited, "accept_invitation", {
    p_token: token,
    p_name: "[시험] 초대 참여자",
  });
  await denied(invited, "accept_invitation", {
    p_token: token,
    p_name: "재사용",
  });
  assert.equal(
    (
      await invited.c
        .from("members")
        .select("*")
        .eq("user_id", invited.id)
        .single()
    ).data.role,
    "editor",
  );
  assert.ok((await a.c.from("invitations").select("*")).error);
});
await test("재로그인 후 기록·사진 유지", async () => {
  await a.c.auth.signOut();
  assert.ifError(
    (
      await a.c.auth.signInWithPassword({
        email: a.email,
        password: a.password,
      })
    ).error,
  );
  assert.equal(
    (await a.c.from("entries").select("*").eq("id", log.id).single()).data
      .title,
    log.title,
  );
  assert.ifError(
    (await a.c.storage.from("farm-files").download(asset.path)).error,
  );
});
await test("관리자 설정 변경·충돌 및 감사 기록 접근 통제", async () => {
  const setting = (await admin.c.from("farm_settings").select("*").single())
    .data;
  await rpc(admin, "save_settings", {
    p_version: setting.version,
    p_name: "[시험 전용] 함께농장",
    p_zones: ["시험 밭"],
    p_crops: ["시험 작물"],
  });
  await denied(admin, "save_settings", {
    p_version: setting.version,
    p_name: "덮어쓰기",
    p_zones: [],
    p_crops: [],
  });
  await denied(a, "save_settings", {
    p_version: setting.version + 1,
    p_name: "권한 위반",
    p_zones: [],
    p_crops: [],
  });
  assert.ok(
    (await admin.c.from("audit_log").select("*").eq("entity_id", log.id)).data
      .length >= 4,
  );
  assert.equal((await a.c.from("audit_log").select("*")).data.length, 0);
});
await test("연결된 일지가 있는 계획 영구 삭제 차단", async () => {
  await rpc(b, "trash_entry", { p_id: plan.id, p_version: plan.version });
  await denied(admin, "purge_entry", { p_id: plan.id });
  const p = (
    await admin.c.from("entries").select("*").eq("id", plan.id).single()
  ).data;
  await rpc(admin, "trash_entry", {
    p_id: plan.id,
    p_version: p.version,
    p_restore: true,
  });
});
await test("첨부파일과 휴지통 기록 영구 삭제", async () => {
  const e = await rpc(a, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: base(),
  });
  const f = await rpc(a, "reserve_asset", {
    p_id: randomUUID(),
    p_entry: e.id,
    p_name: "삭제시험.png",
    p_mime: "image/png",
    p_size: png.length,
  });
  assert.ifError(
    (
      await a.c.storage
        .from("farm-files")
        .upload(f.path, png, { contentType: "image/png" })
    ).error,
  );
  await rpc(a, "finish_asset", { p_id: f.id });
  await rpc(a, "trash_entry", { p_id: e.id, p_version: e.version });
  await denied(admin, "purge_entry", { p_id: e.id });
  assert.ifError(
    (await admin.c.storage.from("farm-files").remove([f.path])).error,
  );
  await rpc(admin, "purge_entry", { p_id: e.id });
  assert.equal(
    (await admin.c.from("entries").select("*").eq("id", e.id)).data.length,
    0,
  );
});
await test("실제 파일 크기를 작게 속여 용량 한도를 우회할 수 없음", async () => {
  const f = await rpc(a, "reserve_asset", {
    p_id: randomUUID(),
    p_entry: log.id,
    p_name: "크기검사.png",
    p_mime: "image/png",
    p_size: 1,
  });
  assert.ok(
    (
      await a.c.storage
        .from("farm-files")
        .upload(f.path, png, { contentType: "image/png" })
    ).error,
  );
  await rpc(a, "cancel_asset", { p_id: f.id });
});
writeFileSync(
  ".env.test-fixtures.json",
  JSON.stringify(
    {
      users: Object.fromEntries(
        Object.entries(users).map(([k, v]) => [
          k,
          { id: v.id, email: v.email, password: v.password },
        ]),
      ),
      log,
      plan,
      asset,
      resource,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);

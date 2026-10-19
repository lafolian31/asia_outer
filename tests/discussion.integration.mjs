import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

if (process.env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Discussion tests only run against the isolated local stack.");
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const users = {};
for (const who of ["admin", "a", "b", "viewer", "outside"]) {
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
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
  assert.ok((await db.rpc(name, args)).error, name + " must be denied");
}
async function rows(db, table, id) {
  const r = await db.from(table).select("*").eq("entry_id", id);
  assert.ifError(r.error);
  return r.data;
}
const make = (kind) =>
  rpc(b, "save_entry", {
    p_id: randomUUID(),
    p_version: 0,
    p_data: {
      kind,
      title: "[검수용] 댓글·감정표현 " + randomUUID(),
      body: "격리 시험 데이터",
      work_date: "2026-10-19",
      target_year: 2026,
      start_date: "2026-10-19",
      end_date: "2026-10-19",
    },
  });
const log = await make("log"),
  resource = await make("resource"),
  plan = await make("plan");
let comment;

await test("타인 일지·자료실 댓글 작성, 작성자 강제 지정 및 재전송 중복 방지", async () => {
  const args = {
    p_id: randomUUID(),
    p_entry: log.id,
    p_version: 0,
    p_body: "  첫 댓글 <script>literal</script>  ",
  };
  comment = await rpc(a, "save_comment", args);
  assert.equal(comment.author_id, fixtures.users.a.id);
  assert.equal(comment.body, args.p_body.trim());
  assert.equal((await rpc(a, "save_comment", args)).id, comment.id);
  assert.equal((await rows(b, "entry_comments", log.id)).length, 1);
  assert.equal(
    (await rows(viewer, "entry_comments", log.id))[0].body,
    comment.body,
  );
  await rpc(b, "save_comment", {
    p_id: randomUUID(),
    p_entry: resource.id,
    p_version: 0,
    p_body: "자료실 댓글",
  });
  assert.ok(
    (
      await a.from("entry_comments").insert({
        id: randomUUID(),
        entry_id: log.id,
        author_id: fixtures.users.b.id,
        updated_by: fixtures.users.b.id,
        body: "위조",
      })
    ).error,
  );
});
await test("감정표현 공유·변경·취소·재전송 및 동시 선택 시 1인 1개", async () => {
  await rpc(a, "set_reaction", { p_entry: log.id, p_kind: "like" });
  await rpc(a, "set_reaction", { p_entry: log.id, p_kind: "like" });
  await rpc(b, "set_reaction", { p_entry: log.id, p_kind: "love" });
  assert.equal((await rows(viewer, "entry_reactions", log.id)).length, 2);
  await Promise.all([
    rpc(a, "set_reaction", { p_entry: log.id, p_kind: "laugh" }),
    rpc(a, "set_reaction", { p_entry: log.id, p_kind: "wow" }),
  ]);
  assert.equal(
    (await rows(a, "entry_reactions", log.id)).filter(
      (r) => r.user_id === fixtures.users.a.id,
    ).length,
    1,
  );
  await rpc(a, "set_reaction", { p_entry: log.id, p_kind: null });
  assert.equal((await rows(a, "entry_reactions", log.id)).length, 1);
  await rpc(a, "set_reaction", { p_entry: resource.id, p_kind: "wow" });
  assert.ok(
    (
      await a.from("entry_reactions").insert({
        entry_id: log.id,
        user_id: fixtures.users.b.id,
        kind: "like",
      })
    ).error,
  );
});
await test("열람자·비참여자·익명 작성 차단, 비참여자 조회 차단", async () => {
  for (const db of [viewer, outside]) {
    await denied(db, "save_comment", {
      p_id: randomUUID(),
      p_entry: log.id,
      p_version: 0,
      p_body: "금지",
    });
    await denied(db, "set_reaction", { p_entry: log.id, p_kind: "like" });
    await denied(db, "delete_comment", {
      p_id: comment.id,
      p_version: comment.version,
    });
  }
  assert.equal((await rows(outside, "entry_comments", log.id)).length, 0);
  assert.equal((await rows(outside, "entry_reactions", log.id)).length, 0);
  const anon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  assert.ok((await anon.from("entry_comments").select("*")).error);
  await denied(anon, "set_reaction", { p_entry: log.id, p_kind: "love" });
});
await test("일지 주인도 타인 댓글 수정·삭제 불가, 본인 수정 충돌 감지·관리자 수정", async () => {
  const args = {
    p_id: comment.id,
    p_entry: log.id,
    p_version: comment.version,
    p_body: "수정 댓글",
  };
  await denied(b, "save_comment", args);
  await denied(b, "delete_comment", {
    p_id: comment.id,
    p_version: comment.version,
  });
  const concurrent = await Promise.all([
    a.rpc("save_comment", args),
    a.rpc("save_comment", { ...args, p_body: "동시 수정" }),
  ]);
  assert.equal(concurrent.filter((r) => !r.error).length, 1);
  assert.equal(concurrent.find((r) => r.error).error.code, "PT409");
  comment = concurrent.find((r) => !r.error).data;
  comment = await rpc(admin, "save_comment", {
    ...args,
    p_version: comment.version,
    p_body: "관리자 확인",
  });
  assert.equal(comment.author_id, fixtures.users.a.id);
  assert.equal(comment.updated_by, fixtures.users.admin.id);
  await denied(a, "save_comment", {
    ...args,
    p_entry: resource.id,
    p_version: comment.version,
  });
  await denied(a, "save_comment", { ...args, p_version: null });
  await denied(a, "delete_comment", { p_id: comment.id, p_version: null });
});
await test("빈 댓글·길이 초과·알 수 없는 감정 및 계획에 댓글·감정표현 차단", async () => {
  for (const body of [" ", "x".repeat(5001), null])
    await denied(a, "save_comment", {
      p_id: randomUUID(),
      p_entry: log.id,
      p_version: 0,
      p_body: body,
    });
  await denied(a, "save_comment", {
    p_id: randomUUID(),
    p_entry: plan.id,
    p_version: 0,
    p_body: "금지",
  });
  await denied(a, "set_reaction", { p_entry: plan.id, p_kind: "like" });
  await denied(a, "set_reaction", { p_entry: log.id, p_kind: "other" });
});
await test("휴지통에서 숨김·쓰기 차단, 관리자 복원 시 댓글·감정표현 보존", async () => {
  await rpc(b, "trash_entry", { p_id: log.id, p_version: log.version });
  assert.equal((await rows(a, "entry_comments", log.id)).length, 0);
  assert.equal((await rows(a, "entry_reactions", log.id)).length, 0);
  assert.equal((await rows(admin, "entry_comments", log.id)).length, 1);
  await denied(admin, "set_reaction", { p_entry: log.id, p_kind: "like" });
  await denied(admin, "save_comment", {
    p_id: randomUUID(),
    p_entry: log.id,
    p_version: 0,
    p_body: "금지",
  });
  await denied(a, "delete_comment", {
    p_id: comment.id,
    p_version: comment.version,
  });
  await rpc(admin, "trash_entry", {
    p_id: log.id,
    p_version: log.version + 1,
    p_restore: true,
  });
  assert.equal((await rows(a, "entry_comments", log.id)).length, 1);
  assert.equal((await rows(a, "entry_reactions", log.id)).length, 1);
});
await test("접근 해제 후 기존 세션의 조회·댓글·감정표현 차단", async () => {
  await rpc(admin, "update_member", {
    p_user: fixtures.users.a.id,
    p_role: "editor",
    p_active: false,
  });
  try {
    assert.equal((await rows(a, "entry_comments", log.id)).length, 0);
    assert.equal((await rows(a, "entry_reactions", log.id)).length, 0);
    await denied(a, "set_reaction", { p_entry: log.id, p_kind: "like" });
    await denied(a, "save_comment", {
      p_id: randomUUID(),
      p_entry: log.id,
      p_version: 0,
      p_body: "금지",
    });
  } finally {
    await rpc(admin, "update_member", {
      p_user: fixtures.users.a.id,
      p_role: "editor",
      p_active: true,
    });
  }
});
await test("본인 댓글 삭제·관리자 삭제, 자료 영구 삭제 시 연결 댓글·감정 정리", async () => {
  await rpc(a, "delete_comment", {
    p_id: comment.id,
    p_version: comment.version,
  });
  assert.equal((await rows(b, "entry_comments", log.id)).length, 0);
  const extra = await rpc(a, "save_comment", {
    p_id: randomUUID(),
    p_entry: log.id,
    p_version: 0,
    p_body: "백업 보존 댓글",
  });
  const removed = await rpc(a, "save_comment", {
    p_id: randomUUID(),
    p_entry: log.id,
    p_version: 0,
    p_body: "관리자 삭제 댓글",
  });
  await rpc(admin, "delete_comment", {
    p_id: removed.id,
    p_version: removed.version,
  });
  assert.equal((await rows(b, "entry_comments", log.id))[0].id, extra.id);
  await rpc(b, "trash_entry", {
    p_id: resource.id,
    p_version: resource.version,
  });
  await rpc(admin, "purge_entry", { p_id: resource.id });
  assert.equal((await rows(admin, "entry_comments", resource.id)).length, 0);
  assert.equal((await rows(admin, "entry_reactions", resource.id)).length, 0);
});
for (const db of Object.values(users)) await db.auth.signOut();

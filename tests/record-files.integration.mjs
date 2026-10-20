import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (process.env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Local tests only");
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const users = {};
for (const who of ["a", "b", "admin", "viewer", "outside"]) {
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  assert.ifError((await db.auth.signInWithPassword(fixtures.users[who])).error);
  users[who] = db;
}
for (const record of [
  { kind: "log", record_type: "farm" },
  { kind: "log", record_type: "activity", activity_category: "교육·견학" },
  { kind: "resource" },
]) {
  await test(`${record.record_type || record.kind}: document types and permissions`, async () => {
    const saved = await users.a.rpc("save_entry", {
      p_id: randomUUID(),
      p_version: 0,
      p_data: {
        ...record,
        title: "[검수용] 문서 권한",
        body: "",
        work_date: "2026-10-20",
      },
    });
    assert.ifError(saved.error);
    const args = {
      p_entry: saved.data.id,
      p_name: "문서.pdf",
      p_mime: "application/pdf",
      p_size: 20,
    };
    for (const who of ["b", "viewer", "outside"])
      assert.ok(
        (await users[who].rpc("reserve_asset", { ...args, p_id: randomUUID() }))
          .error,
      );
    for (const [name, mime] of [
      ["문서.pdf", "application/pdf"],
      ["발표.ppt", "application/vnd.ms-powerpoint"],
      [
        "발표.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ],
      [
        "표.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      ["표.xls", "application/vnd.ms-excel"],
      [
        "문서.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      ["문서.doc", "application/msword"],
      ["문서.hwp", "application/haansofthwp"],
      ["문서.hwpx", "application/octet-stream"],
      ["메모.txt", "text/plain"],
      ["표.csv", "text/csv"],
    ]) {
      const id = randomUUID();
      const r = await users.a.rpc("reserve_asset", {
        ...args,
        p_id: id,
        p_name: name,
        p_mime: mime,
      });
      assert.ifError(r.error);
      if (name.endsWith("ppt") || name.endsWith("pptx")) {
        const content = Buffer.alloc(20, 42);
        assert.ifError(
          (
            await users.a.storage
              .from("farm-files")
              .upload(r.data.path, content, { contentType: mime })
          ).error,
        );
        assert.ifError((await users.a.rpc("finish_asset", { p_id: id })).error);
        const shared = await users.b.storage
          .from("farm-files")
          .download(r.data.path);
        assert.ifError(shared.error);
        assert.deepEqual(Buffer.from(await shared.data.arrayBuffer()), content);
        continue; // Keep verified files in this isolated fixture record.
      }
      assert.ifError(
        (await users.admin.rpc("cancel_asset", { p_id: id })).error,
      );
    }
    for (const patch of [
      { p_size: 10485761 },
      { p_size: 0 },
      { p_name: "실행.exe" },
      { p_mime: "text/html" },
    ])
      assert.ok(
        (
          await users.a.rpc("reserve_asset", {
            ...args,
            ...patch,
            p_id: randomUUID(),
          })
        ).error,
      );
    const id = randomUUID();
    assert.ifError(
      (await users.admin.rpc("reserve_asset", { ...args, p_id: id })).error,
    );
    assert.ifError((await users.admin.rpc("cancel_asset", { p_id: id })).error);
  });
}

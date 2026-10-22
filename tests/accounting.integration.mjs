import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
if (process.env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Isolated local tests only");
const f = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const users = {};
for (const who of ["admin", "a", "b", "viewer", "outside"]) {
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  assert.ifError((await db.auth.signInWithPassword(f.users[who])).error);
  users[who] = db;
}
const { admin, a, b, viewer, outside } = users;
const rpc = async (db, name, args = {}) => {
  const r = await db.rpc(name, args);
  assert.ifError(r.error);
  return r.data;
};
const deny = async (db, name, args = {}) =>
  assert.ok((await db.rpc(name, args)).error, `${name} must be denied`);
const hash = (text) => createHash("sha256").update(text).digest("hex");
const meta = {
  file_type: "xlsx",
  file_size: 100,
  mapping: { date: 0, amount: 1 },
};
const batches = [];
const run = randomUUID();
const row = (n, overrides = {}) => ({
  source_sheet: 0,
  source_row: n,
  occurred_at: `2090-10-01T09:00:${String(n).padStart(2, "0")}`,
  time_precision: "second",
  direction: "income",
  amount: 100,
  description: "가상 거래",
  balance: null,
  bank_reference: "",
  ...overrides,
});
const upload = async (db, seed, rows, decisions = {}, id = randomUUID()) => {
  const result = await rpc(db, "accounting_import", {
    p_id: id,
    p_file_hash: hash(seed),
    p_rows: rows,
    p_decisions: decisions,
    p_meta: meta,
  });
  if (!batches.includes(id)) batches.push(id);
  return result;
};
let original, overlap;
const originalRows = [
  row(2, { amount: 50000, balance: 50000, description: "가상 회비" }),
  row(3, {
    direction: "expense",
    amount: 1000,
    balance: 49000,
    description: "가상 종자 모종",
  }),
  row(4, {
    occurred_at: "2090-10-01T09:00:04",
    direction: "expense",
    amount: 1000,
    balance: 48000,
    description: "가상 행사 물품",
  }),
  row(5, {
    occurred_at: "2090-10-02T10:00:00",
    amount: 5000,
    balance: null,
    description: "가상 판매",
  }),
];
try {
  await test("미로그인·비회원 조회 불가, 일반회원 읽기 전용, 직접 테이블 쓰기/조회 차단", async () => {
    const anon = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY,
    );
    await deny(anon, "accounting_overview");
    await deny(outside, "accounting_overview");
    for (const who of [a, b, viewer]) {
      assert.ok(await rpc(who, "accounting_overview"));
      await deny(who, "accounting_preview", {
        p_file_hash: hash(run),
        p_rows: [row(1)],
      });
      await deny(who, "accounting_set_treasurer", {
        p_user: f.users.b.id,
        p_enabled: true,
      });
    }
    for (const who of [admin, a, viewer, outside])
      for (const table of [
        "accounting_settings",
        "accounting_roles",
        "accounting_transactions",
        "accounting_imports",
        "accounting_audit",
      ])
        assert.ok((await who.from(table).select("*")).error);
  });
  await test("관리자 계좌 설정·총무 지정, 일반회원 계좌 변경 차단", async () => {
    const overview = await rpc(admin, "accounting_overview");
    await rpc(admin, "accounting_configure", {
      p_version: overview.settings.version,
      p_name: "[가상] 회계 시험",
      p_number: "000000000000",
    });
    await deny(b, "accounting_configure", {
      p_version: overview.settings.version + 1,
      p_name: "변조",
      p_number: "000000000001",
    });
    await deny(admin, "accounting_configure", {
      p_version: overview.settings.version,
      p_name: "충돌",
      p_number: "000000000000",
    });
    await rpc(admin, "accounting_set_treasurer", {
      p_user: f.users.a.id,
      p_enabled: true,
    });
    assert.equal((await rpc(a, "accounting_overview")).can_manage, true);
  });
  await test("총무 업로드, 동일 날짜·금액의 다른 정상 거래 모두 유지", async () => {
    original = await upload(a, run, originalRows);
    assert.equal(original.new_count, 4);
    const v = await rpc(viewer, "accounting_overview", {
      p_from: "2090-10-01",
      p_to: "2090-10-31",
    });
    assert.equal(v.income, "55000");
    assert.equal(v.expense, "2000");
    assert.equal(v.total, 4);
    assert.equal(v.bank_balance, "48000");
    assert.match(v.bank_balance_at, /2090-10-01/);
    assert.match(v.last_transaction_at, /2090-10-02/);
    assert.ok(v.items.some((r) => r.category === "회원 회비"));
    assert.ok(v.items.some((r) => r.category === "종자·모종 구입"));
  });
  await test("같은 파일 재업로드·재시도 시 원장·합계 불변", async () => {
    const same = await upload(a, run, originalRows);
    assert.equal(same.new_count, 0);
    assert.equal(same.duplicate_count, 4);
    const again = await upload(a, run, originalRows, {}, same.id);
    assert.equal(again.id, same.id);
    const v = await rpc(b, "accounting_overview", {
      p_from: "2090-10-01",
      p_to: "2090-10-31",
    });
    assert.equal(v.income, "55000");
    assert.equal(v.total, 4);
  });
  await test("겹친 파일은 검토 필요, 미확정 저장 롤백, 승인한 중복만 제외", async () => {
    const rows = [
      originalRows[1],
      row(8, {
        occurred_at: "2090-10-03T10:00:00",
        amount: 200,
        balance: 60000,
      }),
    ];
    const preview = await rpc(a, "accounting_preview", {
      p_file_hash: hash(run + "overlap"),
      p_rows: rows,
    });
    assert.equal(preview[0].status, "review");
    assert.equal(preview[1].status, "new");
    await deny(a, "accounting_import", {
      p_id: randomUUID(),
      p_file_hash: hash(run + "overlap"),
      p_rows: rows,
      p_decisions: {},
      p_meta: meta,
    });
    overlap = await upload(a, run + "overlap", rows, {
      "0:3": preview[0].candidates[0].id,
    });
    assert.equal(overlap.new_count, 1);
    assert.equal(overlap.duplicate_count, 1);
    const v = await rpc(a, "accounting_overview", {
      p_from: "2090-10-03",
      p_to: "2090-10-03",
    });
    assert.equal(v.income, "200");
    assert.equal(v.bank_balance, "60000");
    assert.ok(v.gap_count > 0);
  });
  await test("완전히 같은 일자·금액·내용도 담당자가 별도 거래로 판단하면 모두 등록", async () => {
    const one = row(11, {
      occurred_at: "2090-11-01T00:00:00",
      time_precision: "date",
      description: "동일 가상 거래",
    });
    const two = { ...one, source_row: 12 };
    const preview = await rpc(a, "accounting_preview", {
      p_file_hash: hash(run + "twins"),
      p_rows: [one, two],
    });
    assert.equal(preview[1].status, "review");
    const saved = await upload(a, run + "twins", [one, two], { "0:12": "new" });
    assert.equal(saved.new_count, 2);
    assert.equal(
      (
        await rpc(viewer, "accounting_overview", {
          p_from: "2090-11-01",
          p_to: "2090-11-01",
        })
      ).total,
      2,
    );
  });
  await test("빈 값·소수·잘못된 날짜/입출금 검증과 오류 행 구분", async () => {
    const bad = [
      row(20, { amount: "1.5" }),
      row(21, { occurred_at: "2090-02-30T09:00:00" }),
      row(22, { direction: "unknown" }),
      row(23, { amount: 0 }),
    ];
    const preview = await rpc(a, "accounting_preview", {
      p_file_hash: hash(run + "bad"),
      p_rows: bad,
    });
    assert.ok(preview.every((p) => p.status === "error"));
    const saved = await upload(a, run + "bad", bad);
    assert.equal(saved.new_count, 0);
    assert.equal(saved.error_count, 4);
    await deny(a, "accounting_import", {
      p_id: randomUUID(),
      p_file_hash: hash("file"),
      p_rows: [row(30)],
      p_decisions: {},
      p_meta: { ...meta, file_size: 10485761 },
    });
  });
  await test("원본 금액·일시 변경 API 없음, 분류·비고만 수정하고 충돌·이력 기록", async () => {
    const v = await rpc(a, "accounting_overview", { p_query: "가상 종자" });
    const item = v.items.find((r) => r.import_id === original.id);
    assert.ok(item);
    await deny(b, "accounting_edit", {
      p_id: item.id,
      p_version: item.version,
      p_category: item.category_id,
      p_note: "금지",
    });
    assert.ok(
      (
        await admin
          .from("accounting_transactions")
          .update({ amount: 1 })
          .eq("id", item.id)
      ).error,
    );
    await rpc(a, "accounting_edit", {
      p_id: item.id,
      p_version: item.version,
      p_category: item.category_id,
      p_note: "공동 실습비",
    });
    await deny(a, "accounting_edit", {
      p_id: item.id,
      p_version: item.version,
      p_category: item.category_id,
      p_note: "오래된 수정",
    });
    const changed = (
      await rpc(admin, "accounting_overview", { p_query: "공동 실습비" })
    ).items[0];
    assert.equal(changed.amount, item.amount);
    assert.equal(changed.description, item.description);
    const history = await rpc(admin, "accounting_history");
    assert.ok(history.audit.some((e) => e.action === "annotation"));
  });
  await test("일반 회원 민감정보 마스킹, 총무 원본 접근, 공개 파일 저장 없음", async () => {
    const saved = await upload(a, run + "mask", [
      row(40, {
        description: "홍길동 010-0000-0000 123456-1234567",
        occurred_at: "2090-12-01T09:00:00",
      }),
    ]);
    const publicView = await rpc(b, "accounting_overview", {
      p_query: "[번호 마스킹]",
    });
    const item = publicView.items.find((t) => t.import_id === saved.id);
    assert.ok(item);
    assert.doesNotMatch(item.description, /010-0000|1234567|홍길동/);
    const managerView = await rpc(a, "accounting_overview", {
      p_query: "홍길동",
    });
    assert.ok(managerView.items.some((t) => t.import_id === saved.id));
  });
  await test("은행 원본 문자열 보존·관리용 키로도 금액 변경 차단", async () => {
    const description = "  가상 ＡＢＣ 거래  ";
    const saved = await upload(a, run + "raw", [
      row(70, { occurred_at: "2092-01-01T10:00:00", description }),
    ]);
    const item = (
      await rpc(admin, "accounting_overview", { p_query: "ＡＢＣ" })
    ).items.find((t) => t.import_id === saved.id);
    assert.equal(item.description, description);
    const service = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
    const result = await service
      .from("accounting_transactions")
      .update({ amount: 999 })
      .eq("id", item.id);
    assert.ok(result.error);
    assert.match(result.error.message, /원본/);
  });
  await test("신규 고유번호도 겹친 원본은 검토, 파일 내 고유번호 반복은 오류로 분리", async () => {
    const candidate = {
      ...originalRows[0],
      source_row: 80,
      bank_reference: "new-ref-" + run,
    };
    const preview = await rpc(a, "accounting_preview", {
      p_file_hash: hash(run + "newref"),
      p_rows: [candidate],
    });
    assert.equal(preview[0].status, "review");
    const one = row(81, {
      occurred_at: "2092-02-01T09:00:00",
      bank_reference: "repeat-ref-" + run,
    });
    const two = { ...one, source_row: 82, amount: 101 };
    const repeated = await rpc(a, "accounting_preview", {
      p_file_hash: hash(run + "repeatref"),
      p_rows: [one, two],
    });
    assert.equal(repeated[0].status, "new");
    assert.equal(repeated[1].status, "error");
    const saved = await upload(a, run + "repeatref", [one, two]);
    assert.equal(saved.new_count, 1);
    assert.equal(saved.error_count, 1);
  });
  await test("총무 지정 해제와 기존 로그인 세션 권한 회수", async () => {
    await rpc(admin, "accounting_set_treasurer", {
      p_user: f.users.a.id,
      p_enabled: false,
    });
    await deny(a, "accounting_preview", {
      p_file_hash: hash(run),
      p_rows: [row(1)],
    });
    assert.equal((await rpc(a, "accounting_overview")).can_manage, false);
    await rpc(admin, "accounting_set_treasurer", {
      p_user: f.users.a.id,
      p_enabled: true,
    });
  });
  await test("취소는 관리자만, 참조 중인 업로드 안전 차단 및 취소 이력 보존", async () => {
    await deny(a, "accounting_cancel", {
      p_id: original.id,
      p_reason: "가상 업로드 취소",
    });
    await deny(admin, "accounting_cancel", {
      p_id: original.id,
      p_reason: "가상 업로드 취소",
    });
    await deny(b, "accounting_backup");
    assert.ok((await rpc(admin, "accounting_backup")).transactions.length >= 4);
    const report = await rpc(viewer, "accounting_report", {
      p_from: "2090-10-01",
      p_to: "2090-10-31",
    });
    assert.equal(report.income, "55200");
    assert.equal(report.expense, "2000");
  });
  await test("동시 동일 파일 업로드도 한 번만 저장, 은행 고유번호 충돌 검증", async () => {
    const seed = run + "concurrent",
      rows = [
        row(61, {
          occurred_at: "2091-01-01T01:00:00",
          bank_reference: "virtual-ref-" + run,
        }),
      ];
    const results = await Promise.all([
      upload(a, seed, rows),
      upload(a, seed, rows),
    ]);
    assert.equal(
      results.reduce((n, r) => n + r.new_count, 0),
      1,
    );
    assert.equal(
      results.reduce((n, r) => n + r.duplicate_count, 0),
      1,
    );
    const preview = await rpc(a, "accounting_preview", {
      p_file_hash: hash(run + "changed"),
      p_rows: [{ ...rows[0], amount: 999 }],
    });
    assert.equal(preview[0].status, "error");
  });
  await test("시각 없는 같은 날짜 잔액은 임의로 선택하지 않음", async () => {
    const rows = [
      row(70, {
        occurred_at: "2092-01-01T00:00:00",
        time_precision: "date",
        balance: 100,
      }),
      row(71, {
        occurred_at: "2092-01-01T00:00:00",
        time_precision: "date",
        balance: 200,
      }),
    ];
    await upload(a, run + "ambiguous", rows);
    const view = await rpc(viewer, "accounting_overview");
    assert.equal(view.bank_balance, null);
    assert.equal(view.balance_ambiguous, true);
  });
  await test("접근 해제된 회원은 기존 세션으로 회계 조회·보고서 요청 불가", async () => {
    const member = (
      await admin
        .from("members")
        .select("role")
        .eq("user_id", f.users.b.id)
        .single()
    ).data;
    await rpc(admin, "update_member", {
      p_user: f.users.b.id,
      p_role: member.role,
      p_active: false,
    });
    try {
      await deny(b, "accounting_overview");
      await deny(b, "accounting_report");
    } finally {
      await rpc(admin, "update_member", {
        p_user: f.users.b.id,
        p_role: member.role,
        p_active: true,
      });
    }
  });
  await test("회계 SQL 재실행이 기존 농장 기록·사진·회원·회계 원장을 변경하지 않음", async () => {
    const snapshot = () =>
      execFileSync(
        "docker",
        [
          "exec",
          "farm-test-db",
          "psql",
          "-U",
          "postgres",
          "-Atc",
          "select jsonb_build_object('entries',(select jsonb_agg(to_jsonb(e) order by id) from entries e),'assets',(select jsonb_agg(to_jsonb(a) order by id) from assets a),'members',(select jsonb_agg(to_jsonb(m) order by user_id) from members m),'settings',(select jsonb_agg(to_jsonb(s)) from farm_settings s),'finance',(select jsonb_agg(to_jsonb(t) order by id) from accounting_transactions t))",
        ],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );
    const before = snapshot();
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
        input: readFileSync("supabase/migrations/202610220001_accounting.sql"),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    assert.equal(snapshot(), before);
  });
} finally {
  for (const id of batches.reverse())
    await rpc(admin, "accounting_cancel", {
      p_id: id,
      p_reason: "가상 회계 시험 정리",
    });
  await rpc(admin, "accounting_set_treasurer", {
    p_user: f.users.a.id,
    p_enabled: false,
  });
  for (const db of Object.values(users)) await db.auth.signOut();
}

import test from "node:test";
import assert from "node:assert/strict";
import { csv, canEdit, planStats, safeUrl, today } from "../src/lib/utils.js";
test("본인·관리자·열람자 권한 구분", () => {
  const e = { author_id: "A" };
  assert.ok(canEdit({ user_id: "A", role: "editor", active: true }, e));
  assert.ok(canEdit({ user_id: "B", role: "admin", active: true }, e));
  for (const m of [
    { user_id: "B", role: "editor", active: true },
    { user_id: "A", role: "viewer", active: true },
    { user_id: "A", role: "admin", active: false },
  ])
    assert.equal(canEdit(m, e), false);
});
test("취소·보류를 완료 실적으로 집계하지 않음", () => {
  assert.deepEqual(
    planStats([
      { status: "완료" },
      { status: "취소" },
      { status: "보류" },
      { status: "진행중" },
      { status: "미실행" },
    ]),
    { total: 5, complete: 1, pending: 2, held: 1, cancelled: 1 },
  );
});
test("CSV 한글·인용부호·줄바꿈·수식 주입 처리", () => {
  const value = csv([
    ["제목", "본문"],
    ["=SUM(1,2)", '한글 "따옴표"\n다음 줄'],
  ]);
  assert.ok(value.startsWith("\uFEFF"));
  assert.ok(value.includes('"\'=SUM(1,2)"'));
  assert.ok(value.includes('"한글 ""따옴표""\n다음 줄"'));
});
test("위험한 링크 차단", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  assert.equal(safeUrl("https://example.com"), "https://example.com/");
});
test("날짜는 서울 기준 ISO 일자", () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

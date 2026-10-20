import test from "node:test";
import assert from "node:assert/strict";
import {
  csv,
  canEdit,
  planStats,
  safeUrl,
  today,
  matchesSearch,
  searchDateForms,
} from "../src/lib/utils.js";
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

test("통합 찾기는 여러 필드·공백·대소문자·한글 정규화와 날짜 표기를 지원", () => {
  const fields = [
    "들깨 · 제초",
    "농장 관리자",
    "안녕동",
    "잡초·병해충",
    "2027 봄 계획",
    "작업사진.JPG",
    ...searchDateForms("2026-10-20"),
  ];
  for (const query of [
    "",
    "   ",
    "들깨 관리자",
    "농장관리자",
    "안녕동 제초",
    "작업사진.jpg",
    "2026/10/20 계획",
    "2026.10.20",
    "20261020",
    "2026년 10월20일",
    "제초  안녕동   들깨",
  ])
    assert.ok(matchesSearch(query, fields), query);
  for (const query of ["들깨 없는작성자", "2026-10-19", "수확"])
    assert.equal(matchesSearch(query, fields), false, query);
  assert.ok(matchesSearch("한글", ["한글"]));
  assert.deepEqual(searchDateForms(null), []);
});

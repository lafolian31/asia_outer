import test from "node:test";
import assert from "node:assert/strict";
import {
  bankDate,
  won,
  guessMapping,
  mappedRows,
  suggestCategory,
} from "../src/lib/accounting/import.js";
import * as XLSX from "@e965/xlsx";
test("정수 원화·부호·천 단위와 소수·지수·빈 금액 검증", () => {
  assert.equal(won("₩ 1,234원"), 1234);
  assert.equal(won("-5,000", true), -5000);
  assert.equal(won(""), null);
  for (const input of ["1.2", "1e5", "=1+2", "돈100", {}, "9007199254740992"])
    assert.throws(() => won(input));
  assert.throws(() => won("-1"));
});
test("엑셀 1900/1904와 문자열 날짜·별도 시간, 잘못된 날짜 차단", () => {
  assert.equal(bankDate(44927, null).occurred_at, "2023-01-01T00:00:00");
  assert.equal(bankDate(44927, null, true).occurred_at, "2027-01-02T00:00:00");
  assert.equal(
    bankDate("2026.10.22 09:10:11", null).occurred_at,
    "2026-10-22T09:10:11",
  );
  assert.equal(bankDate("20261022", "09:10").time_precision, "minute");
  assert.equal(bankDate("2026-10-22", 0.5).occurred_at, "2026-10-22T12:00:00");
  assert.throws(() => bankDate("2026-02-30", null));
  assert.throws(() => bankDate("2026-10-22", "24:00"));
  assert.throws(() => bankDate("2026-10-22T00:00:00Z", null));
});
test("열 연결·입출금 분리·원본 행 번호와 수식 오류 미리보기", () => {
  const headers = [
    "거래일시",
    "거래구분",
    "거래금액",
    "거래내용",
    "거래 후 잔액",
  ];
  const mapping = guessMapping(headers);
  assert.equal(mapping.date, 0);
  assert.equal(mapping.balance, 4);
  const rows = [
    headers,
    ["2026-10-22 09:10:00", "입금", "50,000", "회비", 50000],
    ["2026-10-22 09:11:00", "출금", 1000, "모종", 49000],
    ["2026-10-22", "입금", 100, '=HYPERLINK("bad")', null],
  ];
  const mapped = mappedRows(rows, 0, mapping);
  assert.equal(mapped[0].source_row, 2);
  assert.equal(mapped[0].amount, 50000);
  assert.equal(mapped[1].direction, "expense");
  assert.ok(mapped[2].client_error);
  const split = guessMapping(["거래일자", "입금액", "출금액", "적요"]);
  const output = mappedRows(
    [
      ["거래일자", "입금액", "출금액", "적요"],
      [44927, 100, "", "가상"],
      [44927, 50, 50, "불명확"],
    ],
    0,
    split,
  );
  assert.equal(output[0].amount, 100);
  assert.ok(output[1].client_error);
});
test("금융 파일 XLSX·XLS·CSV 가상 자료와 수식은 실행하지 않고 셀로 유지", () => {
  const source = [
    ["거래일시", "구분", "금액", "내용"],
    ["2026-10-22 09:10:00", "입금", 1000, "=1+1"],
  ];
  for (const type of ["xlsx", "biff8", "csv"]) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(source), "가상");
    const bytes = XLSX.write(book, { bookType: type, type: "buffer" });
    const parsed = XLSX.read(bytes, { type: "buffer", raw: true });
    const cell = parsed.Sheets[parsed.SheetNames[0]].D2;
    assert.equal(cell.f, undefined);
    assert.equal(cell.v, "=1+1");
  }
});
test("분류 추천은 원본을 고치지 않고 선택 가능한 분류만 반환", () => {
  const categories = [
    { id: "a", direction: "expense", name: "종자·모종 구입" },
    { id: "b", direction: "income", name: "회원 회비" },
  ];
  assert.equal(suggestCategory("모종 구입", "expense", categories), "a");
  assert.equal(suggestCategory("회원 회비", "income", categories), "b");
  assert.equal(suggestCategory("미지정", "income", categories), "");
});

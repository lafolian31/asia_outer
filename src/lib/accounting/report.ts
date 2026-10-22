import { rpc } from "../api";
import { money, localStamp, displayAt } from "./display";
export async function downloadReport(from: string, to: string) {
  const report = await rpc<any>("accounting_report", {
    p_from: from || null,
    p_to: to || null,
  });
  const XLSX = await import("@e965/xlsx");
  const book = XLSX.utils.book_new();
  function sheet(name: string, rows: any[][]) {
    const page = XLSX.utils.aoa_to_sheet(rows);
    // All text stays text, including values beginning with =,+,-,@. Never create formulas.
    for (const key of Object.keys(page))
      if (!key.startsWith("!")) {
        delete page[key].f;
        if (typeof page[key].v === "string") page[key].t = "s";
      }
    page["!cols"] = [
      { wch: 22 },
      { wch: 18 },
      { wch: 32 },
      { wch: 20 },
      { wch: 32 },
      { wch: 30 },
      { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(book, page, name);
  }
  sheet("요약", [
    ["함께그린 공동회계 보고서"],
    ["기간", `${from || "전체"} ~ ${to || "전체"}`],
    ["기간 수입", money(report.income)],
    ["기간 지출", money(report.expense)],
    ["마지막 거래 기준 잔액", money(report.bank_balance)],
    ["잔액 기준시각", localStamp(report.bank_balance_at)],
    ["최근 업로드", displayAt(report.last_upload_at)],
    [
      "안내",
      "등록된 거래만 집계하며 현재 은행 자동 조회값이 아닙니다. 마지막 은행 잔액은 조회 기간과 별도로 표시합니다.",
    ],
  ]);
  sheet("거래내역", [
    [
      "거래일시 (한국시각)",
      "구분",
      "은행 거래내용",
      "금액 (원)",
      "사용분류",
      "비고",
      "거래 후 잔액 (원)",
    ],
    ...report.items.map((t: any) => [
      localStamp(t.occurred_at) +
        (t.time_precision === "date" ? " (시각 없음)" : ""),
      t.direction === "income" ? "입금" : "출금",
      t.description,
      t.amount,
      t.category,
      t.note,
      t.balance,
    ]),
  ]);
  sheet("월별", [
    ["월", "수입 (원)", "지출 (원)"],
    ...report.monthly.map((m: any) => [m.month, m.income, m.expense]),
  ]);
  sheet("지출 분류", [
    ["분류", "합계 (원)"],
    ...report.categories.map((c: any) => [c.category, c.total]),
  ]);
  XLSX.writeFile(
    book,
    `함께그린-회계보고서-${from || "전체"}-${to || "전체"}.xlsx`,
    { bookType: "xlsx" },
  );
}

import { SSF } from "@e965/xlsx";
export const fieldLabels = {
  date: "거래일자 또는 일시",
  time: "거래시간 (별도 열일 때)",
  direction: "입금/출금 구분",
  amount: "통합 금액",
  income: "입금액",
  expense: "출금액",
  description: "거래내용",
  balance: "거래 후 잔액",
  reference: "거래 고유번호 (있을 때만)",
};
const aliases = {
  date: ["거래일시", "거래일자", "거래일", "일시", "일자", "날짜"],
  time: ["거래시간", "시간"],
  direction: ["거래구분", "입출금구분", "구분"],
  amount: ["거래금액", "금액"],
  income: ["입금액", "입금금액", "입금"],
  expense: ["출금액", "출금금액", "출금"],
  description: ["거래내용", "적요", "거래처", "내용", "거래기록사항"],
  balance: ["거래후잔액", "잔액"],
  reference: ["거래고유번호", "거래번호"],
};
export function guessMapping(headers) {
  const normalized = headers.map((x) =>
    String(x ?? "").replace(/[\s()（）]/g, ""),
  );
  return Object.fromEntries(
    Object.entries(aliases).map(([key, options]) => [
      key,
      normalized.findIndex((x) => options.includes(x)),
    ]),
  );
}
export function won(value, allowNegative = false) {
  if (value == null || String(value).trim() === "" || value === "-")
    return null;
  if (typeof value === "object")
    throw Error("수식·비정상 셀은 사용할 수 없습니다");
  const text = String(value)
    .trim()
    .replace(/[₩원,\s]/g, "");
  if (!/^[+-]?\d+$/.test(text))
    throw Error("금액은 소수점 없는 정수 원 단위여야 합니다");
  const n = Number(text);
  if (
    !Number.isSafeInteger(n) ||
    Math.abs(n) > 1e15 ||
    (!allowNegative && n < 0)
  )
    throw Error("금액의 부호 또는 범위를 확인해 주세요");
  return n;
}
const pad = (n) => String(n).padStart(2, "0");
export function bankDate(value, time, date1904 = false) {
  if (value == null || value === "" || typeof value === "object")
    throw Error("거래일자가 없거나 수식입니다");
  let year,
    month,
    day,
    hour = 0,
    minute = 0,
    second = 0,
    precision = "date";
  if (typeof value === "number") {
    const parts = SSF.parse_date_code(value, { date1904 });
    if (!parts) throw Error("엑셀 날짜를 읽을 수 없습니다");
    ({ y: year, m: month, d: day, H: hour, M: minute, S: second } = parts);
    if (value % 1) precision = "second";
  } else {
    const match = String(value)
      .trim()
      .match(
        /^(\d{4})[.\/-]?(\d{2})[.\/-]?(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
      );
    if (!match)
      throw Error(
        "날짜 형식은 YYYY-MM-DD 또는 YYYY-MM-DD HH:mm:ss를 사용해 주세요",
      );
    [, year, month, day] = match;
    year = +year;
    month = +month;
    day = +day;
    if (match[4] != null) {
      hour = +match[4];
      minute = +match[5];
      second = +(match[6] || 0);
      precision = match[6] != null ? "second" : "minute";
    }
  }
  if (time != null && time !== "") {
    if (typeof time === "number") {
      if (time < 0 || time >= 1)
        throw Error("별도 시간은 하루 이내여야 합니다");
      const s = Math.round(time * 86400);
      hour = Math.floor(s / 3600);
      minute = Math.floor((s % 3600) / 60);
      second = s % 60;
      precision = "second";
    } else {
      const m = String(time)
        .trim()
        .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (!m) throw Error("별도 거래시간을 확인해 주세요");
      hour = +m[1];
      minute = +m[2];
      second = +(m[3] || 0);
      precision = m[3] != null ? "second" : "minute";
    }
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    year > 2200 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  )
    throw Error("유효하지 않은 날짜 또는 시간입니다");
  return {
    occurred_at: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`,
    time_precision: precision,
  };
}
export function mappedRows(
  rows,
  headerRow,
  mapping,
  sheetIndex = 0,
  date1904 = false,
) {
  const cell = (row, key) => (mapping[key] >= 0 ? row[mapping[key]] : null);
  return rows.slice(headerRow + 1).flatMap((row, i) => {
    if (!row.some((v) => v != null && String(v).trim() !== "")) return [];
    const source = { source_sheet: sheetIndex, source_row: headerRow + i + 2 };
    try {
      const dt = bankDate(cell(row, "date"), cell(row, "time"), date1904);
      const description = cell(row, "description");
      if (
        (description != null && typeof description === "object") ||
        /^[=+@]/.test(String(description || ""))
      )
        throw Error("거래내용에 수식 또는 비정상 값이 있습니다");
      let direction, amount;
      if (mapping.income >= 0 || mapping.expense >= 0) {
        const income = won(cell(row, "income")) || 0,
          expense = won(cell(row, "expense")) || 0;
        if (income > 0 === expense > 0)
          throw Error("입금액·출금액 중 한쪽에만 양수 금액이 필요합니다");
        direction = income > 0 ? "income" : "expense";
        amount = income || expense;
      } else {
        const n = won(cell(row, "amount"), true);
        if (!n) throw Error("거래금액은 0이 될 수 없습니다");
        const type = String(cell(row, "direction") || "").replace(/\s/g, "");
        if (["입금", "수입", "income", "credit"].includes(type.toLowerCase()))
          direction = "income";
        else if (
          ["출금", "지출", "expense", "debit"].includes(type.toLowerCase())
        )
          direction = "expense";
        else if (n < 0) direction = "expense";
        else throw Error("양수 금액은 입금/출금 구분 열이 필요합니다");
        if (n < 0 && direction === "income")
          throw Error("입금 구분과 음수 금액이 일치하지 않습니다");
        amount = Math.abs(n);
      }
      if (amount > 1e12) throw Error("거래금액이 허용 범위를 초과했습니다");
      const reference = cell(row, "reference");
      if (reference != null && typeof reference === "object")
        throw Error("거래 고유번호가 수식입니다");
      return [
        {
          ...source,
          ...dt,
          direction,
          amount,
          description: String(description ?? ""),
          balance: won(cell(row, "balance"), true),
          bank_reference: String(reference ?? "").trim(),
        },
      ];
    } catch (error) {
      return [{ ...source, client_error: error.message, description: "" }];
    }
  });
}
export function suggestCategory(description, direction, categories) {
  const rules =
    direction === "income"
      ? [
          [/회비/, "회원 회비"],
          [/판매|수확물/, "농산물 판매"],
          [/후원|지원금|보조금/, "지원금 및 후원금"],
          [/교육|행사/, "공동체 행사 및 교육 수입"],
        ]
      : [
          [/종자|모종|씨앗/, "종자·모종 구입"],
          [/비료|퇴비|농약|토양/, "비료·토양개량제·농약 등 농자재"],
          [/시설|장비|수리/, "시설·장비 구입 및 유지관리"],
          [/교육|행사/, "교육·행사비"],
          [/임차|전기|수도|운영/, "농장 운영비"],
        ];
  const name = rules.find(([pattern]) => pattern.test(description))?.[1];
  return (
    categories.find((c) => c.direction === direction && c.name === name)?.id ||
    ""
  );
}

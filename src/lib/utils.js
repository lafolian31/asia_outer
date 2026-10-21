export const statuses = ["미실행", "진행중", "완료", "보류", "취소"];
export const roleLabels = {
  admin: "관리자",
  editor: "참여자",
  viewer: "열람자",
};
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function canEdit(me, entry) {
  return (
    !!me?.active &&
    (me.role === "admin" ||
      (me.role === "editor" && me.user_id === entry.author_id))
  );
}
export function csv(rows) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? "");
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function planStats(plans) {
  return {
    total: plans.length,
    complete: plans.filter((p) => p.status === "완료").length,
    pending: plans.filter((p) => ["미실행", "진행중"].includes(p.status))
      .length,
    held: plans.filter((p) => p.status === "보류").length,
    cancelled: plans.filter((p) => p.status === "취소").length,
  };
}
export function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function readableError(error) {
  const text = error?.message || String(error);
  if (/fetch|network|Failed to fetch/i.test(text))
    return "서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요. 입력 내용은 유지됩니다.";
  if (/Invalid login credentials/i.test(text))
    return "이메일 또는 비밀번호를 확인해 주세요.";
  if (/JWT|session.*missing/i.test(text))
    return "로그인 시간이 만료되었습니다. 다시 로그인해 주세요.";
  return text;
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Multiple words can match different fields of the same record.
export function matchesSearch(query, fields) {
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ko-KR")
      .replace(/\s+/g, "");
  const terms = String(query ?? "")
    .normalize("NFKC")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map(normalize);
  const values = fields.map(normalize);
  return terms.every((term) => values.some((value) => value.includes(term)));
}
export function searchDateForms(date) {
  if (!date) return [];
  const [year, month, day] = date.split("-");
  return [
    date,
    date.replaceAll("-", "."),
    date.replaceAll("-", "/"),
    date.replaceAll("-", ""),
    `${year}년${Number(month)}월${Number(day)}일`,
  ];
}

// Ongoing/today first, then upcoming starts; finished date ranges go last.
export function comparePlanDates(a, b, currentDate = today()) {
  const endA = a.end_date || a.start_date || "";
  const endB = b.end_date || b.start_date || "";
  const pastA = endA < currentDate;
  const pastB = endB < currentDate;
  if (pastA !== pastB) return pastA ? 1 : -1;
  if (pastA)
    return (
      endB.localeCompare(endA) ||
      (b.start_date || "").localeCompare(a.start_date || "") ||
      a.id.localeCompare(b.id)
    );
  const nextA =
    (a.start_date || currentDate) < currentDate
      ? currentDate
      : a.start_date || currentDate;
  const nextB =
    (b.start_date || currentDate) < currentDate
      ? currentDate
      : b.start_date || currentDate;
  return (
    nextA.localeCompare(nextB) ||
    endA.localeCompare(endB) ||
    a.id.localeCompare(b.id)
  );
}

// Status words select the plan's own status, not text in linked records.
// The dashboard uses an explicit target-year term so crossing-year results stay accurate.
export function matchesPlanSearch(query, entry, fields) {
  const terms = String(query ?? "")
    .normalize("NFKC")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const text = [];
  for (const term of terms) {
    const year = /^목표연도:(\d{4})년?$/.exec(term);
    if (year) {
      if (entry.target_year !== Number(year[1])) return false;
    } else if (
      ["미실행", "진행중", "완료", "보류", "취소", "미완료"].includes(term)
    ) {
      if (
        term === "미완료"
          ? !["미실행", "진행중"].includes(entry.status)
          : entry.status !== term
      )
        return false;
    } else text.push(term);
  }
  return matchesSearch(text.join(" "), fields);
}

export function planMonthSearchFields(start, end) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start || "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end || "")
  )
    return [];
  const first = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  const last = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7)) - 1;
  const fields = [];
  for (let index = first; index <= last && index - first < 2412; index++) {
    const year = Math.floor(index / 12),
      month = (index % 12) + 1,
      padded = String(month).padStart(2, "0");
    fields.push(
      `${year}년${month}월`,
      `${year}년${padded}월`,
      `${year}-${padded}`,
      `${year}.${padded}`,
      `${year}/${padded}`,
    );
  }
  return fields;
}

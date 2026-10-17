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

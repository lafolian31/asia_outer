export const bankUrl = "https://www.kakaobank.com/";
export const money = (value: string | number | null | undefined) =>
  value == null ? "확인 불가" : `${BigInt(value).toLocaleString("ko-KR")}원`;
export const localStamp = (value: string | null | undefined) =>
  value ? value.replace("T", " ").slice(0, 19) : "없음";
export const displayAt = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : "없음";
export const periodDates = (month: string) => {
  if (!month) return { from: "", to: "" };
  const [y, m] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`,
  };
};

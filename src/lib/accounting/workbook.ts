export type ParsedBook = {
  sheets: { index: number; rows: any[][] }[];
  date1904: boolean;
  hash: string;
  size: number;
  extension: string;
};
export async function readBankWorkbook(file: File): Promise<ParsedBook> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!["xlsx", "xls", "csv"].includes(extension))
    throw Error("XLSX·XLS·CSV 파일을 선택해 주세요.");
  if (!file.size || file.size > 10485760)
    throw Error("파일은 0바이트 초과·10MB 이하로 선택해 주세요.");
  const buffer = await file.arrayBuffer();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./workbook.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        Error(
          "파일 해석 시간이 초과되었습니다. 거래를 적은 행으로 나눠 다시 올려 주세요.",
        ),
      );
    }, 15000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onerror = () => {
      finish();
      reject(
        Error(
          "파일을 읽지 못했습니다. 엑셀에서 일반 XLSX로 다시 저장해 주세요.",
        ),
      );
    };
    worker.onmessage = (event) => {
      finish();
      if (event.data.error) reject(Error(event.data.error));
      else resolve({ ...event.data, hash, size: file.size, extension });
    };
    worker.postMessage({ buffer, extension }, [buffer]);
  });
}

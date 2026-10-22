import * as XLSX from "@e965/xlsx";
import { Unzip, UnzipInflate } from "fflate";
function inspectZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("엑셀 ZIP 구조를 읽을 수 없습니다.");
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true),
    total = 0;
  if (count > 1500) throw Error("파일 안의 항목이 너무 많습니다.");
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50)
      throw Error("손상된 엑셀 파일입니다.");
    const size = view.getUint32(pos + 24, true);
    total += size;
    if (
      size > 32 * 1024 * 1024 ||
      total > 64 * 1024 * 1024 ||
      view.getUint16(pos + 8, true) & 1
    )
      throw Error(
        "암호 파일 또는 압축 해제 크기가 너무 큰 파일입니다. 일반 엑셀로 다시 저장해 주세요.",
      );
    pos +=
      46 +
      view.getUint16(pos + 28, true) +
      view.getUint16(pos + 30, true) +
      view.getUint16(pos + 32, true);
  }
}
function validateInflation(bytes: Uint8Array) {
  let total = 0;
  const unzip = new Unzip((file) => {
    let size = 0;
    file.ondata = (error, chunk) => {
      if (error) throw Error("손상된 압축 파일입니다.");
      size += chunk.length;
      total += chunk.length;
      if (size > 32 * 1024 * 1024 || total > 64 * 1024 * 1024) {
        file.terminate();
        throw Error(
          "압축 해제한 파일이 너무 큽니다. 거래 행을 나눠 저장해 주세요.",
        );
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 1024)
    unzip.push(
      bytes.subarray(offset, offset + 1024),
      offset + 1024 >= bytes.length,
    );
}
self.onmessage = (event) => {
  try {
    const { buffer, extension } = event.data;
    const bytes = new Uint8Array(buffer);
    if (!bytes.length || bytes.length > 10485760)
      throw Error("파일은 0바이트 초과·10MB 이하로 선택해 주세요.");
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf;
    if ((extension === "xlsx" && !zip && !ole) || (extension === "xls" && !ole))
      throw Error(
        "확장자와 실제 파일 형식이 다릅니다. 엑셀에서 XLSX로 다시 저장해 주세요.",
      );
    if (zip) {
      inspectZip(bytes);
      validateInflation(bytes);
    }
    if (extension === "csv" && bytes.slice(0, 1000).includes(0))
      throw Error("CSV 텍스트 파일이 아닙니다. UTF-8 CSV로 저장해 주세요.");
    let source: Uint8Array | string = bytes;
    if (extension === "csv") {
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw Error("CSV는 UTF-8 형식으로 다시 저장해 주세요.");
      }
    }
    const book = XLSX.read(source, {
      type: extension === "csv" ? "string" : "array",
      cellFormula: true,
      cellDates: false,
      bookVBA: true,
      sheetRows: 5101,
      raw: true,
    });
    if (book.vbaraw)
      throw Error(
        "매크로 포함 파일은 사용할 수 없습니다. 매크로 없는 XLSX로 저장해 주세요.",
      );
    if (book.SheetNames.length > 20)
      throw Error("시트는 20개 이하로 나눠 주세요.");
    let totalCells = 0;
    const sheets = book.SheetNames.map((name, index) => {
      const sheet = book.Sheets[name];
      const range = XLSX.utils.decode_range(
        sheet["!fullref"] || sheet["!ref"] || "A1",
      );
      if (range.e.r >= 5100 || range.e.c >= 100)
        throw Error(
          "한 시트는 5,100행·100열 이하로 나눠 주세요. 거래는 한 번에 5,000행까지 저장합니다.",
        );
      totalCells += (range.e.r + 1) * (range.e.c + 1);
      if (totalCells > 600000)
        throw Error("전체 셀이 너무 많습니다. 필요한 거래 시트만 남겨 주세요.");
      const rows: any[][] = [];
      for (let r = 0; r <= range.e.r; r++) {
        const row = [];
        for (let c = 0; c <= range.e.c; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })];
          if (cell?.f) row.push({ formula: true });
          else {
            const value = cell?.v ?? "";
            if (String(value).length > 2000)
              throw Error(
                "너무 긴 셀 값이 있습니다. 필요한 거래 열만 남겨 주세요.",
              );
            row.push(value);
          }
        }
        rows.push(row);
      }
      return { index, rows };
    });
    self.postMessage({ sheets, date1904: !!book.Workbook?.WBProps?.date1904 });
  } catch (error: any) {
    self.postMessage({
      error: /password|encrypt/i.test(error.message)
        ? "암호가 걸린 파일은 처리할 수 없습니다. 엑셀에서 암호를 해제하고 다시 저장해 주세요."
        : /[가-힣]/.test(error.message || "")
          ? error.message
          : "파일 형식이나 손상 여부를 확인해 주세요. 엑셀에서 일반 XLSX로 다시 저장할 수 있습니다.",
    });
  }
};

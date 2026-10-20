// Browser/OS MIME labels vary (for example PPTX can be reported as ZIP).
// Only supported extensions are normalized; this does not verify document contents.
const mimeByExtension = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  hwp: "application/x-hwp",
  hwpx: "application/vnd.hancom.hwpx",
  txt: "text/plain",
  csv: "text/csv",
};
export function normalizeAttachment(file) {
  const name = file.name.trim();
  const ext = name.split(".").pop()?.toLowerCase();
  const type = Object.hasOwn(mimeByExtension, ext)
    ? mimeByExtension[ext]
    : null;
  if (!type)
    throw new Error(
      `「${file.name}」: 지원하지 않는 확장자입니다. JPG·PNG·WebP·PDF·PPT·엑셀·워드·한글·TXT·CSV를 선택해 주세요.`,
    );
  if (name.length > 200)
    throw new Error(
      `「${file.name}」: 파일 이름을 확장자 포함 200자 이하로 줄여 주세요.`,
    );
  if (!file.size)
    throw new Error(`「${file.name}」: 빈 파일은 저장할 수 없습니다.`);
  if (!type.startsWith("image/") && file.size > 10485760)
    throw new Error(
      `「${file.name}」: 문서는 파일당 10MB 이하로 선택해 주세요.`,
    );
  return new File([file], name, { type, lastModified: file.lastModified });
}

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "@e965/xlsx";
import { today } from "../../src/lib/utils.js";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const env = Object.fromEntries(
  readFileSync(".env.test", "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
if (env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Local finance trials only");
async function login(page: Page, who: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("이메일", { exact: true })
    .fill(fixtures.users[who].email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(fixtures.users[who].password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "공동회계", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "계좌번호 복사", exact: true }),
  ).toBeVisible();
}
for (const [extension, width] of [
  ["xlsx", 1440],
  ["xls", 390],
  ["csv", 820],
] as const) {
  test(`공동회계 ${extension} ${width}px: 총무 업로드·중복·회원 공유·보고서·유지`, async ({
    browser,
  }) => {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    expect(
      (await db.auth.signInWithPassword(fixtures.users.admin)).error,
    ).toBeNull();
    const call = async (name: string, args = {}) => {
      const r = await db.rpc(name, args);
      expect(r.error).toBeNull();
      return r.data;
    };
    const initial = await call("accounting_overview");
    await call("accounting_configure", {
      p_version: initial.settings.version,
      p_name: "[가상] 공동회계 시험 통장",
      p_number: "000000000000",
    });
    await call("accounting_set_treasurer", {
      p_user: fixtures.users.a.id,
      p_enabled: true,
    });
    const run = "가상회계" + Math.floor(1000000 + Math.random() * 9000000),
      month = today().slice(0, 7);
    const values = [
      ["[가상] 은행 파일 형식 시험"],
      ["거래일시", "거래구분", "거래금액", "거래내용", "잔액"],
      [`${month}-03 09:00:00`, "입금", 50000, `${run} 회비`, 50000],
      [`${month}-04 10:00:00`, "출금", 10000, `${run} 모종`, 40000],
      ["잘못된 날짜", "입금", 1, "오류 가상 행", null],
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(values), "가상");
    const bytes = XLSX.write(book, {
      bookType: extension === "xls" ? "biff8" : extension,
      type: "buffer",
    });
    const hash = createHash("sha256").update(bytes).digest("hex");
    const author = await browser.newContext({
      viewport: { width, height: 1000 },
      isMobile: width < 600,
      hasTouch: width < 1000,
    });
    const reader = await browser.newContext({
      viewport: { width, height: 1000 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    try {
      const page = await author.newPage();
      await page.route("https://api.open-meteo.com/**", (r) => r.abort());
      await login(page, "a");
      await page
        .getByRole("button", { name: "거래내역 가져오기", exact: true })
        .click();
      const panel = page.locator(".accounting-import");
      async function uploadFile() {
        await expect(
          panel.getByLabel("거래내역 파일", { exact: true }),
        ).toBeEnabled();
        await panel.getByLabel("거래내역 파일", { exact: true }).setInputFiles({
          name: `가상거래.${extension}`,
          mimeType:
            extension === "xlsx"
              ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              : extension === "xls"
                ? "application/vnd.ms-excel"
                : "text/csv",
          buffer: bytes,
        });
        await expect(panel.getByLabel("제목행 번호")).toHaveValue("2");
        await panel
          .getByRole("button", { name: "미리보기와 중복 검사", exact: true })
          .click();
      }
      await uploadFile();
      await expect(panel.locator(".accounting-import-counts")).toContainText(
        "신규 2건",
      );
      await expect(panel.locator(".accounting-import-counts")).toContainText(
        "오류 1건",
      );
      await panel.getByRole("checkbox", { name: /미리보기·계좌/ }).check();
      await panel
        .getByRole("button", { name: "확인한 거래 최종 저장", exact: true })
        .click();
      await expect(
        panel.getByRole("status").filter({ hasText: "저장 완료" }),
      ).toContainText("저장 완료: 신규 2건");
      await uploadFile();
      await expect(panel.locator(".accounting-import-counts")).toContainText(
        "확실한 중복 2건",
      );
      await panel.getByRole("checkbox", { name: /미리보기·계좌/ }).check();
      await panel
        .getByRole("button", { name: "확인한 거래 최종 저장", exact: true })
        .click();
      await expect(
        panel.getByRole("status").filter({ hasText: "저장 완료" }),
      ).toContainText("저장 완료: 신규 0건");
      await page.getByLabel("거래 찾기", { exact: true }).fill(run);
      const expense = page
        .locator(".accounting-transaction")
        .filter({ hasText: `${run} 모종` });
      await expense
        .getByRole("button", { name: "사용분류·비고 수정", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const note = '=HYPERLINK("https://example.invalid")';
      await dialog.getByLabel("비고", { exact: true }).fill(note);
      await dialog
        .getByRole("button", { name: "분류·비고 저장", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      const other = await reader.newPage();
      await other.route("https://api.open-meteo.com/**", (r) => r.abort());
      await login(other, "b");
      await expect(
        other.getByRole("button", { name: "거래내역 가져오기", exact: true }),
      ).toHaveCount(0);
      await expect(other.locator(".accounting-settings")).toHaveCount(0);
      await other
        .getByRole("button", { name: "계좌번호 복사", exact: true })
        .click();
      expect(await other.evaluate(() => navigator.clipboard.readText())).toBe(
        "000000000000",
      );
      await expect(
        other.getByRole("link", { name: /카카오뱅크 바로가기/ }),
      ).toHaveAttribute("href", "https://www.kakaobank.com/");
      await other.getByLabel("거래 찾기", { exact: true }).fill(run);
      await expect(other.locator(".accounting-transaction")).toHaveCount(2);
      await expect(
        other.locator(".accounting-transaction").filter({ hasText: note }),
      ).toHaveCount(1);
      const event = other.waitForEvent("download");
      await other
        .getByRole("button", { name: "선택기간 엑셀 보고서", exact: true })
        .click();
      const file = await event;
      const report = XLSX.read(readFileSync((await file.path())!), {
        type: "buffer",
        cellFormula: true,
      });
      expect(report.SheetNames).toContain("월별");
      const rows = XLSX.utils.sheet_to_json<any[]>(report.Sheets["거래내역"], {
        header: 1,
      });
      expect(rows.some((r) => r[2] === `${run} 모종`)).toBe(true);
      const target = rows.findIndex((r) => r[5] === note);
      expect(target).toBeGreaterThan(0);
      expect(report.Sheets["거래내역"][`F${target + 1}`].f).toBeUndefined();
      await other.reload();
      await other
        .locator("nav")
        .getByRole("button", { name: "공동회계", exact: true })
        .click();
      await expect(
        other.getByRole("button", { name: "계좌번호 복사", exact: true }),
      ).toBeVisible();
      await other.getByLabel("거래 찾기", { exact: true }).fill(run);
      await expect(other.locator(".accounting-transaction")).toHaveCount(2);
      expect(
        await other.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await other.screenshot({
        path: `docs/screenshots/accounting-${width}.png`,
        fullPage: true,
      });
      await other
        .getByRole("button", { name: "로그아웃", exact: true })
        .click();
      await expect(
        other.getByRole("button", { name: "로그인", exact: true }),
      ).toBeVisible();
      await login(other, "b");
      await other.getByLabel("거래 찾기", { exact: true }).fill(run);
      await expect(other.locator(".accounting-transaction")).toHaveCount(2);
    } finally {
      await author.close().catch(() => {});
      await reader.close().catch(() => {});
      const history = await call("accounting_history");
      for (const batch of history.imports.filter(
        (b: any) => b.file_hash === hash && !b.cancelled_at,
      ))
        await call("accounting_cancel", {
          p_id: batch.id,
          p_reason: "가상 브라우저 회계 시험 정리",
        });
      await call("accounting_set_treasurer", {
        p_user: fixtures.users.a.id,
        p_enabled: false,
      });
      await db.auth.signOut();
    }
  });
}

test("관리자 화면: 계좌 설정·총무 지정·분류 추가·안전 취소·잘못된 파일 안내", async ({
  browser,
}) => {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  expect(
    (await db.auth.signInWithPassword(fixtures.users.admin)).error,
  ).toBeNull();
  const call = async (name: string, args = {}) => {
    const r = await db.rpc(name, args);
    expect(r.error).toBeNull();
    return r.data;
  };
  const nonce = String(Math.floor(1000000 + Math.random() * 9000000));
  const hash = createHash("sha256")
    .update("admin-ui-" + nonce)
    .digest("hex");
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 1000 },
  });
  let batch: string | undefined;
  try {
    const page = await ctx.newPage();
    await page.route("https://api.open-meteo.com/**", (r) => r.abort());
    await login(page, "admin");
    const settings = page.locator(".accounting-settings");
    await settings.locator("summary").click();
    await settings
      .getByLabel("모임통장 명칭", { exact: true })
      .fill("[가상] 관리자 화면 시험");
    await settings
      .getByLabel("카카오뱅크 계좌번호", { exact: true })
      .fill("000000000000");
    await settings
      .getByRole("button", { name: "계좌정보 저장", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "[가상] 관리자 화면 시험",
        exact: true,
      }),
    ).toBeVisible();
    const treasurer = settings.locator(
      `input[type="checkbox"][value="${fixtures.users.a.id}"]`,
    );
    await expect(treasurer).toBeEnabled();
    await treasurer.click();
    await expect(treasurer).toBeChecked();
    await expect
      .poll(async () =>
        (await call("accounting_overview")).treasurers.includes(
          fixtures.users.a.id,
        ),
      )
      .toBe(true);
    await expect(treasurer).toBeEnabled();
    await treasurer.click();
    await expect(treasurer).not.toBeChecked();
    await expect
      .poll(async () =>
        (await call("accounting_overview")).treasurers.includes(
          fixtures.users.a.id,
        ),
      )
      .toBe(false);
    await settings
      .getByLabel("새 사용분류", { exact: true })
      .fill("가상분류" + nonce);
    await settings
      .getByRole("button", { name: "회계 분류 추가", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await call("accounting_overview")).category_options.some(
          (r: any) => r.name === "가상분류" + nonce,
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "거래내역 가져오기", exact: true })
      .click();
    const panel = page.locator(".accounting-import");
    await panel.getByLabel("거래내역 파일", { exact: true }).setInputFiles({
      name: "잘못된.xlsx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("Not an Excel workbook"),
    });
    await expect(panel.getByRole("alert")).toContainText(
      "실제 파일 형식이 다릅니다",
    );
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["거래일시", "입금액", "거래내용"],
      [`${today()} 09:00:00`, 10, "가상 수식"],
    ]);
    sheet.C2 = { t: "n", f: "1+1", v: 2 };
    XLSX.utils.book_append_sheet(workbook, sheet, "가상");
    await panel.getByLabel("거래내역 파일", { exact: true }).setInputFiles({
      name: "수식검사.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    });
    await panel
      .getByRole("button", { name: "미리보기와 중복 검사", exact: true })
      .click();
    await expect(panel.locator(".accounting-import-counts")).toContainText(
      "오류 1건",
    );
    await expect(panel).toContainText("수식 또는 비정상 값");
    const imported = await call("accounting_import", {
      p_id: crypto.randomUUID(),
      p_file_hash: hash,
      p_rows: [
        {
          source_sheet: 0,
          source_row: 2,
          occurred_at: `${today()}T13:00:00`,
          time_precision: "second",
          direction: "income",
          amount: 123,
          description: "가상취소" + nonce,
          balance: null,
          bank_reference: "",
        },
      ],
      p_decisions: {},
      p_meta: {
        file_type: "xlsx",
        file_size: 100,
        mapping: { date: 0, amount: 1 },
      },
    });
    batch = imported.id;
    await page
      .getByRole("button", { name: "업로드·수정 이력", exact: true })
      .click();
    const entry = page
      .locator(".accounting-history-row")
      .filter({ hasText: batch!.slice(0, 8) });
    await entry
      .getByRole("button", { name: "이 업로드 취소 검토", exact: true })
      .click();
    await entry
      .getByLabel("취소 사유", { exact: true })
      .fill("가상 화면 검증 취소");
    await expect(
      entry.getByRole("button", { name: "업로드 취소 확정", exact: true }),
    ).toBeDisabled();
    await entry
      .getByLabel("확인을 위해 ‘취소’ 입력", { exact: true })
      .fill("취소");
    await entry
      .getByRole("button", { name: "업로드 취소 확정", exact: true })
      .click();
    await expect(entry).toContainText("사유: 가상 화면 검증 취소");
    expect(
      (await call("accounting_overview", { p_query: "가상취소" + nonce }))
        .total,
    ).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await ctx.close();
    const history = await call("accounting_history");
    if (
      batch &&
      history.imports.some((b: any) => b.id === batch && !b.cancelled_at)
    )
      await call("accounting_cancel", {
        p_id: batch,
        p_reason: "가상 시험 정리",
      });
    await call("accounting_set_treasurer", {
      p_user: fixtures.users.a.id,
      p_enabled: false,
    });
  }
});

test("회계 SQL 미적용 안내 후에도 기존 농작업 메뉴 정상 이동", async ({
  page,
}) => {
  await page.route("**/rest/v1/rpc/accounting_overview", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ code: "PGRST202", message: "Function missing" }),
    }),
  );
  await page.route("https://api.open-meteo.com/**", (r) => r.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("이메일", { exact: true }).fill(fixtures.users.b.email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(fixtures.users.b.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  const nav = page.locator("nav");
  await nav.getByRole("button", { name: "공동회계", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "공동회계 데이터베이스 설치가 필요합니다",
  );
  await nav.getByRole("button", { name: /^농작업일지/ }).click();
  await expect(
    page.getByRole("heading", { name: "농작업일지", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
async function login(page: Page, who: string) {
  await page.goto("/");
  await page
    .getByLabel("이메일", { exact: true })
    .fill(fixtures.users[who].email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(fixtures.users[who].password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  if (who === "outside")
    await expect(
      page.getByRole("heading", { name: "농장 참여 승인이 필요해요" }),
    ).toBeVisible();
  else
    await expect(
      page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
    ).toBeVisible();
}
async function nav(page: Page, name: string) {
  await page.locator("nav").getByRole("button", { name, exact: false }).click();
}
const unique = "[브라우저 시험] " + Date.now();
test("격리된 A·B 계정: 사진 일지 공유 / 본인 수정 / 재접속 유지", async ({
  browser,
}) => {
  const aContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    bContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
  const a = await aContext.newPage(),
    b = await bContext.newPage();
  await login(a, "a");
  await login(b, "b");
  const picture = await a.screenshot({
    clip: { x: 30, y: 30, width: 120, height: 90 },
  });
  await a.getByRole("button", { name: "일지 쓰기", exact: true }).click();
  const editor = a.getByRole("dialog");
  await editor.getByLabel("제목").fill(unique);
  await editor.getByLabel("작업 날짜").fill("2026-10-16");
  await editor
    .getByLabel("한 일과 실행 결과")
    .fill("시험용 글과 사진을 다른 계정에서 확인합니다.");
  await editor.getByLabel("연결할 연간 계획").selectOption(fixtures.plan.id);
  await editor.locator("input[type=file]").setInputFiles({
    name: "브라우저사진.png",
    mimeType: "image/png",
    buffer: picture,
  });
  await editor.getByRole("button", { name: "저장하기" }).click();
  await expect(editor).toBeHidden();
  await b.getByRole("button", { name: "새로고침", exact: true }).click();
  await nav(b, "작업일지");
  await b
    .getByRole("button")
    .filter({ has: b.getByRole("heading", { name: unique, exact: true }) })
    .click();
  await expect(
    b
      .getByRole("dialog")
      .getByText("시험용 글과 사진을 다른 계정에서 확인합니다."),
  ).toBeVisible();
  await expect(b.getByRole("dialog").locator("img")).toHaveCount(1);
  await expect(
    b.getByRole("dialog").getByRole("button", { name: "수정하기" }),
  ).toHaveCount(0);
  await nav(a, "작업일지");
  await a
    .getByRole("button")
    .filter({ has: a.getByRole("heading", { name: unique, exact: true }) })
    .click();
  await a.getByRole("dialog").getByRole("button", { name: "수정하기" }).click();
  await a.getByLabel("제목").fill(unique + " 수정");
  await a.getByRole("button", { name: "저장하기" }).click();
  await expect(a.getByRole("dialog")).toBeHidden();
  await a.reload();
  await nav(a, "작업일지");
  await expect(
    a.getByRole("heading", { name: unique + " 수정" }),
  ).toBeVisible();
  await a.screenshot({ path: "test-results/desktop-log.png", fullPage: true });
  await aContext.close();
  await bContext.close();
});
test("저장 실패 때 입력 보존·복구 후 재시도", async ({ page, context }) => {
  await login(page, "a");
  await page.getByRole("button", { name: "일지 쓰기", exact: true }).click();
  await page.getByLabel("제목").fill("[브라우저 시험] 연결 실패 후 저장");
  await page
    .getByLabel("한 일과 실행 결과")
    .fill("실패해도 이 문장은 남습니다.");
  await context.setOffline(true);
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "인터넷 연결",
  );
  await expect(page.getByLabel("한 일과 실행 결과")).toHaveValue(
    "실패해도 이 문장은 남습니다.",
  );
  await context.setOffline(false);
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});
test("열람자 화면은 작성·수정 불가, 비참여자 농장 진입 불가", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "viewer");
  await expect(page.getByRole("button", { name: "일지 쓰기" })).toHaveCount(0);
  await nav(page, "작업일지");
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: fixtures.log.title, exact: true }),
    })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "수정하기" }),
  ).toHaveCount(0);
  await ctx.close();
  const out = await browser.newContext();
  await login(await out.newPage(), "outside");
  await out.close();
});
test("연간 실적·연결 일지·결과 표시, 휴대전화 화면", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await login(page, "b");
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await nav(page, "연간 계획·실적");
  await page.getByLabel("목표 연도").fill("2025");
  await page
    .getByRole("button", { name: fixtures.plan.title, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("[시험] 겨울 준비 완료", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("연결된 작업일지"),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await nav(page, "작업일지");
  await page.getByRole("button", { name: "일지 쓰기", exact: true }).click();
  await page.getByLabel("제목").fill(unique + " 현장 기록");
  await page.getByLabel("한 일과 실행 결과").fill("모바일 입력과 저장 확인");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: unique + " 현장 기록" }),
  ).toBeVisible();
  await ctx.close();
});
test("관리자 수정·휴지통 복원·CSV·파일 포함 백업", async ({ page }) => {
  await login(page, "admin");
  await nav(page, "작업일지");
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: fixtures.log.title, exact: true }),
    })
    .click();
  await expect(page.getByRole("button", { name: "수정하기" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "휴지통으로" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await nav(page, "농장 관리");
  const row = page
    .locator(".trash-row")
    .filter({ hasText: fixtures.log.title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "복원", exact: true }).click();
  await expect(row).toHaveCount(0);
  const csvEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV 내려받기" }).click();
  const csvFile = await csvEvent;
  const csvText = readFileSync((await csvFile.path())!, "utf8");
  expect(csvText.startsWith("\uFEFF")).toBeTruthy();
  expect(csvText).toContain(fixtures.log.title);
  const zipEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "전체 백업 ZIP" }).click();
  const zipFile = await zipEvent;
  const zip = unzipSync(readFileSync((await zipFile.path())!));
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
  expect(
    manifest.entries.some((e: any) => e.id === fixtures.log.id),
  ).toBeTruthy();
  expect(Object.keys(zip).some((k) => k.startsWith("files/"))).toBeTruthy();
  expect(JSON.stringify(manifest)).not.toMatch(
    /access_token|refresh_token|password|token_hash/,
  );
  await page.screenshot({ path: "test-results/admin.png", fullPage: true });
});
test("자료 업로드·검색·다운로드", async ({ page }) => {
  await login(page, "a");
  await nav(page, "자료실");
  await page.getByRole("button", { name: "자료 올리기" }).click();
  await page.getByLabel("제목").fill(unique + " 공유 문서");
  await page.getByLabel("자료 설명").fill("한국어 문서 다운로드 확인");
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles({
      name: "농장안내.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("농장 안내입니다.", "utf8"),
    });
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByLabel("검색어").fill("공유 문서");
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", {
        name: unique + " 공유 문서",
        exact: true,
      }),
    })
    .click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "내려받기", exact: true }).click();
  const file = await event;
  expect(readFileSync((await file.path())!, "utf8")).toBe("농장 안내입니다.");
});

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
  if (who !== "outside") await nav(page, "농작업일지");
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
  await a.getByRole("button", { name: "농작업 기록하기", exact: true }).click();
  const editor = a.getByRole("dialog");
  await editor.getByLabel("제목").fill(unique);
  await editor.getByLabel("작업 날짜").fill("2026-10-16");
  await editor
    .getByLabel("작업 내용 및 특이사항")
    .fill("시험용 글과 사진을 다른 계정에서 확인합니다.");
  await editor.getByLabel("관련 농장계획").selectOption(fixtures.plan.id);
  await editor.locator("input[type=file]").setInputFiles({
    name: "브라우저사진.png",
    mimeType: "image/png",
    buffer: picture,
  });
  await editor.getByRole("button", { name: "저장하기" }).click();
  await expect(editor).toBeHidden();
  await b.getByRole("button", { name: "새로고침", exact: true }).click();
  await nav(b, "농작업일지");
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
  await nav(a, "농작업일지");
  await a
    .getByRole("button")
    .filter({ has: a.getByRole("heading", { name: unique, exact: true }) })
    .click();
  await a.getByRole("dialog").getByRole("button", { name: "수정하기" }).click();
  await a.getByLabel("제목").fill(unique + " 수정");
  await a.getByRole("button", { name: "저장하기" }).click();
  await expect(a.getByRole("dialog")).toBeHidden();
  await a.reload();
  await nav(a, "농작업일지");
  await expect(
    a.getByRole("heading", { name: unique + " 수정" }),
  ).toBeVisible();
  await a.screenshot({ path: "test-results/desktop-log.png", fullPage: true });
  await aContext.close();
  await bContext.close();
});
test("저장 실패 때 입력 보존·복구 후 재시도", async ({ page, context }) => {
  await login(page, "a");
  await page
    .getByRole("button", { name: "농작업 기록하기", exact: true })
    .click();
  await page.getByLabel("제목").fill("[브라우저 시험] 연결 실패 후 저장");
  await page
    .getByLabel("작업 내용 및 특이사항")
    .fill("실패해도 이 문장은 남습니다.");
  await context.setOffline(true);
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "인터넷 연결",
  );
  await expect(page.getByLabel("작업 내용 및 특이사항")).toHaveValue(
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
  await expect(
    page.getByRole("button", { name: "농작업 기록하기" }),
  ).toHaveCount(0);
  await nav(page, "농작업일지");
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
  await nav(page, "농장계획");
  await page.getByLabel("목표 연도").fill("2025");
  await page
    .getByRole("button", { name: fixtures.plan.title, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("[시험] 겨울 준비 완료", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByText("연결된 기록")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await nav(page, "농작업일지");
  await page
    .getByRole("button", { name: "농작업 기록하기", exact: true })
    .click();
  await page.getByLabel("제목").fill(unique + " 현장 기록");
  await page
    .getByLabel("작업 내용 및 특이사항")
    .fill("모바일 입력과 저장 확인");
  await page.getByRole("button", { name: "저장하기" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    page.getByRole("heading", { name: unique + " 현장 기록" }),
  ).toBeVisible();
  await ctx.close();
});
test("관리자 수정·휴지통 복원·CSV·파일 포함 백업", async ({ page }) => {
  await login(page, "admin");
  await nav(page, "농작업일지");
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
  expect(Array.isArray(manifest.comments)).toBeTruthy();
  expect(Array.isArray(manifest.reactions)).toBeTruthy();
  expect(JSON.stringify(manifest)).not.toMatch(
    /access_token|refresh_token|password|token_hash/,
  );
  await page.screenshot({ path: "test-results/admin.png", fullPage: true });
});
test("자료 업로드·검색·다운로드", async ({ page }) => {
  await login(page, "a");
  await nav(page, "자료함");
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

test("기존 사진 일지를 나중에 만든 계획에 수정 연결하고 재접속 후 유지", async ({
  page,
}) => {
  await login(page, "a");
  const suffix = String(Date.now());
  const logTitle = "[브라우저 시험] 사후 연결 일지 " + suffix;
  const planTitle = "[브라우저 시험] 사후 연결 계획 " + suffix;
  const picture = await page.screenshot({
    clip: { x: 30, y: 30, width: 120, height: 90 },
  });
  await page
    .getByRole("button", { name: "농작업 기록하기", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("제목").fill(logTitle);
  await dialog
    .getByLabel("작업 내용 및 특이사항")
    .fill("나중에 만든 계획에 연결하는 시험 기록입니다.");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "사후연결.png",
    mimeType: "image/png",
    buffer: picture,
  });
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).toBeHidden();
  await nav(page, "농장계획");
  await page.getByRole("button", { name: "계획 세우기" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("제목").fill(planTitle);
  await dialog
    .getByLabel("계획 내용")
    .fill("이미 저장된 사진 일지를 연결하는 시험 계획입니다.");
  const year = await dialog.getByLabel("목표 연도").inputValue();
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).toBeHidden();
  await nav(page, "농작업일지");
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: logTitle, exact: true }) })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "수정하기" })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("관련 농장계획")
    .selectOption({ label: `${year} · ${planTitle}` });
  await dialog.getByRole("button", { name: "저장하기" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
  ).toBeVisible();
  await nav(page, "농작업일지");
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: logTitle, exact: true }) })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: `${year} · ${planTitle}`, exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: planTitle, exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("미실행", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: logTitle, exact: false }),
  ).toBeVisible();
  await expect(dialog.locator("img")).toHaveAttribute("src", /^blob:/);
});

test("관리자가 분류를 추가하고 다른 계정이 선택·검색, 목록 제외 후에도 기존 자료 유지", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const member = await memberContext.newPage();
  await login(admin, "admin");
  await nav(admin, "농장 관리");
  const categoryName = "교육 " + Date.now();
  await admin
    .getByLabel("사용할 분류")
    .fill("일반\n" + categoryName + "\n회의록");
  await admin.getByRole("button", { name: "분류 저장", exact: true }).click();
  await expect(
    admin.getByText("자료함 분류를 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await login(member, "a");
  await nav(member, "자료함");
  await member
    .getByRole("button", { name: "자료 올리기", exact: true })
    .click();
  const editor = member.getByRole("dialog");
  const title = "[브라우저 시험] 분류 자료 " + Date.now();
  await editor.getByLabel("제목").fill(title);
  await editor.getByLabel("분류", { exact: false }).selectOption(categoryName);
  await editor.getByLabel("웹링크").fill("https://example.com/");
  await editor.getByRole("button", { name: "저장하기" }).click();
  await expect(editor).toBeHidden();
  await member.reload();
  await nav(member, "자료함");
  await member
    .getByLabel("자료 분류", { exact: true })
    .selectOption(categoryName);
  await expect(
    member.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await admin.getByLabel("사용할 분류").fill("일반\n회의록");
  await admin.getByRole("button", { name: "분류 저장", exact: true }).click();
  await expect(
    admin.getByRole("button", { name: "분류 저장", exact: true }),
  ).toBeEnabled();
  await member.reload();
  await nav(member, "자료함");
  await member
    .getByLabel("자료 분류", { exact: true })
    .selectOption(categoryName);
  await member
    .getByRole("button")
    .filter({ has: member.getByRole("heading", { name: title, exact: true }) })
    .click();
  await member
    .getByRole("dialog")
    .getByRole("button", { name: "수정하기" })
    .click();
  await expect(
    member.getByRole("dialog").getByLabel("분류", { exact: false }),
  ).toHaveValue(categoryName);
  await adminContext.close();
  await memberContext.close();
});

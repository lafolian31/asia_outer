import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { today } from "../../src/lib/utils.js";
const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
async function login(page: Page, who = "a") {
  await page.goto("/");
  await page
    .getByLabel("이메일", { exact: true })
    .fill(fixtures.users[who].email);
  await page
    .getByLabel("비밀번호", { exact: true })
    .fill(fixtures.users[who].password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "농작업 기록하기", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".quick-record")).toHaveCount(0);
  await expect(
    page.locator("nav").getByRole("button", { name: "자료함", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("nav").getByRole("button", { name: "농장 관리", exact: true }),
  ).toHaveCount(who === "admin" ? 1 : 0);
  await nav(page, "농작업일지");
}
async function nav(page: Page, name: string) {
  await page.locator("nav").getByRole("button", { name }).click();
}
async function openCard(page: Page, title: string) {
  await page
    .getByRole("button")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .click();
}

test("모바일 빠른 선택·작물 등록·자동 제목·다중 사진·필터·복사·최근 값", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  try {
    await login(page);
    const crop = "[검수용] 들깨 " + Date.now();
    await page
      .getByRole("button", { name: "농작업 기록하기", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("작업 날짜")).toHaveValue(today());
    await dialog
      .getByRole("button", { name: "잡초·병해충", exact: true })
      .tap();
    await dialog.getByRole("button", { name: "제초", exact: true }).tap();
    await dialog.getByLabel("새 작물 이름", { exact: true }).fill(crop);
    await dialog
      .getByRole("button", { name: "작물 등록", exact: true })
      .click();
    await expect(dialog.getByLabel("제목", { exact: true })).toHaveValue(
      crop + " · 제초",
    );
    const zones = dialog.getByLabel("작업 장소", { exact: true });
    const firstZone =
      (await zones.locator("option").nth(1).getAttribute("value")) ||
      (await zones.locator("option").nth(1).textContent());
    await zones.selectOption(firstZone!);
    await dialog
      .getByText("작업량·참여자 추가 (선택)", { exact: true })
      .click();
    await dialog.getByLabel("작업량", { exact: true }).fill("2.5");
    await dialog.getByLabel("단위", { exact: true }).fill("두둑");
    await dialog.locator("input[type=checkbox]").first().check();
    const picture = await page.screenshot({
      clip: { x: 0, y: 0, width: 100, height: 100 },
    });
    await dialog.locator("input[type=file]").setInputFiles([
      { name: "작업1.png", mimeType: "image/png", buffer: picture },
      { name: "작업2.png", mimeType: "image/png", buffer: picture },
    ]);
    await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(dialog).toBeHidden();
    await nav(page, "농작업일지");
    await expect(page.locator(".filters select")).toHaveCount(0);
    await expect(page.locator(".filters input[type=date]")).toHaveCount(0);
    const search = page.getByLabel("검색어");
    await search.fill(`${crop} ${firstZone} 제초`);
    await expect(
      page.getByRole("heading", { name: crop + " · 제초", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".record-thumbnail img")).toBeVisible();
    await search.fill(`${crop} 작업1.jpg`);
    await expect(
      page.getByRole("heading", { name: crop + " · 제초", exact: true }),
    ).toBeVisible();
    await search.fill(`${crop} [시험] a`);
    await expect(
      page.getByRole("heading", { name: crop + " · 제초", exact: true }),
    ).toBeVisible();
    await search.fill(`${crop} 없는작성자`);
    await expect(
      page.getByRole("heading", { name: crop + " · 제초", exact: true }),
    ).toHaveCount(0);
    await search.fill(crop);
    await openCard(page, crop + " · 제초");
    await expect(
      dialog.getByText("작업량 2.5 두둑", { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".attachments img")).toHaveCount(2);
    await dialog
      .getByRole("button", { name: "이전 작업 복사", exact: true })
      .click();
    await expect(dialog.getByLabel("작업 날짜")).toHaveValue(today());
    await expect(dialog.locator(".selected-file")).toHaveCount(0);
    const copied = "[검수용] 복사 " + randomUUID();
    await dialog.getByLabel("제목", { exact: true }).fill(copied);
    await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
    await expect(dialog).toBeHidden();
    await nav(page, "농작업일지");
    await page
      .getByRole("button", { name: "농작업 기록하기", exact: true })
      .click();
    await expect(dialog.getByLabel("작물", { exact: true })).toHaveValue(crop);
    await expect(dialog.getByLabel("작업 장소", { exact: true })).toHaveValue(
      firstZone!,
    );
    page.once("dialog", (d) => d.accept());
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "test-results/selection-mobile.png",
      fullPage: true,
    });
  } finally {
    await ctx.close();
  }
});

test("사진부터 기록 후 분류·메모 보완, 기존 분류 미지정 일지 조회", async ({
  page,
}) => {
  await login(page);
  const picture = await page.screenshot({
    clip: { x: 0, y: 0, width: 100, height: 100 },
  });
  await page.getByText("빠른 기록 도구", { exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "사진부터 기록", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({ name: "사진먼저.png", mimeType: "image/png", buffer: picture });
  const dialog = page.getByRole("dialog");
  const title = "[검수용] 사진 우선 " + randomUUID();
  await dialog.getByLabel("제목", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await nav(page, "농작업일지");
  await openCard(page, title);
  await expect(dialog.locator(".attachments img")).toHaveCount(1);
  await dialog.getByRole("button", { name: "수정하기", exact: true }).click();
  await dialog.getByRole("button", { name: "관찰·점검", exact: true }).click();
  await dialog.getByRole("button", { name: "사진 기록", exact: true }).click();
  await dialog
    .getByLabel("작업 내용 및 특이사항")
    .fill("[검수용] 나중에 메모 보완");
  await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await nav(page, "농작업일지");
  await openCard(page, title);
  await expect(
    dialog.getByText("[검수용] 나중에 메모 보완", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByLabel("검색어").fill("분류 미지정");
  await expect(
    page.getByRole("heading", { name: fixtures.log.title, exact: true }),
  ).toBeVisible();
});

test("계획에서 농작업·운영 기록 작성, 메뉴 분리와 계획의 시간순 연결·기존 상태 유지", async ({
  page,
}) => {
  await login(page);
  await nav(page, "농장계획");
  await page.getByRole("button", { name: "계획 세우기", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const planTitle = "[검수용] 함께 연결 " + randomUUID();
  await dialog.getByLabel("제목").fill(planTitle);
  await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: planTitle, exact: true }).click();
  await dialog
    .getByRole("button", { name: "관련 농작업 기록하기", exact: true })
    .click();
  const farmTitle = "[검수용] 연결 농작업 " + randomUUID();
  await dialog
    .getByRole("button", { name: "물·양분 관리", exact: true })
    .click();
  await dialog.getByRole("button", { name: "관수", exact: true }).click();
  await dialog.getByLabel("제목", { exact: true }).fill(farmTitle);
  await dialog.getByLabel("작업 날짜").fill("2026-10-18");
  await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: planTitle, exact: true }).click();
  await dialog
    .getByRole("button", { name: "운영·교류 기록하기", exact: true })
    .click();
  const activityTitle = "[검수용] 연결 교육 " + randomUUID();
  await dialog
    .getByLabel("활동 분류", { exact: true })
    .selectOption("교육·견학");
  await dialog.getByLabel("제목", { exact: true }).fill(activityTitle);
  await dialog.getByLabel("활동 날짜").fill("2026-10-17");
  await dialog.getByRole("button", { name: "저장하기", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: planTitle, exact: true }).click();
  await expect(dialog.getByText("미실행", { exact: true })).toBeVisible();
  const linked = await dialog.locator(".linked-log > button").allTextContents();
  expect(linked[0]).toContain(activityTitle);
  expect(linked[1]).toContain(farmTitle);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await nav(page, "농작업일지");
  await page.getByLabel("검색어").fill(`${planTitle} 2026/10/18 관수`);
  await expect(
    page.getByRole("heading", { name: farmTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: activityTitle, exact: true }),
  ).toHaveCount(0);
  await nav(page, "운영·교류");
  await page
    .getByLabel("활동 분류 필터", { exact: true })
    .selectOption("교육·견학");
  await expect(
    page.getByRole("heading", { name: activityTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: farmTitle, exact: true }),
  ).toHaveCount(0);
});

test("관리자 세부작업 추가·수정, 기존 기록 유지와 열람자 선택형 작성 제한", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await login(page, "admin");
    await nav(page, "농장 관리");
    await page
      .getByLabel("관리할 대분류", { exact: true })
      .selectOption("관찰·점검");
    const task = "[검수용] 현장 관찰 " + Date.now();
    const original = await page
      .getByLabel("세부작업 목록", { exact: true })
      .inputValue();
    await page
      .getByLabel("세부작업 목록", { exact: true })
      .fill(original + "\n" + task);
    await page
      .getByRole("button", { name: "작업 목록 저장", exact: true })
      .click();
    await expect(
      page.getByText("농작업 선택 목록을 저장했습니다.", { exact: true }),
    ).toBeVisible();
    await nav(page, "농작업일지");
    await page
      .getByRole("button", { name: "농작업 기록하기", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "관찰·점검", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: task, exact: true }),
    ).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await nav(page, "농장 관리");
    await page
      .getByLabel("관리할 대분류", { exact: true })
      .selectOption("관찰·점검");
    await page.getByLabel("세부작업 목록", { exact: true }).fill(original);
    await page
      .getByRole("button", { name: "작업 목록 저장", exact: true })
      .click();
    await expect(
      page.getByText("농작업 선택 목록을 저장했습니다.", { exact: true }),
    ).toBeVisible();
  } finally {
    await ctx.close();
  }
  const view = await browser.newContext();
  const v = await view.newPage();
  try {
    await login(v, "viewer");
    await expect(
      v.getByRole("button", { name: "농작업 기록하기", exact: true }),
    ).toHaveCount(0);
    await nav(v, "운영·교류");
    await expect(
      v.getByRole("button", { name: "활동 기록하기", exact: true }),
    ).toHaveCount(0);
  } finally {
    await view.close();
  }
});

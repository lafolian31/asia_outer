import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  await expect(
    page.getByRole("heading", { name: "농장의 오늘을 살펴보세요" }),
  ).toBeVisible();
}
for (const [menu, button] of [
  ["농작업일지", "농작업 기록하기"],
  ["운영·교류", "활동 기록하기"],
  ["자료함", "자료 올리기"],
]) {
  test(`${menu}: 사진·문서 동시 저장, 재접속·다른 계정 내려받기`, async ({
    browser,
  }) => {
    const author = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const reader = await browser.newContext();
    try {
      const page = await author.newPage();
      await login(page, "a");
      await page
        .locator("nav")
        .getByRole("button", { name: new RegExp(`^${menu}`) })
        .click();
      await page.getByRole("button", { name: button, exact: true }).click();
      const dialog = page.getByRole("dialog");
      const title = "[검수용] 사진과 파일 " + randomUUID();
      await dialog.getByLabel("제목", { exact: false }).fill(title);
      await expect(dialog.locator("#attachments")).toHaveAttribute(
        "accept",
        /\.pptx/,
      );
      const content = "함께그린 공동 기록 파일 " + title;
      const picture = await page.screenshot({
        clip: { x: 0, y: 0, width: 80, height: 80 },
      });
      await dialog.locator("#attachments").setInputFiles([
        { name: "첨부사진.png", mimeType: "image/png", buffer: picture },
        {
          name: "공동발표.pptx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          buffer: Buffer.from(content),
        },
      ]);
      await dialog
        .getByRole("button", { name: "저장하기", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await page.reload();
      const other = await reader.newPage();
      await login(other, "b");
      await other
        .locator("nav")
        .getByRole("button", { name: new RegExp(`^${menu}`) })
        .click();
      await other
        .getByRole("button")
        .filter({
          has: other.getByRole("heading", { name: title, exact: true }),
        })
        .click();
      const detail = other.getByRole("dialog");
      await expect(detail.locator(".attachments img")).toHaveCount(1);
      const attachment = detail
        .locator(".attachment")
        .filter({ hasText: "공동발표.pptx" });
      const download = other.waitForEvent("download");
      await attachment.getByRole("button", { name: "내려받기" }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe("공동발표.pptx");
      expect(readFileSync((await file.path())!, "utf8")).toBe(content);
      await expect(
        detail.getByRole("button", { name: "수정하기", exact: true }),
      ).toHaveCount(0);
    } finally {
      await author.close();
      await reader.close();
    }
  });
}

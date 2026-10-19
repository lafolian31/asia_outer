import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const fixtures = JSON.parse(readFileSync(".env.test-fixtures.json", "utf8"));
const env = Object.fromEntries(
  readFileSync(".env.test", "utf8")
    .trim()
    .split("\n")
    .map((s) => {
      const at = s.indexOf("=");
      return [s.slice(0, at), s.slice(at + 1)];
    }),
);
if (env.SUPABASE_URL !== "http://127.0.0.1:54321")
  throw Error("Local discussion tests only.");
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
async function open(page: Page, entry: { kind: string; title: string }) {
  await page
    .locator("nav")
    .getByRole("button", {
      name: entry.kind === "log" ? "농작업일지" : "자료함 및 관리",
    })
    .click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: entry.title, exact: true }),
    })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: entry.title, exact: true }),
  ).toBeVisible();
}

test("일지·자료함 및 관리 댓글과 감정표현: PC·휴대전화 계정 공유, 본인 수정·삭제와 열람자 제한", async ({
  browser,
}) => {
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  expect((await db.auth.signInWithPassword(fixtures.users.b)).error).toBeNull();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    browser.newContext(),
  ]);
  const [a, b, viewer] = await Promise.all(contexts.map((c) => c.newPage()));
  const entries: any[] = [];
  try {
    for (const kind of ["log", "resource"]) {
      const result = await db.rpc("save_entry", {
        p_id: randomUUID(),
        p_version: 0,
        p_data: {
          kind,
          title: "[검수용] 대화 " + randomUUID(),
          body: "댓글·감정표현 브라우저 검수",
          work_date: "2026-10-19",
          url: kind === "resource" ? "https://example.com/" : "",
        },
      });
      expect(result.error).toBeNull();
      entries.push(result.data);
    }
    await Promise.all([login(a, "a"), login(b, "b"), login(viewer, "viewer")]);
    for (const entry of entries) {
      await Promise.all([open(a, entry), open(b, entry), open(viewer, entry)]);
      const text = "함께 확인합니다 " + randomUUID();
      await a.getByLabel("댓글 내용", { exact: true }).fill(text);
      await a.getByRole("button", { name: "댓글 등록", exact: true }).click();
      await expect(a.getByText(text, { exact: true })).toBeVisible();
      await a.getByRole("button", { name: "좋아요 0", exact: true }).click();
      await expect(
        a.getByRole("button", { name: "좋아요 1", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await b.getByRole("button", { name: "댓글 새로고침" }).click();
      await expect(b.getByText(text, { exact: true })).toBeVisible();
      await expect(
        b
          .locator(".comment")
          .filter({ hasText: text })
          .getByRole("button", { name: "댓글 수정", exact: true }),
      ).toHaveCount(0);
      await b.getByRole("button", { name: "사랑해요 0", exact: true }).tap();
      await expect(
        b.getByRole("button", { name: "사랑해요 1", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await a.getByRole("button", { name: "놀람 0", exact: true }).click();
      await expect(
        a.getByRole("button", { name: "좋아요 0", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await expect(
        a.getByRole("button", { name: "놀람 1", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await a.getByRole("button", { name: "놀람 1", exact: true }).click();
      await expect(
        a.getByRole("button", { name: "놀람 0", exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
      await a
        .locator(".comment")
        .filter({ hasText: text })
        .getByRole("button", { name: "댓글 수정", exact: true })
        .click();
      await a
        .getByLabel("댓글 수정 내용", { exact: true })
        .fill(text + " 수정");
      await a
        .getByRole("button", { name: "댓글 수정 저장", exact: true })
        .click();
      await expect(a.getByText(text + " 수정", { exact: true })).toBeVisible();
      await viewer.getByRole("button", { name: "댓글 새로고침" }).click();
      await expect(
        viewer.getByText(text + " 수정", { exact: true }),
      ).toBeVisible();
      await expect(
        viewer.getByRole("button", { name: "사랑해요 1", exact: true }),
      ).toBeDisabled();
      await expect(
        viewer.getByRole("button", { name: "댓글 등록", exact: true }),
      ).toHaveCount(0);
      await a.reload();
      await open(a, entry);
      await expect(a.getByText(text + " 수정", { exact: true })).toBeVisible();
      a.once("dialog", (d) => d.accept());
      await a
        .locator(".comment")
        .filter({ hasText: text })
        .getByRole("button", { name: "댓글 삭제", exact: true })
        .click();
      await expect(a.getByText(text + " 수정", { exact: true })).toHaveCount(0);
      expect(
        await b.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await Promise.all(
        [a, b, viewer].map((p) =>
          p.getByRole("button", { name: "닫기", exact: true }).click(),
        ),
      );
    }
    // A failed comment request preserves the draft for retry.
    await open(a, entries[0]);
    await a.route("**/rest/v1/rpc/save_comment", (route) => route.abort());
    await a
      .getByLabel("댓글 내용", { exact: true })
      .fill("실패해도 보존할 댓글");
    await a.getByRole("button", { name: "댓글 등록", exact: true }).click();
    await expect(a.locator(".discussion [role=alert]")).toBeVisible();
    await expect(a.getByLabel("댓글 내용", { exact: true })).toHaveValue(
      "실패해도 보존할 댓글",
    );
    await a.unroute("**/rest/v1/rpc/save_comment");
    await a.getByRole("button", { name: "댓글 등록", exact: true }).click();
    await expect(
      a.getByText("실패해도 보존할 댓글", { exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    for (const e of entries)
      expect(
        (await db.rpc("trash_entry", { p_id: e.id, p_version: e.version }))
          .error,
      ).toBeNull();
    await db.auth.signOut();
  }
});

test("추가 SQL 적용 전에도 기록 본문을 열 수 있고 업데이트 안내 표시", async ({
  page,
}) => {
  await login(page, "a");
  await page.route("**/rest/v1/entry_comments?*", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ code: "PGRST205", message: "Table not found" }),
    }),
  );
  await open(page, { kind: "log", title: fixtures.log.title });
  await expect(
    page.getByText(
      "감정표현과 댓글을 사용하려면 관리자가 데이터베이스 업데이트를 적용해야 합니다.",
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: fixtures.log.title, exact: true }),
  ).toBeVisible();
});

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
  throw Error("Local tests only");
for (const mobile of [false, true]) {
  test(`운영·교류 한 칸 찾기 ${mobile ? "모바일" : "PC"}: 날짜·분류·작성자·참여자·계획·파일과 CSV`, async ({
    browser,
  }) => {
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    expect(
      (await db.auth.signInWithPassword(fixtures.users.admin)).error,
    ).toBeNull();
    const members = await db.from("members").select("user_id,display_name");
    expect(members.error).toBeNull();
    const person = (id: string) =>
      members.data!.find((m) => m.user_id === id)!.display_name;
    const saved: any[] = [];
    const run = "활동검수" + Date.now() + Math.floor(Math.random() * 1000000);
    const year = Number(today().slice(0, 4));
    const save = async (data: any) => {
      const r = await db.rpc("save_entry", {
        p_id: randomUUID(),
        p_version: 0,
        p_data: data,
      });
      expect(r.error).toBeNull();
      saved.push(r.data);
      return r.data;
    };
    const ctx = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1440, height: 1000 },
    });
    try {
      const plan = await save({
        kind: "plan",
        title: "연결교육계획" + randomUUID(),
        body: "",
        target_year: year + 1,
        start_date: `${year + 1}-01-01`,
        end_date: `${year + 1}-12-31`,
      });
      const education = await save({
        kind: "log",
        record_type: "activity",
        title: `${run} 교육`,
        body: "토양검정 실습메모",
        activity_category: "교육·견학",
        work_date: `${year - 1}-03-14`,
        plan_id: plan.id,
        participant_ids: [fixtures.users.b.id],
      });
      const meeting = await save({
        kind: "log",
        record_type: "activity",
        title: `${run} 회의`,
        body: "회의비 정산메모",
        activity_category: "회의·운영",
        work_date: `${year + 1}-09-20`,
      });
      const farm = await save({
        kind: "log",
        record_type: "farm",
        title: `${run} 농작업`,
        body: "토양검정 실습메모",
        work_date: today(),
      });
      const content = Buffer.from("시험용 교육자료");
      const asset = await db.rpc("reserve_asset", {
        p_id: randomUUID(),
        p_entry: education.id,
        p_name: "토양교안확인.txt",
        p_mime: "text/plain",
        p_size: content.length,
      });
      expect(asset.error).toBeNull();
      expect(
        (
          await db.storage
            .from("farm-files")
            .upload(asset.data.path, content, { contentType: "text/plain" })
        ).error,
      ).toBeNull();
      expect(
        (await db.rpc("finish_asset", { p_id: asset.data.id })).error,
      ).toBeNull();
      const page = await ctx.newPage();
      await page.route("https://api.open-meteo.com/**", (r) => r.abort());
      await page.goto("/");
      await page
        .getByLabel("이메일", { exact: true })
        .fill(fixtures.users.viewer.email);
      await page
        .getByLabel("비밀번호", { exact: true })
        .fill(fixtures.users.viewer.password);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page
        .locator("nav")
        .getByRole("button", { name: "운영·교류", exact: true })
        .click();
      await expect(page.locator(".filters select")).toHaveCount(0);
      await expect(page.locator(".filters input")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: "CSV", exact: true }),
      ).toBeVisible();
      const search = page.getByLabel("검색어");
      for (const [query, which] of [
        [run, "both"],
        [`${run} 없는검색어`, "none"],
        [`${run} 교육·견학`, "education"],
        [`${run} ${year - 1}/03/14`, "education"],
        [`${run} 9월`, "meeting"],
        [`${run} ${person(fixtures.users.admin.id)}`, "both"],
        [`${run} ${person(fixtures.users.b.id)}`, "education"],
        [`${run} ${plan.title}`, "education"],
        [`${run} 토양교안확인.txt`, "education"],
        [`${run} 토양검정`, "education"],
        [`${run} 계획 외 작업`, "meeting"],
      ]) {
        await search.fill(query);
        await expect(
          page.getByRole("heading", { name: education.title, exact: true }),
        ).toHaveCount(["both", "education"].includes(which) ? 1 : 0);
        await expect(
          page.getByRole("heading", { name: meeting.title, exact: true }),
        ).toHaveCount(["both", "meeting"].includes(which) ? 1 : 0);
        await expect(
          page.getByRole("heading", { name: farm.title, exact: true }),
        ).toHaveCount(0);
      }
      await search.fill(`${run} 교육·견학`);
      const event = page.waitForEvent("download");
      await page.getByRole("button", { name: "CSV", exact: true }).click();
      const file = await event;
      const csv = readFileSync((await file.path())!, "utf8");
      expect(csv).toContain(education.title);
      expect(csv).not.toContain(meeting.title);
      expect(csv).toContain("교육·견학");
      await search.fill("");
      await expect(
        page.getByRole("heading", { name: education.title, exact: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("heading", { name: meeting.title, exact: true }),
      ).toHaveCount(1);
      await expect(page.locator(".record-primary")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      await ctx.close();
      for (const entry of saved.reverse())
        expect(
          (
            await db.rpc("trash_entry", {
              p_id: entry.id,
              p_version: entry.version,
            })
          ).error,
        ).toBeNull();
      await db.auth.signOut();
    }
  });
}

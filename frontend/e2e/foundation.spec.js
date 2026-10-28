import { expect, test } from "@playwright/test";

test("navigates through the app and makes the theme preference persist", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /make every page work for everyone/i }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("radio", { name: /light/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Overview" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("keeps navigation usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Audit results" }).click();
  await expect(
    page.getByRole("heading", { name: /accessibility findings/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeVisible();
});

test("keeps account audit history on the API and does not fall back to browser-local snapshots", async ({ page }) => {
  await page.goto("/audits/new");
  await page.getByRole("button", { name: /scan the built-in sample/i }).click();
  await expect(page.getByRole("heading", { name: /accessibility findings/i })).toBeVisible({ timeout: 60_000 });

  await page.reload();
  await expect(page.getByRole("heading", { name: /accessibility findings/i })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("a11ypilot-audit-history-v1"))).toBeNull();
  await page.getByRole("link", { name: "Reports & history" }).click();
  await expect(page.getByText("PRIVATE ACCOUNT HISTORY", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /view results for AccessZ intentional accessibility sample/i })).toBeVisible();

  await page.route("**/api/audits/**", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: /view results for AccessZ intentional accessibility sample/i })).toHaveCount(0);
});

test("scans a real page, repairs a finding, previews the artifact, and rolls it back", async ({ page }) => {
  await page.goto("/audits/new");
  await expect(
    page.getByRole("status").filter({ hasText: "CHROMIUM + AXE-CORE READY" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /scan the built-in sample/i }).click();
  await expect(
    page.getByRole("heading", { name: "Images must have alternative text" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("ACCESSZ SCORE · NOT WCAG COMPLIANCE"),
  ).toBeVisible();
  await expect(
    page.getByText("color-contrast", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTitle(/Isolated preview/)).toBeVisible();

  const labelFindingLink = page.locator('a[href$="/issues/label"]').first();
  await expect(labelFindingLink).toBeVisible();
  await labelFindingLink.click();
  await page.getByRole("link", { name: /prepare repair/i }).click();
  await page.getByRole("button", { name: /generate fix suggestion/i }).click();
  await expect(page.getByText("Deterministic / manual suggestion")).toBeVisible();
  await expect(page.locator(".repair-code-proposed")).toContainText('aria-label="Email"');
  await page.getByRole("button", { name: /review patch/i }).click();
  const applyDialog = page.getByRole("dialog");
  await applyDialog.getByRole("checkbox").check();
  await applyDialog.getByRole("button", { name: "Approve & Apply Fix" }).click();
  await expect(page.getByText(/Applied to controlled artifact/)).toBeVisible();
  await expect(page.getByTitle("Applied repair artifact preview")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Applied repair artifact preview"]').getByRole("heading", { name: "Sample account form" })).toBeVisible();
  await expect(page.getByText("Not verified", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /roll back patch/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Roll back" }).click();
  await expect(page.getByText(/Original source restored/)).toBeVisible();
});

test("rescans a real applied repair and downloads verification-aware reports", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/audits/new");
  const baselineResponse = page.waitForResponse((response) =>
    response.url().includes("/api/audits/html") && response.request().method() === "POST");
  await page.getByRole("button", { name: /scan the built-in sample/i }).click();
  const { audit: baselineAudit } = await (await baselineResponse).json();
  await expect(page.getByRole("heading", { name: "Images must have alternative text" })).toBeVisible({ timeout: 60_000 });
  const baselineAuditId = baselineAudit.id;

  await page.locator('a[href$="/issues/label"]').first().click();
  await page.getByRole("link", { name: /prepare repair/i }).click();
  await page.getByRole("button", { name: /generate fix suggestion/i }).click();
  await page.getByRole("button", { name: /review patch/i }).click();
  const applyDialog = page.getByRole("dialog");
  await applyDialog.getByRole("checkbox").check();
  await applyDialog.getByRole("button", { name: "Approve & Apply Fix" }).click();
  await page.getByRole("link", { name: /verify repaired artifact/i }).click();
  await page.getByRole("button", { name: /verify selected repair/i }).click();

  await expect(page.getByRole("heading", { name: "Finding confirmed resolved" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".verification-finding-group h3").filter({ hasText: "Resolved" })).toBeVisible();

  await page.getByRole("link", { name: "Reports & history" }).click();
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /JSON report/i }).first().click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/^accessz-audit-.+\.json$/);

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /HTML report/i }).first().click();
  expect((await htmlDownload).suggestedFilename()).toMatch(/^accessz-audit-.+\.html$/);

  await page.goto(`/workspace?auditId=${encodeURIComponent(baselineAuditId)}`);
  await expect(page.getByLabel("Existing repair suggestions")).toBeVisible();
  await page.getByRole("button", { name: /roll back patch/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Roll back" }).click();
  await expect(page.getByText(/Original source restored/)).toBeVisible();
});

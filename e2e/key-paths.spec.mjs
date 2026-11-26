// Key paths from AGENTS §3 / DEPLOY §5 that a browser can check without a
// real AI key: 3D ready, honest "AI unavailable", sample apply, design
// workbench, labs, 390px layout, same-origin requests, no uncaught errors.
// Every test saves screenshots into E2E_SHOTS for the before/after diff;
// screenshots are taken before the assertions that might fail, so a base
// build that lacks a feature still yields comparable images.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS ?? 'e2e-shots';
fs.mkdirSync(SHOTS, { recursive: true });

const SCENE_READY = 'canvas[aria-label^="Rotatable campervan"]';
const SETTLE_MS = 2500;

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled', caret: 'hide' });
}

/** Collect uncaught page errors and requests that leave the site. */
function watch(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(String(error.message ?? error)));
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    if (new URL(url).origin !== origin) external.push(url);
  });
  return { errors, external };
}

async function noHorizontalOverflow(page) {
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll, `page is ${scroll}px wide in a ${inner}px viewport`).toBeLessThanOrEqual(inner + 1);
}

test('home: 3D view, honest AI state, sample applied to the van', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);
  await page.goto('/');
  await page.locator(SCENE_READY).waitFor({ timeout: 180_000 });
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, 'home-ready');
  await expect(page.getByText('One moment — the view ran into a problem')).toHaveCount(0);

  await page.getByRole('button', { name: 'Write a prompt to generate decals' }).click();
  const note = page.locator('output.ai-note');
  await expect(note).not.toHaveAttribute('data-generation-availability', 'loading');
  const availability = await note.getAttribute('data-generation-availability');
  if (availability !== 'configured') {
    // #28: without a server key both the button and Ctrl/Cmd+Enter stay inert.
    await expect(page.locator('button.generate-button')).toBeDisabled();
    await page.locator('#prompt').fill('retro green and white camping');
    await page.locator('#prompt').press('Control+Enter');
    await expect(page.locator('output.generation-progress')).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Try these ideas first' }).click();
  const cards = page.locator('button.concept-card');
  await expect(cards).toHaveCount(4);
  // Clicking a sample card applies it directly (chooseDesign → applyDesign).
  await cards.first().click();
  await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Applied to the van' })).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, 'home-sample-applied');

  await page.getByRole('button', { name: 'Reset view' }).click();
  expect(seen.errors, 'uncaught page errors').toEqual([]);
  expect(seen.external, 'requests leaving the site').toEqual([]);
});

test('design workbench opens', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);
  await page.goto('/design');
  const editor = page.getByRole('application', { name: '车身贴画编辑器' });
  await editor.waitFor({ timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, 'design');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(seen.errors, 'uncaught page errors').toEqual([]);
  expect(seen.external, 'requests leaving the site').toEqual([]);
});

// Under local `wrangler dev`, /body-lab and /model-lab answer the server
// render with vinext's 500 error shell and then render on the client; on the
// real Workers runtime (version previews) they return 200. The release smoke
// checks the status on the real runtime, so here a non-200 is a warning and
// the test asserts what the visitor ends up seeing.
function warnIfNotOk(response, route) {
  const status = response?.status() ?? 0;
  if (status === 200) return;
  const message = `${route} server render returned ${status} under local wrangler dev (client render checked below)`;
  test.info().annotations.push({ type: 'warning', description: message });
  console.log(`::warning::${message}`);
}

test('body lab and model lab render', async ({ page, baseURL }) => {
  const seen = watch(page, baseURL);
  const bodyLab = await page.goto('/body-lab');
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, 'body-lab');
  warnIfNotOk(bodyLab, '/body-lab');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const response = await page.goto('/model-lab');
  await page.waitForTimeout(SETTLE_MS);
  await page.locator('.model-lab-stage canvas').waitFor({ timeout: 180_000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, 'model-lab');
  warnIfNotOk(response, '/model-lab');
  await expect(page.locator('.model-lab-stage canvas')).toBeVisible();
  expect(seen.errors, 'uncaught page errors').toEqual([]);
  expect(seen.external, 'requests leaving the site').toEqual([]);
});

test.describe('390px phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('home and design fit the screen', async ({ page }) => {
    await page.goto('/');
    await page.locator(SCENE_READY).waitFor({ timeout: 180_000 });
    await page.waitForTimeout(SETTLE_MS);
    await shot(page, 'home-390');
    await noHorizontalOverflow(page);

    await page.goto('/design');
    await page.getByRole('application', { name: '车身贴画编辑器' }).waitFor({ timeout: 120_000 });
    await page.waitForTimeout(SETTLE_MS);
    await shot(page, 'design-390');
    await noHorizontalOverflow(page);
  });
});

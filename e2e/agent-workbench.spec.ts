import { expect, test } from '@playwright/test';

const username = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'WorkbenchE2EPassword-2026!';
const apiBase = `http://127.0.0.1:${process.env.E2E_HOST_PORT ?? '3201'}`;

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('link', { name: /workbench/i }).first()).toBeVisible();
}

async function gotoApp(page: import('@playwright/test').Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

async function openComposerSettings(page: import('@playwright/test').Page): Promise<void> {
  const toggle = page.getByTestId('composer-settings-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function openComposerAdvancedOptions(page: import('@playwright/test').Page): Promise<void> {
  const advanced = page.locator('details.agent-settings-group-advanced');
  await expect(advanced).toBeVisible();
  if (!(await advanced.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await advanced.locator('summary').click();
  }
  await expect(advanced).toHaveAttribute('open', '');
}

async function selectComposerModel(
  page: import('@playwright/test').Page,
  name: string | RegExp
): Promise<void> {
  await page.getByTestId('composer-model-menu-button').click();
  await page.getByTestId('composer-model-submenu-button').click();
  await page
    .getByTestId('composer-model-submenu')
    .getByRole('menuitemradio', { name, exact: typeof name === 'string' })
    .click();
}

async function selectComposerEffort(
  page: import('@playwright/test').Page,
  name: string | RegExp
): Promise<void> {
  await page.getByTestId('composer-model-menu-button').click();
  await page
    .getByTestId('composer-model-menu')
    .getByRole('menuitemradio', { name, exact: typeof name === 'string' })
    .click();
}

async function selectComposerSpeed(
  page: import('@playwright/test').Page,
  name: string | RegExp
): Promise<void> {
  await page.getByTestId('composer-model-menu-button').click();
  await page.getByTestId('composer-speed-submenu-button').click();
  await page
    .getByTestId('composer-speed-menu')
    .getByRole('menuitemradio', { name, exact: typeof name === 'string' })
    .click();
  await expect(page.getByTestId('composer-speed-menu')).toBeVisible();
  await page.keyboard.press('Escape');
}

async function selectComposerPermission(
  page: import('@playwright/test').Page,
  name: string | RegExp
): Promise<void> {
  await page.getByTestId('composer-permission-menu-button').click();
  await page
    .getByTestId('composer-permission-menu')
    .getByRole('menuitemradio', { name, exact: typeof name === 'string' })
    .click();
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBeTruthy();
}

async function expectPathValue(
  input: import('@playwright/test').Locator,
  expected: string
): Promise<void> {
  await expect
    .poll(async () => (await input.inputValue()).replace(/\\/g, '/').toLowerCase(), {
      timeout: 30_000,
    })
    .toBe(expected.replace(/\\/g, '/').toLowerCase());
}

async function getReadyDevice(
  page: import('@playwright/test').Page
): Promise<{ id: string; workRoot: string }> {
  return page.evaluate(async (baseUrl) => {
    type DevicePayload = {
      id: string;
      status?: string;
      trusted?: boolean;
      workRoot?: string;
      workRootExists?: boolean;
      bridgeStatus?: string;
    };
    const response = await fetch(`${baseUrl}/api/devices`, { credentials: 'include' });
    if (!response.ok) throw new Error(`Failed to load devices: ${response.status}`);
    const json = (await response.json()) as { data?: DevicePayload[] };
    const devices = json.data ?? [];
    const ready =
      devices.find(
        (device) =>
          device.status === 'online' &&
          device.trusted &&
          device.workRoot &&
          device.workRootExists !== false &&
          device.bridgeStatus !== 'disconnected'
      ) ?? devices.find((device) => device.workRoot);
    if (!ready?.workRoot) throw new Error('No device with a workRoot was available.');
    return { id: ready.id, workRoot: ready.workRoot };
  }, apiBase);
}

test('Agent Workbench v2 mock UI renders the required workbench shell', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1');

  await expect(page.getByTestId('agent-workbench-v2')).toBeVisible();
  await expect(page.getByTestId('session-sidebar')).toBeVisible();
  await expect(page.getByTestId('session-status-bar')).toBeVisible();
  await expect(page.getByTestId('agent-timeline')).toBeVisible();
  await expect(page.getByTestId('inspector-panel')).toBeVisible();
  await expect(page.getByTestId('agent-stop-button')).toBeVisible();
  await expect(page.getByTestId('agent-composer-input')).toHaveCount(0);
  await expect(page.getByTestId('timeline-item-final_answer')).toBeVisible();
  await expect(page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Run build and verification' }).first()).toContainText('1 failed');
  await expect(page.getByTestId('composer-settings-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('header-device-select')).not.toBeVisible();
  await openComposerSettings(page);
  await expect(page.getByTestId('header-device-select')).toBeVisible();
  await expect(page.getByTestId('header-provider-select')).toBeVisible();
  await expect(page.getByTestId('header-model-select')).toHaveCount(0);
  await expect(page.getByTestId('header-reasoning-select')).toHaveCount(0);
  await expect(page.getByTestId('header-permission-select')).toHaveCount(0);

  await expect(page.getByTestId('mock-session')).toHaveCount(3);
  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Read project context' }).first().click();
  await expect(page.getByTestId('timeline-item-tool_call').first()).toBeVisible();
  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Run build and verification' }).first().click();
  await expect(page.getByTestId('timeline-item-command').first()).toBeVisible();
  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Apply and review changes' }).first().click();
  await expect(page.getByTestId('timeline-item-approval').first()).toBeVisible();
  await expect(page.getByTestId('timeline-item-file_diff').first()).toBeVisible();
  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Analyze failure' }).first().click();
  await expect(page.getByTestId('timeline-item-error').first()).toBeVisible();
  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Agent operations' }).first().click();
  await expect(page.getByTestId('timeline-item-checkpoint').first()).toBeVisible();
  await expect(page.getByTestId('message-code-block').first()).toContainText('<AgentTimeline />');
  await expect(page.getByTestId('message-copy-code').first()).toBeVisible();

  await expect(page.getByTestId('agent-timeline')).toBeVisible();
});

test('Agent Workbench v2 mock terminal remains unavailable', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1');

  await page.getByRole('button', { name: 'Remote TUI' }).click();
  const terminal = page.getByTestId('native-terminal-panel');
  await expect(terminal.getByText('Native terminal is unavailable in mock mode.')).toBeVisible();
  await expect(terminal.getByRole('button', { name: 'Attach' })).toBeDisabled();
  await expect(terminal.getByRole('button', { name: 'New' })).toBeDisabled();
});

test('Hermes-inspired shell renders workbench on desktop and mobile without overflow', async ({ page }) => {
  await login(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoApp(page, '/workbench?mock=1');
  await expect(page.getByTestId('agent-workbench-v2')).toBeVisible();
  const desktopShot = await page.screenshot();
  expect(desktopShot.length).toBeGreaterThan(1000);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 820 });
  await gotoApp(page, '/workbench?mock=1');
  await expect(page.getByTestId('agent-workbench-v2')).toBeVisible();
  const mobileShot = await page.screenshot();
  expect(mobileShot.length).toBeGreaterThan(1000);
  await expectNoHorizontalOverflow(page);
});

test('Agent Workbench v2 composer settings stay readable on narrow screens', async ({ page }) => {
  await login(page);

  await page.setViewportSize({ width: 960, height: 520 });
  await gotoApp(page, '/workbench?mock=1&deviceId=mock-device-1&projectPath=E%3A%5Cox');
  await expect(page.getByTestId('composer-settings-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('composer-model-menu-button')).toBeVisible();
  await expect(page.getByTestId('composer-permission-menu-button')).toBeVisible();
  await expect(page.getByTestId('composer-context-meter')).toBeVisible();
  await openComposerSettings(page);
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId('header-model-select')).toHaveCount(0);
  await expect(page.getByTestId('header-reasoning-select')).toHaveCount(0);
  await expect(page.getByTestId('header-permission-select')).toHaveCount(0);

  await page.getByTestId('composer-model-menu-button').click();
  await expect(page.getByTestId('composer-model-menu')).toBeVisible();
  await expect(page.getByTestId('composer-model-menu')).toContainText('Intelligence');
  await expect(page.getByTestId('composer-model-submenu')).toHaveCount(0);
  await expect(page.getByTestId('composer-speed-menu')).toHaveCount(0);
  await page.getByTestId('composer-model-submenu-button').click();
  await expect(page.getByTestId('composer-model-submenu')).toBeVisible();
  await page.getByTestId('composer-model-submenu-button').click();
  await expect(page.getByTestId('composer-model-submenu')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 820 });
  await gotoApp(page, '/workbench?mock=1&deviceId=mock-device-1&projectPath=E%3A%5Cox');
  await openComposerSettings(page);
  await expect(page.getByTestId('header-reasoning-select')).toHaveCount(0);
  await expect(page.getByTestId('header-permission-select')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test('Hermes-inspired secondary routes and theme persistence render', async ({ page }) => {
  await login(page);

  await gotoApp(page, '/devices');
  await expect(page.getByRole('heading', { name: /devices/i }).first()).toBeVisible();
  await page.getByLabel('Theme').selectOption('mono');
  await page.reload();
  await expect(page.getByLabel('Theme')).toHaveValue('mono');
  await page.getByLabel('Theme').selectOption('light');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--terminal-bg').trim().toLowerCase()))
    .toBe('#f8fafc');

  await gotoApp(page, '/history');
  await expect(page.getByRole('heading', { name: /run history/i }).first()).toBeVisible();

  await gotoApp(page, '/evals');
  await expect(page.getByRole('heading', { name: /evaluation comparison/i }).first()).toBeVisible();

  await gotoApp(page, '/control-plane');
  await expect(page.getByRole('heading', { name: /control plane/i }).first()).toBeVisible();
  await page.getByRole('tab', { name: /evals/i }).click();
  await expect(page.getByRole('link', { name: /evaluation dashboard/i })).toHaveAttribute('href', '/evals');

  await gotoApp(page, '/templates');
  await expect(page.getByRole('heading', { name: /templates/i }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('\uFFFD');

  await gotoApp(page, '/config');
  await expect(page.getByRole('heading', { name: /config/i }).first()).toBeVisible();

  await gotoApp(page, '/settings');
  await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 820 });
  await gotoApp(page, '/devices');
  await expect(page.locator('#app-sidebar')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#app-sidebar')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: /toggle menu/i }).first().click();
  await expect(page.locator('#app-sidebar')).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('link', { name: /workbench/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /run history/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /evaluations/i })).toHaveCount(0);
});

test('Login page renders the redesigned unauthenticated surface', async ({ page }) => {
  await gotoApp(page, '/login');
  await expect(page.getByRole('heading', { name: /remote agent console/i })).toBeVisible();
  await expect(page.getByLabel(/username/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test('Agent Workbench v2 honors workbench route parameters', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1&sessionId=session-completed');

  await expect(page.getByTestId('timeline-item-session_completed')).toBeVisible();
  await expect(page.getByTestId('inspector-panel').getByText('session-completed').first()).toBeVisible();

  await gotoApp(page, '/workbench?mock=1&deviceId=mock-device-2&projectPath=E%3A%5Cox%5Cscripts');

  await openComposerSettings(page);
  await expect(page.getByTestId('header-device-select')).toHaveValue('mock-device-2');
  await expect(page.getByTestId('header-project-path')).toHaveValue('E:\\ox\\scripts');
  const browseButton = page.getByRole('button', { name: 'Browse' });
  await browseButton.click();
  await page.getByRole('button', { name: /current directory/i }).click();
  await expect(browseButton).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('agent-timeline')).toContainText('Start a run to populate the agent timeline.');
});

test('Agent Workbench v2 collapses and formats command result messages', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1&sessionId=session-failed');

  const card = page.getByTestId('command-result-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('x3');
  await expect(card).toContainText('openaiDeveloperDocs');
  await expect(card.getByTestId('command-result-structured')).toHaveCount(0);

  await card.getByTestId('command-result-toggle').click();
  const structured = card.getByTestId('command-result-structured');
  await expect(structured).toContainText('auth_status');
  await expect(structured).toContainText('unsupported');
  await expect(card.getByTestId('command-result-raw')).toContainText('streamable_http');

  const metrics = await structured.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
    };
  });
  expect(metrics.maxHeight).not.toBe('none');
  expect(metrics.overflowY).toBe('auto');
});

test('Agent Workbench v2 keeps the timeline position when composer settings change', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1280, height: 560 });
  await gotoApp(page, '/workbench?mock=1');

  const timeline = page.getByTestId('agent-timeline');
  await expect(timeline).toBeVisible();
  await expect(page.getByTestId('timeline-item-final_answer')).toBeVisible();

  const metrics = await timeline.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.clientHeight).toBeGreaterThan(0);
  expect(metrics.scrollHeight).toBeGreaterThan(0);

  await timeline.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBe(0);

  await openComposerSettings(page);
  await openComposerAdvancedOptions(page);
  await page.getByTestId('runtime-extra-dirs-input').fill('E:\\ox\\scripts');
  await expect(page.getByText('Runtime options updated.')).toBeVisible({ timeout: 3_000 });

  const scrollTopAfterSave = await timeline.evaluate((element) => element.scrollTop);
  expect(scrollTopAfterSave).toBeLessThan(40);
});

test('Agent Workbench v2 keeps non-terminal command errors from failing the session', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1&sessionId=session-completed');

  const statusBar = page.getByTestId('session-status-bar');
  await expect(statusBar).toContainText('completed');

  await page.getByTestId('agent-composer-input').fill('/definitely-missing-command');
  await page.getByTestId('agent-composer-input').press('Enter');

  await expect(page.getByTestId('inspector-panel').getByText('Unknown command "/definitely-missing-command". Use /help.')).toBeVisible();
  await expect(statusBar).toContainText('completed');
  await expect(statusBar).not.toContainText('failed');
});

test('Agent Workbench v2 mode and reasoning effort controls create the intended mock session', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1&deviceId=mock-device-1&projectPath=E%3A%5Cox');
  await openComposerSettings(page);

  const provider = page.getByTestId('header-provider-select');

  await provider.selectOption('codex');
  await selectComposerPermission(page, /Default/);
  await page.getByTestId('composer-model-menu-button').click();
  const codexMenu = page.getByTestId('composer-model-menu');
  await expect(codexMenu.getByRole('menuitemradio', { name: 'Low' })).toBeVisible();
  await expect(codexMenu.getByRole('menuitemradio', { name: 'Minimal' })).toHaveCount(0);
  await expect(codexMenu.getByRole('menuitemradio', { name: 'Max' })).toHaveCount(0);
  await expect(page.getByTestId('composer-model-menu-button').locator('svg')).toHaveCount(1);
  await codexMenu.getByTestId('composer-speed-submenu-button').click();
  await expect(page.getByTestId('composer-speed-menu').getByRole('menuitemradio', { name: 'Fast' })).toBeVisible();
  await page.keyboard.press('Escape');
  await selectComposerSpeed(page, 'Fast');
  await expect(page.getByTestId('session-status-bar')).toContainText('Fast: on');
  await expect(page.getByTestId('composer-model-menu-button').locator('svg')).toHaveCount(2);
  await selectComposerEffort(page, 'Extra High');
  await expect(page.getByTestId('session-status-bar')).toContainText('Reasoning effort: xhigh');

  await provider.selectOption('claude-code');
  await selectComposerEffort(page, 'Max');
  await provider.selectOption('codex');
  await expect(page.getByTestId('session-status-bar')).toContainText('Reasoning effort: medium');

  await provider.selectOption('mock');
  await selectComposerModel(page, 'Mock Fast');
  await page.getByTestId('composer-model-menu-button').click();
  await expect(page.getByTestId('composer-model-menu').getByRole('menuitemradio', { name: 'High' })).toHaveCount(0);
  await expect(page.getByTestId('composer-speed-submenu-button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await selectComposerModel(page, 'GPT-5.3 Codex');
  await selectComposerEffort(page, 'High');

  await page.getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByTestId('composer-permission-menu-button')).toBeDisabled();
  await expect(page.getByTestId('composer-permission-menu-button')).toContainText('Read Only');
  await page.getByTestId('agent-composer-input').fill('Sketch a read-only implementation plan');
  await page.getByTestId('agent-send-button').click();

  await expect(page.getByTestId('composer-model-menu-button')).toContainText('High');
  await expect(page.getByTestId('composer-permission-menu-button')).toContainText('Read Only');
  await expect(page.getByTestId('agent-timeline').getByText('Sketch a read-only implementation plan')).toBeVisible();
});

test('Agent Workbench v2 inspector, approval, slash menu, and composer interactions work locally', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1');

  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Run build and verification' }).first().click();
  await page.getByTestId('timeline-item-command').first().click();
  await expect(page.getByTestId('inspector-tab-commands')).toHaveCount(0);
  const commandRow = page.getByTestId('timeline-item-command').first();
  await expect(commandRow.getByTestId('command-summary-command')).toContainText('pnpm typecheck:web');
  await expect(page.getByTestId('inspector-panel').getByText('TypeScript project graph loaded')).toHaveCount(0);
  await expect(page.getByTestId('agent-timeline').getByText('TypeScript project graph loaded')).toBeVisible();

  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Read project context' }).first().click();
  await page.getByTestId('timeline-item-tool_call').first().click();
  await expect(page.getByTestId('inspector-tab-context')).toHaveCount(0);
  await expect(page.getByTestId('inspector-panel').getByText('Latest Activity')).toHaveCount(0);

  await page.getByTestId('tool-activity-group-toggle').filter({ hasText: 'Apply and review changes' }).first().click();
  await page.getByTestId('timeline-item-file_diff').first().click();
  await expect(page.getByTestId('inspector-tab-diff')).toHaveClass(/bg-accent/);
  await expect(page.getByTestId('inspector-panel').getByText('AgentTimeline.tsx').first()).toBeVisible();
  await expect(page.getByTestId('inspector-panel').getByText('diff --git')).toBeVisible();
  await expect(page.getByTestId('file-current-content')).toContainText('AgentTimeline');
  await page.getByRole('button', { name: 'Split' }).click();
  await expect(page.getByTestId('inspector-panel').getByText('AgentTimeline.tsx').first()).toBeVisible();
  await page.getByRole('button', { name: 'Unified' }).click();
  await expect(page.getByTestId('inspector-panel').getByText('diff --git')).toBeVisible();

  await page.getByTestId('timeline-item-approval').first().click();
  await expect(page.getByTestId('inspector-tab-approvals')).toHaveClass(/bg-accent/);
  await page.getByTestId('approval-approve').click();
  await expect(page.getByTestId('inspector-panel').getByText('approved').first()).toBeVisible();
  const patchGroup = page.getByTestId('tool-activity-group-toggle')
    .filter({ hasText: 'Apply and review changes' })
    .filter({ hasText: '1 activity' });
  await expect(patchGroup).toBeVisible({ timeout: 5_000 });
  await patchGroup.click();
  await expect(page.getByTestId('timeline-item-patch_applied').first()).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('agent-composer-input')).toBeVisible({ timeout: 5_000 });

  const input = page.getByTestId('agent-composer-input');
  await input.fill('/re');
  await expect(page.getByTestId('slash-command-menu')).toBeVisible();
  await input.press('Escape');
  await expect(page.getByTestId('slash-command-menu')).toBeHidden();

  await input.fill('');
  await expect(page.getByTestId('file-ref-chip')).toHaveCount(0);
  page.once('dialog', async (dialog) => {
    await dialog.accept('packages/shared/src/types/agent-event.ts');
  });
  await page.getByTestId('attach-file-button').click();
  await expect(page.getByTestId('file-ref-chip')).toContainText('@packages/shared/src/types/agent-event.ts');
  await expect(input).toHaveValue('@packages/shared/src/types/agent-event.ts');
  await page.getByTestId('remove-file-ref').click();
  await expect(page.getByTestId('file-ref-chip')).toHaveCount(0);
  await expect(input).toHaveValue('');

  await input.fill('Stop this run before it completes');
  await input.press('Enter');
  await expect(page.getByTestId('agent-stop-button')).toBeVisible();
  await page.getByTestId('agent-stop-button').click();
  await expect(page.getByTestId('session-status-bar')).toContainText('cancelled');
  await expect(page.getByTestId('agent-stop-button')).toHaveCount(0);
  await expect(page.getByTestId('agent-send-button')).toBeVisible();

  await input.fill('Add focused tests for event cards');
  await input.press('Enter');
  await expect(page.getByTestId('agent-timeline').getByText('Add focused tests for event cards')).toBeVisible();
  const verificationGroups = page
    .getByTestId('timeline-item-activity_group')
    .filter({ hasText: 'Run build and verification' });
  await expect.poll(async () => verificationGroups.count(), { timeout: 15_000 }).toBeGreaterThan(1);
  const latestVerificationGroup = verificationGroups.last();
  await latestVerificationGroup.getByTestId('tool-activity-group-toggle').click();
  const newCommandRow = latestVerificationGroup.getByTestId('timeline-item-command').last();
  await expect(newCommandRow).toBeVisible();
  await expect(newCommandRow.getByTestId('command-summary-command')).toContainText('pnpm typecheck:web', { timeout: 5_000 });
  await expect(page.getByTestId('agent-timeline').getByText('Mock typecheck finished without errors.')).toHaveCount(0);
  await newCommandRow.click();
  await expect(page.getByTestId('agent-timeline').getByText('completed.', { exact: true }).first()).toBeVisible();

  await page.getByText('Review command streaming card').click();
  await expect(page.getByTestId('timeline-item-session_completed')).toBeVisible();
});

test('Agent Workbench v2 product inspector actions work with the mock adapter', async ({ page }) => {
  await login(page);
  await gotoApp(page, '/workbench?mock=1');

  await page.getByTestId('inspector-tab-files').click();
  await expect(page.getByTestId('inspector-panel').getByText(/changed files/)).toBeVisible();
  await page.getByTestId('diff-refresh').click();
  await page.getByTestId('inspector-tab-diff').click();
  await expect(page.getByTestId('inspector-panel').getByText('diff --git')).toBeVisible();

  await page.getByTestId('inspector-tab-approvals').click();
  await page.getByTestId('permission-rule-pattern').fill('pnpm test:e2e:workbench');
  await page.getByTestId('permission-rule-add').click();
  await expect(page.getByTestId('inspector-panel').getByText('pnpm test:e2e:workbench')).toBeVisible();

  await page.getByTestId('inspector-tab-actions').click();
  await expect(page.getByTestId('context-used-count')).toBeVisible();
  await page.getByTestId('context-permissions-open').click();
  await expect(page.getByTestId('inspector-tab-approvals')).toHaveClass(/bg-accent/);
  await page.getByTestId('inspector-tab-actions').click();
  await page.getByTestId('compact-session').click();
  await expect(page.getByTestId('inspector-panel').getByText('Mock compact summary saved from the current Agent Workbench context.').first()).toBeVisible();
  await expect(page.getByTestId('context-summary-used').first()).toBeVisible();
  await page.getByTestId('export-copy-markdown').click();
  await expect(page.getByText(/Export ready:/)).toBeVisible();
  await page.getByTestId('init-claude-plan').click();
  await expect(page.getByTestId('inspector-panel').getByText('CLAUDE.md')).toBeVisible();
});

test('Agent Workbench v2 real adapter loads the protected workbench route', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  const readyDevice = await getReadyDevice(page);
  const routeParams = new URLSearchParams({
    deviceId: readyDevice.id,
    projectPath: readyDevice.workRoot,
  });
  await gotoApp(page, `/workbench?${routeParams.toString()}`);

  await expect(page.getByTestId('agent-workbench-v2')).toBeVisible();
  await expect(page.getByTestId('session-sidebar')).toBeVisible();
  await expect(page.getByTestId('session-status-bar')).toBeVisible();
  await expect(page.getByTestId('agent-timeline')).toBeVisible();
  await expect(page.getByTestId('inspector-panel')).toBeVisible();
  await openComposerSettings(page);
  await openComposerAdvancedOptions(page);
  await expect(page.getByTestId('header-provider-select')).toBeVisible();
  await expect(page.getByText(/stream:/i)).toBeVisible();
  const expectedProjectPath = readyDevice.workRoot;
  const projectPathInput = page.getByTestId('header-project-path');
  if (expectedProjectPath) {
    await expectPathValue(projectPathInput, expectedProjectPath);
  } else {
    await expect(projectPathInput).not.toHaveValue('', { timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'New' }).click();
  if (expectedProjectPath) {
    await expectPathValue(projectPathInput, expectedProjectPath);
  }
});

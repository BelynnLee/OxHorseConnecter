import { expect, test } from '@playwright/test';

const username = process.env.E2E_ADMIN_USERNAME ?? 'admin';
const password = process.env.E2E_ADMIN_PASSWORD ?? 'WorkbenchE2EPassword-2026!';
const apiBase = `http://127.0.0.1:${process.env.E2E_HOST_PORT ?? '3201'}`;

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const usernameInput = page.getByLabel(/username/i);
  const passwordInput = page.getByLabel(/password/i);
  const signInButton = page.getByRole('button', { name: /sign in/i });
  await expect(usernameInput).toBeVisible({ timeout: 30_000 });
  await expect(passwordInput).toBeVisible();
  await expect(signInButton).toBeEnabled();
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await signInButton.click();
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

const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { openShop, addProduct, fillCheckout, submitOrder, register, logout } = require('./helpers');

test.beforeEach(async ({ page }) => openShop(page));

test('BUG-01 Нулевое количество товара должно отклоняться API', async ({ page }) => {
  const response = await page.request.post('/api/cart/items', { data: { productId: 1, qty: 0 } });
  const cart = await (await page.request.get('/api/cart')).json();
  await test.info().attach('response', { body: JSON.stringify({ status: response.status(), cart }, null, 2), contentType: 'application/json' });
  test.fail(true, 'BUG-01: qty=0 преобразуется в 1 выражением qty || 1.');
  expect(response.status()).toBe(400);
});

test('BUG-02 Заказ должен отклонять телефон из двух цифр и пробелов', async ({ page }) => {
  await addProduct(page, 1);
  await fillCheckout(page);
  await page.getByLabel('Телефон', { exact: true }).fill('1         1');
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  // Ждём завершения запроса, а затем проверяем требуемое поведение.
  await expect(page.getByTestId('order-success').or(page.getByRole('alert'))).toBeVisible();
  test.fail(true, 'BUG-02: regex проверяет длину строки, но не число цифр.');
  await expect(page.locator('[data-field="phone"]')).toBeVisible();
});

test('BUG-03 Второй аккаунт не должен видеть заказ первого в той же браузерной сессии', async ({ page }) => {
  await register(page, `owner-${randomUUID()}@example.com`);
  await addProduct(page, 1);
  await fillCheckout(page, 'courier');
  const order = await submitOrder(page);
  const owner = order.userId;
  await logout(page);
  await register(page, `other-${randomUUID()}@example.com`);
  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.user.id).not.toBe(owner);
  const response = await page.request.get(`/api/orders/${order.id}`);
  await test.info().attach('response', { body: JSON.stringify({ status: response.status(), body: await response.json() }, null, 2), contentType: 'application/json' });
  test.fail(true, 'BUG-03: доступ предоставляется по старому sid даже другому авторизованному пользователю.');
  expect(response.status()).toBe(404);
});

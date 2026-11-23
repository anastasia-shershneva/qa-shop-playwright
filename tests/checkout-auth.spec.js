const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { openShop, addProduct, fillCheckout, submitOrder, register, logout } = require('./helpers');

test.beforeEach(async ({ page }) => openShop(page));

test('ORDER-01 Гостевой заказ с самовывозом очищает корзину и уменьшает остаток', async ({ page }) => {
  const before = await (await page.request.get('/api/products/1')).json();
  await addProduct(page, 1);
  await fillCheckout(page);
  await expect(page.getByTestId('shipping')).toHaveText('бесплатно');
  const order = await submitOrder(page);
  expect(order.total).toBe(890);
  expect(order.userId).toBeNull();
  await expect(page.getByTestId('cart-count')).toHaveText('0');
  const after = await (await page.request.get('/api/products/1')).json();
  expect(after.stock).toBe(before.stock - 1);
});

test('ORDER-02 Курьерская доставка добавляет 300 рублей', async ({ page }) => {
  await addProduct(page, 1);
  await fillCheckout(page, 'courier');
  await expect(page.getByTestId('shipping')).toHaveText('300 ₽');
  await expect(page.getByTestId('total')).toHaveText('1 190 ₽');
  const order = await submitOrder(page);
  expect(order.shipping).toBe(300);
  expect(order.total).toBe(1190);
});

test('ORDER-03 Бесплатная доставка на границе 3000 рублей', async ({ page }) => {
  await addProduct(page, 4);
  await addProduct(page, 9);
  await addProduct(page, 10);
  await addProduct(page, 13);
  await fillCheckout(page, 'courier');
  await expect(page.getByTestId('subtotal')).toHaveText('3 000 ₽');
  await expect(page.getByTestId('shipping')).toHaveText('бесплатно');
});

test('ORDER-04 Порог бесплатной доставки считается после скидки', async ({ page }) => {
  await addProduct(page, 15);
  expect((await page.request.post('/api/cart/promo', { data: { code: 'WELCOME500' } })).ok()).toBeTruthy();
  await fillCheckout(page, 'courier');
  await expect(page.getByTestId('subtotal')).toHaveText('3 490 ₽');
  await expect(page.getByTestId('discount')).toHaveText('−500 ₽');
  await expect(page.getByTestId('shipping')).toHaveText('300 ₽');
  await expect(page.getByTestId('total')).toHaveText('3 290 ₽');
});

test('ORDER-05 Пустые поля показывают ошибки без создания заказа', async ({ page }) => {
  await addProduct(page, 1);
  await page.goto('/#/checkout');
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Проверьте поля формы');
  await expect(page.locator('[data-field="name"]')).toHaveText('Укажите имя получателя');
  await expect(page.locator('[data-field="phone"]')).toBeVisible();
  await expect(page.locator('[data-field="address"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подтвердить заказ', exact: true })).toBeEnabled();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
});

test('ORDER-06 Пустая корзина перенаправляет с оформления в корзину', async ({ page }) => {
  await page.goto('/#/checkout');
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await expect(page).toHaveURL(/#\/cart$/);
});

test('AUTH-01 Регистрация, выход, вход и сохранение авторизации после перезагрузки', async ({ page }) => {
  const email = `qa-${randomUUID()}@example.com`;
  await register(page, email);
  await logout(page);
  await page.locator('#nav-login').click();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('Test-password-456');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
});

test('AUTH-02 Ошибки регистрации при невалидных данных', async ({ page }) => {
  await page.goto('/#/register');
  await page.getByLabel('Имя', { exact: true }).fill('А');
  await page.getByLabel('E-mail', { exact: true }).fill('invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('12345');
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page.locator('[data-field="name"]')).toBeVisible();
  await expect(page.locator('[data-field="email"]')).toBeVisible();
  await expect(page.locator('[data-field="password"]')).toHaveText('Пароль должен быть не короче 6 символов');
});

test('AUTH-03 Повторная регистрация и неверный пароль отклоняются', async ({ page }) => {
  const email = `qa-${randomUUID()}@example.com`;
  await register(page, email);
  await logout(page);
  await page.goto('/#/register');
  await page.getByLabel('Имя', { exact: true }).fill('Другой покупатель');
  await page.getByLabel('E-mail', { exact: true }).fill(email.toUpperCase());
  await page.getByLabel('Пароль', { exact: true }).fill('Another-password');
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await expect(page.locator('[data-field="email"]')).toHaveText('E-mail уже занят');
  await page.goto('/#/login');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('Wrong-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный e-mail или пароль');
});

test('AUTH-04 Заказ авторизованного пользователя отображается в истории', async ({ page }) => {
  await register(page, `qa-${randomUUID()}@example.com`);
  await addProduct(page, 1);
  await fillCheckout(page);
  const order = await submitOrder(page);
  test.fail(test.info().project.name === 'mobile-chromium', 'BUG-04: меню с историей заказов скрыто на мобильной ширине.');
  await expect(page.getByRole('link', { name: 'Мои заказы', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Мои заказы', exact: true }).click();
  await expect(page.getByTestId('order-row')).toHaveCount(1);
  await page.getByRole('link', { name: `№${order.id}`, exact: true }).click();
  await expect(page.getByTestId('order-id')).toHaveText(String(order.id));
});

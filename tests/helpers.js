const { expect } = require('@playwright/test');

async function openShop(page) {
  if (!process.env.BASE_URL) {
    const reset = await page.request.post('/api/test/reset');
    expect(reset.ok()).toBeTruthy();
  }
  // Устанавливаем сессию до параллельных запросов инициализации интерфейса.
  const health = await page.request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  await page.goto('/');
  await expect(page.getByTestId('product-card')).toHaveCount(16);
}

async function addProduct(page, productId, qty = 1) {
  await page.goto(`/#/product/${productId}`);
  await expect(page.getByTestId('product-page')).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Количество', exact: true }).fill(String(qty));
  const added = page.waitForResponse(response =>
    response.url().endsWith('/api/cart/items') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Добавить в корзину', exact: true }).click();
  expect((await added).status()).toBe(201);
}

async function openCart(page) {
  await page.goto('/#/cart');
  await expect(page.getByTestId('cart-table')).toBeVisible();
}

async function register(page, email) {
  await page.goto('/#/register');
  await page.getByLabel('Имя', { exact: true }).fill('Тестовый покупатель');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill('Test-password-456');
  const response = page.waitForResponse(r =>
    r.url().endsWith('/api/auth/register') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page.locator('#user-name')).toHaveText('Тестовый покупатель');
  await expect(page.locator('#user-name')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible();
}

async function fillCheckout(page, delivery = 'pickup') {
  await page.goto('/#/checkout');
  await page.getByLabel('Имя получателя', { exact: true }).fill('Тестовый покупатель');
  await page.getByLabel('Телефон', { exact: true }).fill('+79000000000');
  await page.getByRole('radio', { name: delivery === 'pickup' ? 'Самовывоз' : 'Курьером', exact: true }).check();
  if (delivery === 'courier') {
    await page.getByLabel('Адрес доставки', { exact: true }).fill('Тестовая улица, дом 1');
  }
}

async function logout(page) {
  const response = page.waitForResponse(r =>
    r.url().endsWith('/api/auth/logout') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  expect((await response).ok()).toBeTruthy();
  await expect(page.locator('#nav-logout')).toHaveAttribute('hidden', '');
  await expect(page.locator('#user-name')).toHaveAttribute('hidden', '');
  const me = await (await page.request.get('/api/auth/me')).json();
  expect(me.user).toBeNull();
  await expect(page.getByRole('heading', { name: 'Каталог', exact: true })).toBeVisible();
}

async function submitOrder(page) {
  const completed = page.waitForResponse(response =>
    response.url().endsWith('/api/orders') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Подтвердить заказ', exact: true }).click();
  const response = await completed;
  expect(response.status()).toBe(201);
  const order = await response.json();
  await expect(page.getByTestId('order-success')).toBeVisible();
  return order;
}

module.exports = { openShop, addProduct, openCart, register, logout, fillCheckout, submitOrder };

const { test, expect } = require('@playwright/test');
const { openShop, addProduct, openCart } = require('./helpers');

test.beforeEach(async ({ page }) => openShop(page));

test('CART-01 Добавление разных товаров и расчёт суммы', async ({ page }) => {
  await addProduct(page, 1, 2);
  await addProduct(page, 5, 1);
  await openCart(page);
  await expect(page.getByTestId('cart-row')).toHaveCount(2);
  await expect(page.getByTestId('subtotal')).toHaveText('2 260 ₽');
  await expect(page.getByTestId('cart-count')).toHaveText('3');
});

test('CART-02 Изменение количества кнопками и пересчёт суммы', async ({ page }) => {
  await addProduct(page, 1);
  await openCart(page);
  await page.getByRole('button', { name: 'Увеличить количество', exact: true }).click();
  await expect(page.getByTestId('subtotal')).toHaveText('1 780 ₽');
  await page.getByRole('button', { name: 'Уменьшить количество', exact: true }).click();
  await expect(page.getByTestId('subtotal')).toHaveText('890 ₽');
});

test('CART-03 Удаление последнего товара', async ({ page }) => {
  await addProduct(page, 1);
  await openCart(page);
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByTestId('cart-empty')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('0');
});

test('CART-04 Очистка корзины с несколькими товарами', async ({ page }) => {
  await addProduct(page, 1);
  await addProduct(page, 5);
  await openCart(page);
  await page.getByRole('button', { name: 'Очистить корзину', exact: true }).click();
  await expect(page.getByTestId('cart-empty')).toBeVisible();
});

test('CART-05 Корзина сохраняется после перезагрузки', async ({ page }) => {
  await addProduct(page, 1, 2);
  await openCart(page);
  await page.reload();
  await expect(page.getByTestId('cart-row')).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: 'Количество', exact: true })).toHaveValue('2');
});

test('CART-06 Добавление сверх остатка отклоняется', async ({ page }) => {
  const product = await (await page.request.get('/api/products/1')).json();
  await page.goto('/#/product/1');
  await page.getByRole('spinbutton', { name: 'Количество', exact: true }).fill(String(product.stock + 1));
  await page.getByRole('button', { name: 'Добавить в корзину', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(`В наличии только ${product.stock} шт.`);
  await expect(page.getByTestId('cart-count')).toHaveText('0');
});

test('PROMO-01 SALE10 применяет скидку 10 процентов', async ({ page }) => {
  await addProduct(page, 1, 2);
  await openCart(page);
  await page.getByRole('textbox', { name: 'Промокод', exact: true }).fill(' sale10 ');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByTestId('discount')).toHaveText('−178 ₽');
  await expect(page.getByTestId('total')).toHaveText('1 602 ₽');
});

test('PROMO-02 WELCOME500 работает на границе 2000 рублей', async ({ page }) => {
  await addProduct(page, 16);
  await openCart(page);
  await page.getByRole('textbox', { name: 'Промокод', exact: true }).fill('WELCOME500');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByTestId('discount')).toHaveText('−500 ₽');
  await expect(page.getByTestId('total')).toHaveText('1 500 ₽');
});

test('PROMO-03 WELCOME500 отклоняется ниже минимальной суммы', async ({ page }) => {
  await addProduct(page, 1, 2);
  await openCart(page);
  await page.getByRole('textbox', { name: 'Промокод', exact: true }).fill('WELCOME500');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Промокод действует при заказе от 2000 ₽');
  await expect(page.getByTestId('discount')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText('1 780 ₽');
});

test('PROMO-04 Неизвестный промокод отклоняется', async ({ page }) => {
  await addProduct(page, 1);
  await openCart(page);
  await page.getByRole('textbox', { name: 'Промокод', exact: true }).fill('UNKNOWN');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Промокод не найден');
  await expect(page.getByTestId('total')).toHaveText('890 ₽');
});

test('PROMO-05 Пустой промокод отменяет применённую скидку', async ({ page }) => {
  await addProduct(page, 1);
  await openCart(page);
  await page.getByRole('textbox', { name: 'Промокод', exact: true }).fill('SALE10');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByTestId('discount')).toBeVisible();
  await page.getByRole('textbox', { name: 'Промокод', exact: true }).fill('');
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByTestId('discount')).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText('890 ₽');
});

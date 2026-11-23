const { test, expect } = require('@playwright/test');
const { openShop } = require('./helpers');

test.beforeEach(async ({ page }) => openShop(page));

test('CAT-01 Каталог содержит исходные товары, карточка показывает описание и цену', async ({ page }) => {
  await page.getByRole('link', { name: 'Кофе Эфиопия Иргачефф, 250 г', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Кофе Эфиопия Иргачефф, 250 г' })).toBeVisible();
  await expect(page.getByTestId('product-price')).toHaveText('890 ₽');
  await expect(page.getByTestId('product-page')).toContainText('В наличии:');
});

test('CAT-02 Поиск по названию без учёта регистра', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('  КОФЕ ЭФИОПИЯ ИРГАЧЕФФ  ');
  await expect(page.getByTestId('product-card')).toHaveCount(1);
  await expect(page.getByTestId('product-card')).toContainText('Кофе Эфиопия');
});

test('CAT-03 Поиск по описанию товара', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('бергамота');
  await expect(page.getByTestId('product-card')).toHaveCount(1);
  await expect(page.getByTestId('product-card')).toContainText('Иргачефф');
});

test('CAT-04 Пустая выдача и восстановление после очистки запроса', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('несуществующий-товар-987');
  await expect(page.getByTestId('empty-list')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('');
  await expect(page.getByTestId('product-card')).toHaveCount(16);
});

test('CAT-05 Фильтр категории совместно с поиском', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Категория', exact: true }).selectOption('tea');
  await expect(page.getByTestId('product-card')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('Ассам');
  await expect(page.getByTestId('product-card')).toHaveCount(1);
  await expect(page.getByTestId('product-card')).toContainText('Чай Ассам');
});

for (const [sort, descending] of [['price_asc', false], ['price_desc', true]]) {
  test(`CAT-06 Сортировка по цене ${sort}`, async ({ page }) => {
    const response = page.waitForResponse(r => r.url().includes(`sort=${sort}`));
    await page.getByRole('combobox', { name: 'Сортировка', exact: true }).selectOption(sort);
    await response;
    await expect.poll(async () => {
      const texts = await page.getByTestId('product-card').locator('.price').allTextContents();
      const prices = texts.map(text => Number(text.replace(/\D/g, '')));
      return prices.every((price, i) => i === 0 || (descending ? prices[i - 1] >= price : prices[i - 1] <= price));
    }).toBe(true);
  });
}

test('CAT-07 Товар без остатка нельзя добавить из каталога и карточки', async ({ page }) => {
  const product = page.getByTestId('product-card').filter({ hasText: 'Кофе Колумбия без кофеина' });
  await expect(product.getByRole('button', { name: 'В корзину', exact: true })).toBeDisabled();
  await product.getByRole('link', { name: 'Кофе Колумбия без кофеина, 250 г', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Добавить в корзину', exact: true })).toBeDisabled();
});

test('CAT-08 Неизвестный товар показывает страницу ошибки', async ({ page }) => {
  await page.goto('/#/product/999999');
  await expect(page.getByRole('heading', { name: 'Товар не найден', exact: true })).toBeVisible();
});

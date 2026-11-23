(function () {
  'use strict';

  const $app = document.getElementById('app');
  const state = { user: null, categories: [], filters: { search: '', category: '', sort: '' } };

  // ---------- утилиты ----------

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rub = (n) => Number(n).toLocaleString('ru-RU') + ' ₽';
  const fmtDate = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* пустой ответ */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Ошибка запроса');
      err.status = res.status;
      err.fields = (data && data.fields) || {};
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(message, isError) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }

  function setCartCount(n) {
    document.getElementById('cart-count').textContent = n;
  }

  function renderHeader() {
    const logged = !!state.user;
    document.getElementById('nav-login').hidden = logged;
    document.getElementById('nav-logout').hidden = !logged;
    document.getElementById('nav-orders').hidden = !logged;
    const name = document.getElementById('user-name');
    name.hidden = !logged;
    name.textContent = logged ? state.user.name : '';
  }

  function showFieldErrors(form, fields) {
    form.querySelectorAll('.field-error').forEach((el) => el.remove());
    Object.entries(fields || {}).forEach(([key, text]) => {
      const input = form.querySelector(`[name="${key}"]`);
      if (!input) return;
      const holder = input.closest('label, fieldset') || input.parentElement;
      const span = document.createElement('span');
      span.className = 'field-error';
      span.dataset.field = key;
      span.textContent = text;
      holder.appendChild(span);
    });
  }

  function showFormError(form, message) {
    const box = form.querySelector('.form-error');
    box.textContent = message || '';
    box.hidden = !message;
  }

  const stockLabel = (p) => (p.stock > 0 ? `<span class="in">В наличии: ${p.stock} шт.</span>` : '<span class="out">Нет в наличии</span>');

  // ---------- страницы ----------

  async function pageCatalog() {
    if (!state.categories.length) state.categories = await api('GET', '/api/categories');
    const f = state.filters;
    $app.innerHTML = `
      <h1>Каталог</h1>
      <form class="filters" id="filters" role="search">
        <input type="search" name="search" placeholder="Поиск по названию и описанию" aria-label="Поиск" value="${esc(f.search)}">
        <select name="category" aria-label="Категория">
          <option value="">Все категории</option>
          ${state.categories.map((c) => `<option value="${c.id}" ${f.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
        <select name="sort" aria-label="Сортировка">
          <option value="">По умолчанию</option>
          <option value="price_asc" ${f.sort === 'price_asc' ? 'selected' : ''}>Сначала дешёвые</option>
          <option value="price_desc" ${f.sort === 'price_desc' ? 'selected' : ''}>Сначала дорогие</option>
          <option value="name" ${f.sort === 'name' ? 'selected' : ''}>По названию</option>
        </select>
      </form>
      <div id="products" class="grid" data-testid="product-list"></div>`;

    const form = document.getElementById('filters');
    const list = document.getElementById('products');

    async function load() {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
      const products = await api('GET', '/api/products' + (qs ? '?' + qs : ''));
      if (!products.length) {
        list.className = '';
        list.innerHTML = '<div class="empty" data-testid="empty-list">Ничего не найдено. Попробуйте изменить запрос.</div>';
        return;
      }
      list.className = 'grid';
      list.innerHTML = products.map((p) => `
        <article class="card" data-testid="product-card" data-id="${p.id}">
          <a class="card__icon" href="#/product/${p.id}" aria-hidden="true" tabindex="-1">${p.icon}</a>
          <a class="card__name" href="#/product/${p.id}">${esc(p.name)}</a>
          ${stockLabel(p)}
          <div class="card__row">
            <span class="price">${rub(p.price)}</span>
            <button type="button" data-add="${p.id}" ${p.stock > 0 ? '' : 'disabled'}>В корзину</button>
          </div>
        </article>`).join('');
    }

    let timer;
    form.addEventListener('input', () => {
      const data = new FormData(form);
      f.search = data.get('search').trim();
      f.category = data.get('category');
      f.sort = data.get('sort');
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    });
    form.addEventListener('submit', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-add]');
      if (btn) addToCart(Number(btn.dataset.add), 1);
    });
    await load();
  }

  async function addToCart(productId, qty) {
    try {
      const cart = await api('POST', '/api/cart/items', { productId, qty });
      setCartCount(cart.count);
      toast('Товар добавлен в корзину');
    } catch (e) {
      toast(e.message, true);
    }
  }

  async function pageProduct(id) {
    let p;
    try {
      p = await api('GET', '/api/products/' + encodeURIComponent(id));
    } catch (e) {
      $app.innerHTML = '<h1>Товар не найден</h1><p><a href="#/">Вернуться в каталог</a></p>';
      return;
    }
    const cat = state.categories.find((c) => c.id === p.category);
    $app.innerHTML = `
      <p><a href="#/">← Каталог</a></p>
      <section class="product" data-testid="product-page">
        <div class="product__icon" aria-hidden="true">${p.icon}</div>
        <div>
          <h1>${esc(p.name)}</h1>
          <p class="muted">${cat ? esc(cat.name) : ''}</p>
          <p>${esc(p.description)}</p>
          <p class="price" data-testid="product-price">${rub(p.price)}</p>
          <p>${stockLabel(p)}</p>
          <div class="card__row" style="justify-content:flex-start;gap:16px">
            <span class="qty">
              <button type="button" class="secondary" id="qty-minus" aria-label="Уменьшить количество">−</button>
              <input type="number" id="qty" min="1" max="${p.stock}" value="1" aria-label="Количество">
              <button type="button" class="secondary" id="qty-plus" aria-label="Увеличить количество">+</button>
            </span>
            <button type="button" id="add" ${p.stock > 0 ? '' : 'disabled'}>Добавить в корзину</button>
          </div>
        </div>
      </section>`;
    const qty = document.getElementById('qty');
    document.getElementById('qty-minus').onclick = () => { qty.value = Math.max(1, Number(qty.value) - 1); };
    document.getElementById('qty-plus').onclick = () => { qty.value = Number(qty.value) + 1; };
    document.getElementById('add').onclick = () => addToCart(p.id, Number(qty.value));
  }

  function summaryHtml(cart, shipping) {
    return `
      <div class="summary__row"><span>Товары</span><span data-testid="subtotal">${rub(cart.subtotal)}</span></div>
      ${cart.discount ? `<div class="summary__row"><span>Скидка${cart.promo ? ' (' + esc(cart.promo.code) + ')' : ''}</span><span data-testid="discount">−${rub(cart.discount)}</span></div>` : ''}
      ${shipping == null ? '' : `<div class="summary__row"><span>Доставка</span><span data-testid="shipping">${shipping ? rub(shipping) : 'бесплатно'}</span></div>`}
      <div class="summary__row summary__total"><span>Итого</span><span data-testid="total">${rub(cart.total + (shipping || 0))}</span></div>`;
  }

  async function pageCart() {
    const cart = await api('GET', '/api/cart');
    setCartCount(cart.count);
    if (!cart.items.length) {
      $app.innerHTML = '<h1>Корзина</h1><div class="empty" data-testid="cart-empty">В корзине пока пусто. <a href="#/">Перейти в каталог</a></div>';
      return;
    }
    $app.innerHTML = `
      <h1>Корзина</h1>
      <table data-testid="cart-table">
        <thead><tr><th>Товар</th><th class="num">Цена</th><th>Количество</th><th class="num">Сумма</th><th></th></tr></thead>
        <tbody>
          ${cart.items.map((i) => `
            <tr data-testid="cart-row" data-id="${i.productId}">
              <td><a href="#/product/${i.productId}">${esc(i.name)}</a></td>
              <td class="num">${rub(i.price)}</td>
              <td>
                <span class="qty">
                  <button type="button" class="secondary" data-qty="${i.qty - 1}" aria-label="Уменьшить количество">−</button>
                  <input type="number" min="1" value="${i.qty}" aria-label="Количество">
                  <button type="button" class="secondary" data-qty="${i.qty + 1}" aria-label="Увеличить количество">+</button>
                </span>
              </td>
              <td class="num">${rub(i.sum)}</td>
              <td><button type="button" class="link" data-remove>Удалить</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="summary">
        <form class="promo" id="promo">
          <input name="code" placeholder="Промокод" aria-label="Промокод" value="${cart.promo ? esc(cart.promo.code) : ''}">
          <button type="submit" class="secondary">Применить</button>
        </form>
        ${summaryHtml(cart)}
        <p class="muted" style="font-size:14px">Стоимость доставки рассчитывается при оформлении.</p>
        <a class="btn" href="#/checkout" id="to-checkout">Оформить заказ</a>
        <button type="button" class="link" id="clear" style="margin-left:12px">Очистить корзину</button>
      </div>`;

    const act = async (fn) => {
      try { await fn(); } catch (e) { toast(e.message, true); }
      pageCart();
    };
    $app.querySelector('tbody').addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      if (!row) return;
      const id = row.dataset.id;
      if (e.target.closest('[data-remove]')) act(() => api('DELETE', '/api/cart/items/' + id));
      const q = e.target.closest('[data-qty]');
      if (q) act(() => api('PATCH', '/api/cart/items/' + id, { qty: Number(q.dataset.qty) }));
    });
    $app.querySelector('tbody').addEventListener('change', (e) => {
      const row = e.target.closest('tr');
      if (row && e.target.matches('input')) act(() => api('PATCH', '/api/cart/items/' + row.dataset.id, { qty: Number(e.target.value) }));
    });
    document.getElementById('promo').addEventListener('submit', (e) => {
      e.preventDefault();
      act(async () => {
        const code = new FormData(e.target).get('code');
        const res = await api('POST', '/api/cart/promo', { code });
        toast(res.promo ? 'Промокод применён' : 'Промокод сброшен');
      });
    });
    document.getElementById('clear').onclick = () => act(() => api('DELETE', '/api/cart'));
  }

  async function pageCheckout() {
    const cart = await api('GET', '/api/cart');
    setCartCount(cart.count);
    if (!cart.items.length) {
      location.hash = '#/cart';
      return;
    }
    $app.innerHTML = `
      <h1>Оформление заказа</h1>
      <form class="form" id="checkout" novalidate>
        <div class="form-error" role="alert" hidden></div>
        <label>Имя получателя <input name="name" autocomplete="name" value="${state.user ? esc(state.user.name) : ''}"></label>
        <label>Телефон <input name="phone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00"></label>
        <fieldset>
          <legend>Способ доставки</legend>
          <div class="radio">
            <label><input type="radio" name="delivery" value="courier" checked> Курьером</label>
            <label><input type="radio" name="delivery" value="pickup"> Самовывоз</label>
          </div>
        </fieldset>
        <label id="address-row">Адрес доставки <input name="address" autocomplete="street-address"></label>
        <fieldset>
          <legend>Способ оплаты</legend>
          <div class="radio">
            <label><input type="radio" name="payment" value="card" checked> Картой при получении</label>
            <label><input type="radio" name="payment" value="cash"> Наличными</label>
          </div>
        </fieldset>
        <label>Комментарий к заказу <textarea name="comment" rows="2" maxlength="500"></textarea></label>
        <div class="summary" id="summary" style="margin:0;max-width:none"></div>
        <button type="submit" id="submit-order">Подтвердить заказ</button>
      </form>`;
    const form = document.getElementById('checkout');

    async function refresh() {
      const method = new FormData(form).get('delivery');
      document.getElementById('address-row').hidden = method !== 'courier';
      const d = await api('GET', '/api/delivery?method=' + method);
      document.getElementById('summary').innerHTML = summaryHtml(cart, d.cost);
    }
    form.addEventListener('change', (e) => { if (e.target.name === 'delivery') refresh(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-order');
      btn.disabled = true;
      showFieldErrors(form, {});
      showFormError(form, '');
      try {
        const order = await api('POST', '/api/orders', Object.fromEntries(new FormData(form)));
        setCartCount(0);
        location.hash = '#/order/' + order.id;
      } catch (err) {
        showFieldErrors(form, err.fields);
        showFormError(form, err.message);
        btn.disabled = false;
      }
    });
    await refresh();
  }

  function orderHtml(o) {
    return `
      <table>
        <thead><tr><th>Товар</th><th class="num">Цена</th><th class="num">Кол-во</th><th class="num">Сумма</th></tr></thead>
        <tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${rub(i.price)}</td><td class="num">${i.qty}</td><td class="num">${rub(i.sum)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="summary">${summaryHtml({ subtotal: o.subtotal, discount: o.discount, promo: o.promo ? { code: o.promo } : null, total: o.subtotal - o.discount }, o.shipping)}</div>
      <p class="muted">Получатель: ${esc(o.customer.name)}, ${esc(o.customer.phone)}.
        ${o.delivery === 'courier' ? 'Доставка курьером: ' + esc(o.customer.address) : 'Самовывоз'}.
        Оплата: ${o.payment === 'card' ? 'картой при получении' : 'наличными'}.</p>`;
  }

  async function pageOrder(id) {
    let o;
    try {
      o = await api('GET', '/api/orders/' + encodeURIComponent(id));
    } catch (e) {
      $app.innerHTML = '<h1>Заказ не найден</h1><p><a href="#/">Вернуться в каталог</a></p>';
      return;
    }
    $app.innerHTML = `
      <div class="success" data-testid="order-success">
        <h1>Заказ №<span data-testid="order-id">${o.id}</span> оформлен</h1>
        <p>Спасибо! Мы свяжемся с вами по телефону ${esc(o.customer.phone)} для подтверждения.</p>
      </div>
      <h2>Состав заказа</h2>
      ${orderHtml(o)}
      <p><a href="#/">Продолжить покупки</a></p>`;
  }

  async function pageOrders() {
    if (!state.user) {
      location.hash = '#/login';
      return;
    }
    const orders = await api('GET', '/api/orders');
    if (!orders.length) {
      $app.innerHTML = '<h1>Мои заказы</h1><div class="empty">У вас пока нет заказов. <a href="#/">Перейти в каталог</a></div>';
      return;
    }
    $app.innerHTML = `
      <h1>Мои заказы</h1>
      <table data-testid="orders-table">
        <thead><tr><th>Номер</th><th>Дата</th><th class="num">Товаров</th><th class="num">Сумма</th></tr></thead>
        <tbody>${orders.map((o) => `
          <tr data-testid="order-row">
            <td><a href="#/order/${o.id}">№${o.id}</a></td>
            <td>${fmtDate(o.createdAt)}</td>
            <td class="num">${o.items.reduce((n, i) => n + i.qty, 0)}</td>
            <td class="num">${rub(o.total)}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  function pageAuth(mode) {
    const isRegister = mode === 'register';
    $app.innerHTML = `
      <h1>${isRegister ? 'Регистрация' : 'Вход'}</h1>
      <form class="form" id="auth" novalidate>
        <div class="form-error" role="alert" hidden></div>
        ${isRegister ? '<label>Имя <input name="name" autocomplete="name"></label>' : ''}
        <label>E-mail <input name="email" type="email" autocomplete="email"></label>
        <label>Пароль <input name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}"></label>
        <button type="submit">${isRegister ? 'Зарегистрироваться' : 'Войти'}</button>
        <p class="muted">${isRegister ? 'Уже есть аккаунт? <a href="#/login">Войти</a>' : 'Нет аккаунта? <a href="#/register">Зарегистрироваться</a>'}</p>
      </form>`;
    const form = document.getElementById('auth');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showFieldErrors(form, {});
      showFormError(form, '');
      try {
        state.user = await api('POST', isRegister ? '/api/auth/register' : '/api/auth/login', Object.fromEntries(new FormData(form)));
        renderHeader();
        toast(isRegister ? 'Вы зарегистрированы' : 'Вы вошли');
        location.hash = '#/';
      } catch (err) {
        showFieldErrors(form, err.fields);
        showFormError(form, err.message);
      }
    });
  }

  // ---------- роутер ----------

  async function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
    try {
      switch (parts[0]) {
        case '': await pageCatalog(); break;
        case 'product': await pageProduct(parts[1]); break;
        case 'cart': await pageCart(); break;
        case 'checkout': await pageCheckout(); break;
        case 'order': await pageOrder(parts[1]); break;
        case 'orders': await pageOrders(); break;
        case 'login': pageAuth('login'); break;
        case 'register': pageAuth('register'); break;
        default: $app.innerHTML = '<h1>Страница не найдена</h1><p><a href="#/">Вернуться в каталог</a></p>';
      }
    } catch (e) {
      $app.innerHTML = `<h1>Что-то пошло не так</h1><p class="muted">${esc(e.message)}</p>`;
    }
    window.scrollTo(0, 0);
  }

  document.getElementById('nav-logout').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout');
    state.user = null;
    renderHeader();
    toast('Вы вышли');
    location.hash = '#/';
    route();
  });

  window.addEventListener('hashchange', route);

  (async function init() {
    try {
      const [me, cart, categories] = await Promise.all([api('GET', '/api/auth/me'), api('GET', '/api/cart'), api('GET', '/api/categories')]);
      state.user = me.user;
      state.categories = categories;
      setCartCount(cart.count);
    } catch (e) { /* покажем ошибку на странице */ }
    renderHeader();
    route();
  })();
})();

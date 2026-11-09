/* 炭火江湖烧烤 · 纯静态点餐系统。菜单来自数据数组，订单存 localStorage。 */
(function () {
  'use strict';

  /* ---------------- 数据 ---------------- */
  const MENU = [
    { category: '烤串', items: [
      { name: '香辣牛肉串', price: 18, spicy: 3 },
      { name: '黑椒牛肉串', price: 17, spicy: 1 },
      { name: '扇贝肉丸串', price: 16, spicy: 0 },
      { name: '金丝玉米串', price: 10, spicy: 0 }
    ]},
    { category: '烤海鲜', items: [
      { name: '蒜蓉虾球', price: 14, spicy: 0 },
      { name: '炭火大虾', price: 26, spicy: 0 },
      { name: '香辣鱿鱼串', price: 15, spicy: 3 }
    ]},
    { category: '主食小吃', items: [
      { name: '藤椒咸黄油土豆', price: 11, spicy: 1 },
      { name: '炭烤葱姜饼', price: 9, spicy: 0 },
      { name: '金丝玉米杯', price: 8, spicy: 0 }
    ]},
    { category: '饮品', items: [
      { name: '冰镇酸梅汤', price: 12, spicy: 0 },
      { name: '陈皮柠檬茶', price: 15, spicy: 0 },
      { name: '爽甜玉米汁', price: 10, spicy: 0 }
    ]}
  ];

  const SPICE_LABEL = { 0: '不辣', 1: '微辣', 2: '中辣', 3: '大辣' };
  const STATUS_FLOW = ['待处理', '制作中', '已完成'];
  const STATUS_CLASS = { '待处理': 'st-pending', '制作中': 'st-making', '已完成': 'st-done' };
  const STORAGE_KEY = 'bbq.orders.v1';
  const MAX_QTY = 99;
  const TOAST_MS = 1900;

  /* 每个菜品确定性编号，电商/烤串... 用分类下标-菜名下标 */
  const ITEM_INDEX = new Map();
  MENU.forEach(function (cat, ci) {
    cat.items.forEach(function (it, ii) {
      ITEM_INDEX.set(ci + '-' + ii, it);
    });
  });

  /* ---------------- 状态 ---------------- */
  const cart = new Map();   // id -> 份数
  const itemRefs = new Map(); // id -> { card, qtyEl, decBtn }
  let orders = [];
  let els = null;

  /* ---------------- 工具 ---------------- */
  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function clear(node) { node.textContent = ''; }
  function formatYuan(n) { return Number(n).toLocaleString('zh-CN') + ' 元'; }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dayKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }
  function formatDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '时间未知';
    return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function spiceLevel(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(3, Math.max(0, Math.floor(n)));
  }
  function nextStatus(status) {
    const i = STATUS_FLOW.indexOf(status);
    return (i >= 0 && i < STATUS_FLOW.length - 1) ? STATUS_FLOW[i + 1] : null;
  }

  /* ---------------- 存储 ---------------- */
  function loadOrders() {
    let raw = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) raw = JSON.parse(stored);
    } catch (err) {
      console.warn('localStorage 读取失败，按空订单处理', err);
    }
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (o) { return o && typeof o === 'object'; }).map(function (o) {
      const items = Array.isArray(o.items) ? o.items.filter(function (i) {
        return i && typeof i === 'object' && typeof i.name === 'string'
          && Number.isFinite(Number(i.price)) && Number.isFinite(Number(i.qty)) && Number(i.qty) > 0;
      }).map(function (i) {
        return { name: i.name, price: Number(i.price), qty: Math.min(MAX_QTY, Math.floor(Number(i.qty))) };
      }) : [];
      const total = Number.isFinite(Number(o.total))
        ? Number(o.total) : items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
      const d = new Date(o.createdAt);
      const createdAt = isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
      const no = (typeof o.no === 'string' && o.no) ? o.no : 'ORDER-' + Date.parse(createdAt);
      const table = o.table === undefined || o.table === null || o.table === '' ? '未知桌号' : String(o.table);
      const status = STATUS_FLOW.indexOf(o.status) >= 0 ? o.status : STATUS_FLOW[0];
      return { no: no, table: table, items: items, total: total, status: status, createdAt: createdAt };
    });
  }
  function saveOrders() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
    } catch (err) {
      console.warn('localStorage 写入失败', err);
      toast('本地存储写不进去，订单只在当前页面有效', 'warn');
    }
  }

  /* ---------------- 提示 ---------------- */
  function toast(message, kind) {
    if (!els || !els.toasts) return;
    const node = make('div', 'toast' + (kind === 'warn' ? ' warn' : ''), message);
    els.toasts.appendChild(node);
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 300);
    }, TOAST_MS);
  }

  /* ---------------- 菜单渲染 ---------------- */
  function renderMenu() {
    clear(els.menuGrid);
    MENU.forEach(function (cat, ci) {
      const section = make('section', 'category');
      section.id = 'cat-' + ci;
      section.appendChild(make('h3', null, cat.category));
      const grid = make('div', 'category-grid');
      cat.items.forEach(function (item, ii) {
        const id = MENU.indexOf(cat) + '-' + ii;
        const card = make('article', 'item-card');
        const top = make('div', 'item-top');
        top.appendChild(make('span', 'item-name', item.name));
        top.appendChild(make('span', 'spice spice-' + spiceLevel(item.spicy), SPICE_LABEL[spiceLevel(item.spicy)]));
        card.appendChild(top);
        card.appendChild(make('span', 'item-price', formatYuan(item.price)));
        const stepper = make('div', 'stepper');
        const dec = make('button', null, '−');
        dec.type = 'button';
        dec.dataset.act = 'dec';
        dec.dataset.id = id;
        dec.setAttribute('aria-label', item.name + '减少');
        const qty = make('span', 'qty', '0');
        const inc = make('button', null, '+');
        inc.type = 'button';
        inc.dataset.act = 'inc';
        inc.dataset.id = id;
        inc.setAttribute('aria-label', item.name + '增加');
        stepper.appendChild(dec);
        stepper.appendChild(qty);
        stepper.appendChild(inc);
        card.appendChild(stepper);
        grid.appendChild(card);
        itemRefs.set(id, { card: card, qtyEl: qty, decBtn: dec });
      });
      section.appendChild(grid);
      els.menuGrid.appendChild(section);
    });
    buildCatNav();
    itemRefs.forEach(function (_ref, id) { syncItem(id); });
  }

  /* 分类快捷导航：由菜单数据生成，与滚动联动高亮 */
  function buildCatNav() {
    if (!els.catNav) return;
    clear(els.catNav);
    MENU.forEach(function (cat, ci) {
      const chip = make('button', 'cat-chip', cat.category);
      chip.type = 'button';
      chip.dataset.act = 'cat';
      chip.dataset.target = 'cat-' + ci;
      if (ci === 0) chip.classList.add('is-active');
      els.catNav.appendChild(chip);
    });
  }

  /* 底部结算条：与购物车汇总同步显隐 */
  let currentView = 'customer';
  function updateBar(totalQty, totalPrice) {
    if (!els.checkoutBar) return;
    els.barTotal.textContent = formatYuan(totalPrice);
    els.barCount.textContent = '共 ' + totalQty + ' 份';
    const show = totalQty > 0 && currentView === 'customer';
    els.checkoutBar.classList.toggle('show', show);
  }

  /* 分类区滚动显现 + 导航联动高亮（IntersectionObserver，符合动效规范） */
  function initObservers() {
    const sections = document.querySelectorAll('.category');
    if (!('IntersectionObserver' in window)) {
      sections.forEach(function (s) { s.classList.add('revealed'); });
      return;
    }
    const reveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('revealed'); reveal.unobserve(e.target); }
      });
    }, { threshold: 0.08 });
    sections.forEach(function (s) { reveal.observe(s); });
    const spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting || !els.catNav) return;
        els.catNav.querySelectorAll('.cat-chip').forEach(function (chip) {
          chip.classList.toggle('is-active', chip.dataset.target === e.target.id);
        });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }
  function syncItem(id) {
    const ref = itemRefs.get(id);
    if (!ref) return;
    const qty = cart.get(id) || 0;
    ref.qtyEl.textContent = String(qty);
    ref.decBtn.disabled = qty <= 0;
    ref.card.classList.toggle('in-cart', qty > 0);
  }
  function syncAllItems() {
    itemRefs.forEach(function (_ref, id) { syncItem(id); });
  }

  /* ---------------- 购物车 ---------------- */
  function changeQty(id, delta) {
    if (!ITEM_INDEX.has(id)) return;
    const cur = cart.get(id) || 0;
    const next = cur + delta;
    if (next <= 0) {
      cart.delete(id);
    } else {
      cart.set(id, Math.min(MAX_QTY, next));
    }
    syncItem(id);
    const ref = itemRefs.get(id);
    if (ref && ref.qtyEl) {
      ref.qtyEl.classList.remove('pop');
      void ref.qtyEl.offsetWidth;
      ref.qtyEl.classList.add('pop');
    }
    renderCart();
  }
  function renderCart() {
    clear(els.cartItems);
    let totalQty = 0;
    let totalPrice = 0;
    cart.forEach(function (qty, id) {
      const item = ITEM_INDEX.get(id);
      if (!item) { cart.delete(id); return; }
      totalQty += qty;
      totalPrice += item.price * qty;
      const li = make('li', 'cart-row');
      const main = make('div', 'cr-main');
      main.appendChild(make('span', 'cr-name', item.name));
      main.appendChild(make('span', 'cr-amount', formatYuan(item.price) + ' × ' + qty));
      li.appendChild(main);
      const stepper = make('div', 'stepper sm');
      const dec = make('button', null, '−');
      dec.type = 'button';
      dec.dataset.act = 'dec';
      dec.dataset.id = id;
      dec.setAttribute('aria-label', item.name + '减少');
      const q = make('span', 'qty', String(qty));
      const inc = make('button', null, '+');
      inc.type = 'button';
      inc.dataset.act = 'inc';
      inc.dataset.id = id;
      inc.setAttribute('aria-label', item.name + '增加');
      stepper.appendChild(dec);
      stepper.appendChild(q);
      stepper.appendChild(inc);
      li.appendChild(stepper);
      const del = make('button', 'cart-del', '删除');
      del.type = 'button';
      del.dataset.act = 'remove';
      del.dataset.id = id;
      del.setAttribute('aria-label', item.name + '删除');
      li.appendChild(del);
      els.cartItems.appendChild(li);
    });
    els.cartSummary.textContent = '共 ' + totalQty + ' 份 · ' + formatYuan(totalPrice);
    els.cartEmpty.hidden = cart.size > 0;
    updateBar(totalQty, totalPrice);
  }

  /* ---------------- 提交订单 ---------------- */
  function nextOrderNo(date) {
    const key = dayKey(date).replace(/-/g, '');
    let seq = 0;
    orders.forEach(function (o) {
      if (dayKey(new Date(o.createdAt)) === dayKey(date)) seq += 1;
    });
    return key + '-NO' + String(seq + 1).padStart(3, '0');
  }
  function submitOrder() {
    if (cart.size === 0) {
      toast('购物车还是空的，先挑两道菜呀', 'warn');
      return;
    }
    const table = els.table.value.trim();
    if (!table) {
      toast('请填写桌号后再提交订单', 'warn');
      els.table.classList.add('field-error');
      const panel = els.table.closest('.card');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      els.table.focus({ preventScroll: true });
      setTimeout(function () { els.table.classList.remove('field-error'); }, 2000);
      return;
    }
    const items = [];
    let total = 0;
    cart.forEach(function (qty, id) {
      const item = ITEM_INDEX.get(id);
      if (!item) return;
      items.push({ name: item.name, price: item.price, qty: qty });
      total += item.price * qty;
    });
    if (items.length === 0) {
      toast('购物车数据有问题，请重新挑选菜品', 'warn');
      return;
    }
    const now = new Date();
    const order = { no: nextOrderNo(now), table: table, items: items, total: total, status: STATUS_FLOW[0], createdAt: now.toISOString() };
    orders.push(order);
    saveOrders();
    cart.clear();
    els.table.value = '';
    syncAllItems();
    renderCart();
    toast('下单成功，订单 ' + order.no + ' · 桌号 ' + table);
  }

  /* ---------------- 商家视图 ---------------- */
  function renderOrders() {
    const today = dayKey(new Date());
    let todayCount = 0;
    let todayRevenue = 0;
    orders.forEach(function (o) {
      if (dayKey(new Date(o.createdAt)) === today) {
        todayCount += 1;
        todayRevenue += o.total;
      }
    });
    els.statCount.textContent = String(todayCount);
    els.statRevenue.textContent = todayRevenue.toLocaleString('zh-CN');
    els.ordersHint.textContent = '共 ' + orders.length + ' 单 · 今日 ' + todayCount + ' 单';

    clear(els.orderList);
    if (orders.length === 0) {
      els.orderList.appendChild(make('p', 'empty', '还没有订单记录，客人惟妙惟肖地还没出现呢。'));
      return;
    }
    orders.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); }).forEach(function (o) {
      const card = make('div', 'order');
      const top = make('div', 'oc-top');
      top.appendChild(make('span', 'oc-no', o.no));
      const right = make('div', 'oc-top-right');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '8px';
      right.appendChild(make('span', 'badge ' + (STATUS_CLASS[o.status] || 'st-pending'), o.status));
      const next = nextStatus(o.status);
      if (next) {
        const btn = make('button', 'status-btn', '改为「' + next + '」');
        btn.type = 'button';
        btn.dataset.act = 'status';
        btn.dataset.id = o.no;
        right.appendChild(btn);
      }
      top.appendChild(right);
      card.appendChild(top);
      card.appendChild(make('div', 'oc-meta', '桌号 ' + o.table + ' · 下单时间 ' + formatDateTime(o.createdAt)));
      const ul = make('ul', 'oc-items');
      o.items.forEach(function (it) {
        const li = make('li');
        li.appendChild(make('span', null, it.name + ' × ' + it.qty));
        li.appendChild(make('span', 'oc-amount', formatYuan(it.price * it.qty)));
        ul.appendChild(li);
      });
      card.appendChild(ul);
      const totalRow = make('div', 'oc-total');
      totalRow.appendChild(make('span', null, '总价'));
      totalRow.appendChild(make('span', null, formatYuan(o.total)));
      card.appendChild(totalRow);
      els.orderList.appendChild(card);
    });
  }
  function cycleStatus(no) {
    const order = orders.filter(function (o) { return o.no === no; })[0];
    if (!order) return;
    const next = nextStatus(order.status);
    if (!next) { toast('这单已经做完啦（' + order.status + '）'); return; }
    order.status = next;
    saveOrders();
    renderOrders();
    toast('订单 ' + order.no + ' 状态已更新为「' + next + '」');
  }

  /* ---------------- 视图切换 ---------------- */
  function setView(name) {
    currentView = name;
    const merchant = name === 'merchant';
    if (els.customerView) els.customerView.hidden = merchant;
    if (els.merchantView) els.merchantView.hidden = !merchant;
    els.tabs.querySelectorAll('.tab').forEach(function (t) {
      const on = t.dataset.view === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (merchant) renderOrders();
    renderCart();
  }

  /* ---------------- 事件 ---------------- */
  function findAct(target) {
    return (target instanceof Element) ? target.closest('[data-act]') : null;
  }
  function onDocClick(e) {
    const el = findAct(e.target);
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'inc' || act === 'dec') changeQty(el.dataset.id, act === 'inc' ? 1 : -1);
    else if (act === 'remove') { if (el.dataset.id) { cart.delete(el.dataset.id); syncItem(el.dataset.id); renderCart(); } }
    else if (act === 'submit') submitOrder();
    else if (act === 'status') cycleStatus(el.dataset.id);
    else if (act === 'view') setView(el.dataset.view);
    else if (act === 'cat') {
      const target = document.getElementById(el.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (els.catNav) els.catNav.querySelectorAll('.cat-chip').forEach(function (chip) {
        chip.classList.toggle('is-active', chip === el);
      });
    }
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    els = {
      table: document.getElementById('tableInput'),
      cartItems: document.getElementById('cartItems'),
      cartEmpty: document.getElementById('cartEmpty'),
      cartSummary: document.getElementById('cartSummary'),
      menuGrid: document.getElementById('menuGrid'),
      orderList: document.getElementById('orderList'),
      statCount: document.getElementById('statCount'),
      statRevenue: document.getElementById('statRevenue'),
      ordersHint: document.getElementById('ordersHint'),
      toasts: document.getElementById('toasts'),
      tabs: document.querySelector('.tabs'),
      customerView: document.getElementById('customerView'),
      merchantView: document.getElementById('merchantView'),
      catNav: document.getElementById('catNav'),
      checkoutBar: document.getElementById('checkoutBar'),
      barTotal: document.getElementById('barTotal'),
      barCount: document.getElementById('barCount')
    };
    if (!els.menuGrid || !els.cartItems || !els.orderList || !els.table) {
      console.warn('必要的 DOM 节点缺失，脚本停止运行');
      return;
    }
    orders = loadOrders();
    renderMenu();
    renderCart();
    setView('customer');
    const topbar = document.querySelector('.topbar');
    if (topbar) document.documentElement.style.setProperty('--catnav-top', topbar.offsetHeight + 'px');
    initObservers();
    document.addEventListener('click', onDocClick);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

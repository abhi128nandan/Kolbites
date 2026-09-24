/**
 * KolBites — Site app (menu, cart, checkout)
 * Vanilla JS, no build step. Depends on:
 *   kolbites-menu-data.js   → window.KOLBITES_MENU
 *   kolbites-pos-adapter.js → window.KolBitesPOS
 * All DOM hooks use data-kb-* attributes so the markup can live in
 * WordPress template parts, Gutenberg HTML blocks or Elementor widgets.
 */
(function (window, document) {
  "use strict";

  var MENU = window.KOLBITES_MENU;
  var POS = window.KolBitesPOS;
  var STORAGE_KEY = "kolbites_cart_v1";
  var CUR = MENU.currency || "₹";

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var money = function (n) { return CUR + n.toLocaleString("en-IN"); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  var itemIndex = {};
  MENU.categories.forEach(function (cat) {
    cat.items.forEach(function (item) { itemIndex[item.id] = Object.assign({ category: cat.name }, item); });
  });

  var unavailable = {};
  var dietFilter = "all"; // "all" | "veg" | "egg" | "nonveg"
  var chipFilter = "all"; // "all" | "bestseller" | category id

  // ------------------------------------------------------------------
  // Cart state
  // ------------------------------------------------------------------
  var cart = { lines: [] };

  function loadCart() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.lines)) {
        cart.lines = saved.lines.filter(function (l) { return itemIndex[l.id]; });
      }
    } catch (e) { cart.lines = []; }
  }
  function saveCart() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lines: cart.lines })); } catch (e) {}
  }
  function lineKey(id, optionId) { return optionId ? id + "::" + optionId : id; }
  function totals() {
    var count = 0, total = 0;
    cart.lines.forEach(function (l) { count += l.qty; total += l.qty * l.price; });
    return { count: count, total: total };
  }
  function qtyForItem(id) {
    return cart.lines.reduce(function (n, l) { return l.id === id ? n + l.qty : n; }, 0);
  }

  function addToCart(id, optionId) {
    var item = itemIndex[id];
    if (!item || item.price == null || unavailable[id]) return;
    var option = null;
    if (item.options) {
      option = item.options.choices.filter(function (c) { return c.id === optionId; })[0];
      if (!option) return;
    }
    var key = lineKey(id, option && option.id);
    var line = cart.lines.filter(function (l) { return l.key === key; })[0];
    if (line) {
      line.qty += 1;
    } else {
      cart.lines.push({
        key: key, id: id, posId: item.posId,
        name: item.name + (option ? " (" + option.name + ")" : ""),
        optionId: option ? option.id : null,
        posVariationId: option ? option.posVariationId : null,
        price: item.price, diet: item.diet, qty: 1,
      });
    }
    commit();
    toast(item.name + (option ? " (" + option.name + ")" : "") + " added to cart");
  }

  function changeLine(key, delta) {
    cart.lines = cart.lines.map(function (l) {
      if (l.key === key) l.qty += delta;
      return l;
    }).filter(function (l) { return l.qty > 0; });
    commit();
  }

  function removeItemOnce(id) {
    // Stepper on the menu: remove from the most recently added line for this item
    for (var i = cart.lines.length - 1; i >= 0; i--) {
      if (cart.lines[i].id === id) { changeLine(cart.lines[i].key, -1); return; }
    }
  }

  function commit() {
    saveCart();
    renderCart();
    refreshMenuSteppers();
  }

  // ------------------------------------------------------------------
  // Menu rendering
  // ------------------------------------------------------------------
  function dietMark(diet) {
    var label = diet === "veg" ? "Vegetarian" : diet === "egg" ? "Contains egg" : "Non-vegetarian";
    return '<span class="kb-diet kb-diet--' + diet + '" role="img" aria-label="' + label + '" title="' + label + '"></span>';
  }

  function itemControl(item) {
    if (item.price == null) {
      return '<span class="kb-item__mrp">Buy at counter</span>';
    }
    if (unavailable[item.id]) {
      return '<span class="kb-item__mrp">Sold out today</span>';
    }
    var q = qtyForItem(item.id);
    if (q > 0) {
      return '<div class="kb-stepper" role="group" aria-label="Quantity of ' + esc(item.name) + '">' +
        '<button type="button" class="kb-stepper__btn" data-kb-dec="' + item.id + '" aria-label="Remove one ' + esc(item.name) + '">−</button>' +
        '<span class="kb-stepper__qty" aria-live="polite">' + q + '</span>' +
        '<button type="button" class="kb-stepper__btn" data-kb-add="' + item.id + '" aria-label="Add one more ' + esc(item.name) + '">+</button>' +
      '</div>';
    }
    return '<button type="button" class="kb-add" data-kb-add="' + item.id + '" aria-label="Add ' + esc(item.name) + ' to cart">Add</button>';
  }

  var CAT_ICONS = {
    "cha": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><path d="M4 19h14a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1zm15-8h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2v-6zM2 21h18v1H2z"/></svg>',
    "snacks": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><path d="M12 3L2 21h20L12 3zm0 5.5l5.5 10H6.5L12 8.5z"/></svg>',
    "starters": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M10 11v10h4V11"/></svg>',
    "soups": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><path d="M3 10h18a8 8 0 0 1-16 0zm1-2c0-2 2-3 2-5m4 5c0-2 2-3 2-5m4 5c0-2 2-3 2-5"/></svg>',
    "rolls": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="8" rx="4"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="12" y1="8" x2="12" y2="16"/></svg>',
    "paratha": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
    "fried-rice": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><path d="M3 11c0 5 4 9 9 9s9-4 9-9H3zm13-5l3-3m-6 3l1-3m-5 4l-1-4"/></svg>',
    "noodles": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><path d="M4 11a8 8 0 0 0 16 0H4zm2-4h12M7 4h10"/></svg>',
    "main-course": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3"/></svg>',
    "combos": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/></svg>',
    "salad": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><path d="M12 3c-4 4-7 8-7 12a7 7 0 0 0 14 0c0-4-3-8-7-12z"/></svg>',
    "drinks": '<svg class="kb-catnav__icon" viewBox="0 0 24 24"><path d="M6 3h12l-2 18H8L6 3zm2 3h8m-7 5h6"/></svg>'
  };

  var searchQuery = "";

  function renderMenu() {
    var nav = $("[data-kb-category-nav]");
    var list = $("[data-kb-menu-list]");
    if (!nav || !list) return;

    nav.innerHTML = MENU.categories.map(function (cat, i) {
      var icon = CAT_ICONS[cat.id] || '';
      return '<li><a href="#menu-' + cat.id + '" class="kb-catnav__link' + (i === 0 ? " is-active" : "") +
        '" data-kb-cat-link="' + cat.id + '">' + icon + '<span>' + esc(cat.name) + '</span></a></li>';
    }).join("");

    list.innerHTML = MENU.categories.map(function (cat) {
      var items = cat.items.map(function (item) {
        var price = item.price == null ? (item.priceLabel || "At MRP") : money(item.price);
        return '<li class="kb-item' + (item.signature ? " kb-item--signature" : "") + '" data-kb-item="' + item.id + '" data-name="' + esc(item.name.toLowerCase()) + '" data-diet="' + item.diet + '">' +
          '<div class="kb-item__line">' +
            dietMark(item.diet) +
            '<span class="kb-item__name">' + esc(item.name) +
              (item.note ? ' <span class="kb-item__note">' + esc(item.note) + '</span>' : '') +
              (item.options ? ' <span class="kb-item__note">' + item.options.choices.map(function (c) { return c.name; }).join(" / ") + '</span>' : '') +
            '</span>' +
            '<span class="kb-item__leader" aria-hidden="true"></span>' +
            '<span class="kb-item__price">' + price + '</span>' +
          '</div>' +
          '<div class="kb-item__action" data-kb-action="' + item.id + '">' + itemControl(item) + '</div>' +
        '</li>';
      }).join("");
      return '<article class="kb-category" id="menu-' + cat.id + '" aria-labelledby="menu-' + cat.id + '-title">' +
        '<h3 class="kb-category__title" id="menu-' + cat.id + '-title">' + esc(cat.name) + '</h3>' +
        '<ul class="kb-category__items">' + items + '</ul>' +
      '</article>';
    }).join("");

    applyFilters();
    setupScrollSpy();
  }

  function refreshMenuSteppers() {
    $$("[data-kb-action]").forEach(function (el) {
      var item = itemIndex[el.getAttribute("data-kb-action")];
      el.innerHTML = itemControl(item);
    });
  }

  function applyFilters() {
    var q = searchQuery.trim().toLowerCase();
    var visibleCount = 0;

    $$("[data-kb-item]").forEach(function (li) {
      var id = li.getAttribute("data-kb-item");
      var item = itemIndex[id];
      var diet = li.getAttribute("data-diet");

      var matchesDiet = true;
      if (dietFilter === "veg") matchesDiet = (diet === "veg");
      else if (dietFilter === "egg") matchesDiet = (diet === "egg");
      else if (dietFilter === "nonveg") matchesDiet = (diet === "nonveg");

      var matchesChip = true;
      if (chipFilter === "bestseller") {
        matchesChip = Boolean(item && item.signature);
      }

      var name = (li.getAttribute("data-name") || "").toLowerCase();
      var matchesSearch = !q || name.indexOf(q) !== -1;

      var isVisible = matchesDiet && matchesChip && matchesSearch;
      li.hidden = !isVisible;
      if (isVisible) visibleCount++;
    });

    $$(".kb-category").forEach(function (cat) {
      var visible = $$("[data-kb-item]", cat).some(function (li) { return !li.hidden; });
      cat.hidden = !visible;
      var link = $('[data-kb-cat-link="' + cat.id.replace("menu-", "") + '"]');
      if (link) link.parentElement.hidden = !visible;
    });

    // Update live search count & clear button
    var countEl = $("[data-kb-search-count]");
    var clearBtn = $("[data-kb-search-clear]");
    if (clearBtn) clearBtn.hidden = !q;

    if (countEl) {
      if (q || dietFilter !== "all" || chipFilter !== "all") {
        countEl.hidden = false;
        if (visibleCount === 0) {
          countEl.textContent = "No dishes found";
        } else {
          countEl.textContent = visibleCount + (visibleCount === 1 ? " dish" : " dishes");
        }
      } else {
        countEl.hidden = true;
      }
    }
  }

  // Scroll-spy. The printed-card layout uses CSS columns, so several
  // categories can share the same height; the first one in reading order
  // that crosses the upper band of the viewport wins.
  var spyBound = false;
  function updateActiveCategory() {
    var headerH = ($("[data-kb-header]") || { offsetHeight: 72 }).offsetHeight;
    var band = headerH + window.innerHeight * 0.25;
    var active = null;
    $$(".kb-category").some(function (cat) {
      if (cat.hidden) return false;
      var r = cat.getBoundingClientRect();
      if (r.top <= band && r.bottom > headerH + 40) { active = cat; return true; }
      return false;
    });
    if (!active) return;
    var id = active.id.replace("menu-", "");
    $$(".kb-catnav__link").forEach(function (a) {
      var on = a.getAttribute("data-kb-cat-link") === id;
      a.classList.toggle("is-active", on);
      if (on) {
        a.setAttribute("aria-current", "true");
        var rail = a.closest(".kb-catnav__list");
        if (rail && rail.scrollWidth > rail.clientWidth) rail.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" });
      } else {
        a.removeAttribute("aria-current");
      }
    });
  }
  function setupScrollSpy() {
    updateActiveCategory();
    if (spyBound) return;
    spyBound = true;
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { ticking = false; updateActiveCategory(); });
    }, { passive: true });
  }

  // ------------------------------------------------------------------
  // Option chooser (e.g. Dry / Gravy)
  // ------------------------------------------------------------------
  function chooseOption(item) {
    var dlg = $("[data-kb-option-dialog]");
    if (!dlg || typeof dlg.showModal !== "function") {
      addToCart(item.id, item.options.choices[0].id);
      return;
    }
    $("[data-kb-option-title]", dlg).textContent = item.name;
    $("[data-kb-option-label]", dlg).textContent = "Choose " + item.options.label.toLowerCase();
    $("[data-kb-option-choices]", dlg).innerHTML = item.options.choices.map(function (c) {
      return '<button type="button" class="kb-btn kb-btn--choice" data-kb-choose="' + c.id + '">' + esc(c.name) + '</button>';
    }).join("");
    dlg.setAttribute("data-item", item.id);
    dlg.showModal();
  }

  // ------------------------------------------------------------------
  // Cart drawer
  // ------------------------------------------------------------------
  function renderCart() {
    var t = totals();
    $$("[data-kb-cart-count]").forEach(function (el) {
      if (el.textContent !== String(t.count)) {
        el.textContent = t.count;
        el.hidden = t.count === 0;
        el.classList.remove("kb-badge--bump");
        void el.offsetWidth;
        el.classList.add("kb-badge--bump");
      }
    });
    $$("[data-kb-cart-total]").forEach(function (el) { el.textContent = money(t.total); });

    var bar = $("[data-kb-cartbar]");
    if (bar) bar.hidden = t.count === 0;
    var barLabel = $("[data-kb-cartbar-label]");
    if (barLabel) barLabel.textContent = t.count + (t.count === 1 ? " item" : " items") + " · " + money(t.total);

    // Free delivery progress bar calculation (threshold: ₹299)
    var progressEl = $("[data-kb-delivery-progress]");
    var progressText = $("[data-kb-delivery-text]");
    var progressFill = $("[data-kb-delivery-fill]");
    var FREE_THRESHOLD = 299;

    if (progressEl && progressText && progressFill) {
      if (t.total === 0) {
        progressText.innerHTML = "Add <strong>₹" + FREE_THRESHOLD + "</strong> for FREE delivery";
        progressFill.style.width = "0%";
        progressEl.classList.remove("kb-delivery-progress--unlocked");
      } else if (t.total < FREE_THRESHOLD) {
        var diff = FREE_THRESHOLD - t.total;
        var pct = Math.min(96, Math.max(10, Math.round((t.total / FREE_THRESHOLD) * 100)));
        progressText.innerHTML = "Add <strong>₹" + diff + "</strong> more for FREE delivery!";
        progressFill.style.width = pct + "%";
        progressEl.classList.remove("kb-delivery-progress--unlocked");
      } else {
        progressText.innerHTML = "🎉 <strong>Free Delivery Unlocked!</strong>";
        progressFill.style.width = "100%";
        progressEl.classList.add("kb-delivery-progress--unlocked");
      }
    }

    var body = $("[data-kb-cart-lines]");
    var foot = $("[data-kb-cart-footer]");
    if (!body) return;
    if (t.count === 0) {
      body.innerHTML = '<div class="kb-cart__empty">' +
        '<p>Your cart is empty.</p>' +
        '<p>Pick something from the menu — here are a few street favourites:</p>' +
        '<div class="kb-cart__quickpicks">' +
          '<p class="kb-cart__quickpicks-title">Quick Add to Cart:</p>' +
          '<div class="kb-cart__quickpicks-grid">' +
            '<button type="button" class="kb-btn kb-btn--quick" data-kb-quick-add="cha-boro">+ Boro Cha (₹15)</button>' +
            '<button type="button" class="kb-btn kb-btn--quick" data-kb-quick-add="snacks-singara">+ Singara (₹20)</button>' +
            '<button type="button" class="kb-btn kb-btn--quick" data-kb-quick-add="roll-egg-chicken">+ Egg Chicken Roll (₹80)</button>' +
          '</div>' +
        '</div>' +
        '<a class="kb-btn kb-btn--ghost" style="margin-top:1.25rem;" href="#menu" data-kb-close-cart>Browse full menu</a>' +
      '</div>';
      if (foot) foot.hidden = true;
      return;
    }
    if (foot) foot.hidden = false;
    body.innerHTML = '<ul class="kb-cart__list">' + cart.lines.map(function (l) {
      return '<li class="kb-cart__line">' +
        dietMark(l.diet) +
        '<div class="kb-cart__info"><span class="kb-cart__name">' + esc(l.name) + '</span>' +
        '<span class="kb-cart__unit">' + money(l.price) + ' each</span></div>' +
        '<div class="kb-stepper kb-stepper--sm" role="group" aria-label="Quantity of ' + esc(l.name) + '">' +
          '<button type="button" class="kb-stepper__btn" data-kb-line-dec="' + esc(l.key) + '" aria-label="Remove one ' + esc(l.name) + '">−</button>' +
          '<span class="kb-stepper__qty">' + l.qty + '</span>' +
          '<button type="button" class="kb-stepper__btn" data-kb-line-inc="' + esc(l.key) + '" aria-label="Add one more ' + esc(l.name) + '">+</button>' +
        '</div>' +
        '<span class="kb-cart__linetotal">' + money(l.qty * l.price) + '</span>' +
      '</li>';
    }).join("") + '</ul>';
  }

  var lastFocus = null;
  function openCart() {
    var drawer = $("[data-kb-cart]");
    if (!drawer) return;
    lastFocus = document.activeElement;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("kb-no-scroll");
    var close = $("[data-kb-close-cart]", drawer);
    if (close) close.focus();
  }
  function closeCart() {
    var drawer = $("[data-kb-cart]");
    if (!drawer) return;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("kb-no-scroll");
    if (lastFocus) lastFocus.focus();
  }

  // ------------------------------------------------------------------
  // Checkout
  // ------------------------------------------------------------------
  function openCheckout() {
    var dlg = $("[data-kb-checkout]");
    if (!dlg || totals().count === 0) return;
    closeCart();
    $("[data-kb-checkout-summary]", dlg).innerHTML = cart.lines.map(function (l) {
      return '<li><span>' + l.qty + ' × ' + esc(l.name) + '</span><span>' + money(l.qty * l.price) + '</span></li>';
    }).join("") + '<li class="kb-summary__total"><span>Total</span><span>' + money(totals().total) + '</span></li>';
    $("[data-kb-checkout-form]", dlg).hidden = false;
    $("[data-kb-checkout-result]", dlg).hidden = true;
    toggleAddress();
    dlg.showModal();
  }

  function toggleAddress() {
    var form = $("[data-kb-checkout-form]");
    if (!form) return;
    var type = (form.querySelector('input[name="orderType"]:checked') || {}).value;
    var wrap = $("[data-kb-address-field]", form);
    var input = $("textarea[name='address']", form);
    var isDelivery = type === "delivery";
    wrap.hidden = !isDelivery;
    input.required = isDelivery;
  }

  function showResult(html) {
    var dlg = $("[data-kb-checkout]");
    $("[data-kb-checkout-form]", dlg).hidden = true;
    var res = $("[data-kb-checkout-result]", dlg);
    res.innerHTML = html;
    res.hidden = false;
    var focusable = res.querySelector("button, a");
    if (focusable) focusable.focus();
  }

  function submitCheckout(e) {
    e.preventDefault();
    var form = e.target;
    var phoneInput = form.querySelector("input[name='phone']");
    var phone = phoneInput.value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(phone)) {
      phoneInput.setCustomValidity("Enter a 10-digit Indian mobile number, e.g. 98304 55588.");
      phoneInput.reportValidity();
      return;
    }
    phoneInput.setCustomValidity("");

    var data = new FormData(form);
    var customer = {
      name: String(data.get("name") || "").trim(),
      phone: phone,
      orderType: data.get("orderType"),
      address: String(data.get("address") || "").trim(),
      notes: String(data.get("notes") || "").trim(),
      payment: data.get("payment"),
    };
    var t = totals();
    var payload = POS.buildOrderPayload({ lines: cart.lines, total: t.total }, customer);
    var submitBtn = form.querySelector("[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Placing order…";

    POS.submitOrder(payload).then(function (res) {
      if (res && res.demo) {
        var summaryLines = cart.lines.map(function (l) {
          var item = itemIndex[l.id];
          var opt = l.optionId && item && item.options ? " (" + ((item.options.choices || []).find(function(c){return c.id===l.optionId})||{}).name + ")" : "";
          return "• " + l.qty + "x " + (item ? item.name : l.id) + opt + " - " + money(l.qty * l.price);
        }).join("%0A");
        var waMsg = "Hello KolBites! I would like to place an order:%0A%0A" +
          summaryLines + "%0A%0A" +
          "*Total: " + money(t.total) + "*%0A" +
          "Order Type: " + (customer.orderType === "delivery" ? "Delivery" : "Pickup") + "%0A" +
          "Name: " + encodeURIComponent(customer.name) + "%0A" +
          "Phone: " + encodeURIComponent(customer.phone) +
          (customer.address ? "%0AAddress: " + encodeURIComponent(customer.address) : "") +
          (customer.notes ? "%0ANotes: " + encodeURIComponent(customer.notes) : "");
        var waUrl = "https://wa.me/91" + POS.config.restaurantPhone + "?text=" + waMsg;

        showResult(
          '<h3 class="kb-result__title">Place this order</h3>' +
          '<p>Send your order details directly to our counter via WhatsApp for instant confirmation, or call us directly.</p>' +
          '<p class="kb-result__ref">Your order: ' + t.count + (t.count === 1 ? ' item' : ' items') + ' · ' + money(t.total) + '</p>' +
          '<div style="display:flex; flex-direction:column; gap:0.6rem; margin:1.25rem 0;">' +
            '<a class="kb-btn kb-btn--taxi kb-btn--block" style="background:#25D366; border-color:#25D366; color:#fff;" href="' + waUrl + '" target="_blank" rel="noopener">Send Order on WhatsApp</a>' +
            '<a class="kb-btn kb-btn--taxi kb-btn--block" href="tel:+91' + POS.config.restaurantPhone + '">Call ' + formatPhone(POS.config.restaurantPhone) + '</a>' +
          '</div>' +
          '<button type="button" class="kb-btn kb-btn--ghost" data-kb-close-checkout>Back to menu</button>'
        );
        return;
      }
      if (res && res.ok) {
        var ref = res.orderId || payload.clientOrderRef;
        cart.lines = [];
        commit();
        showResult(
          '<h3 class="kb-result__title">Order placed</h3>' +
          '<p>We\'ve received your order and will call ' + formatPhone(customer.phone) + ' if we need anything.</p>' +
          '<p class="kb-result__ref">Order reference: <strong>' + esc(ref) + '</strong></p>' +
          '<p class="kb-result__status" data-kb-order-status aria-live="polite">Status: sent to kitchen</p>' +
          '<button type="button" class="kb-btn kb-btn--ghost" data-kb-close-checkout>Done</button>'
        );
        POS.pollOrderStatus(res.orderId, function (s) {
          var el = $("[data-kb-order-status]");
          if (el) el.textContent = "Status: " + (s.label || s.status);
        });
        return;
      }
      throw new Error((res && res.message) || "The order wasn't accepted.");
    }).catch(function (err) {
      showResult(
        '<h3 class="kb-result__title">Order not sent</h3>' +
        '<p>' + esc(err.message) + ' Your cart is saved. Try again, or call us to order.</p>' +
        '<a class="kb-btn kb-btn--taxi" href="tel:+91' + POS.config.restaurantPhone + '">Call ' + formatPhone(POS.config.restaurantPhone) + '</a>' +
        '<button type="button" class="kb-btn kb-btn--ghost" data-kb-retry-checkout>Try again</button>'
      );
    }).then(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = "Place order";
    });
  }

  function formatPhone(p) { return p.slice(0, 5) + " " + p.slice(5); }

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  var toastTimer;
  function toast(msg) {
    var el = $("[data-kb-toast]");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 2200);
  }

  // ------------------------------------------------------------------
  // Events (delegated)
  // ------------------------------------------------------------------
  function bindEvents() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-kb-add],[data-kb-dec],[data-kb-line-inc],[data-kb-line-dec],[data-kb-open-cart],[data-kb-close-cart],[data-kb-checkout-open],[data-kb-close-checkout],[data-kb-retry-checkout],[data-kb-choose],[data-kb-order-online],[data-kb-diet-filter],[data-kb-diet-tab],[data-kb-chip],[data-kb-search-clear],[data-kb-quick-add],[data-kb-nav-toggle],[data-kb-option-cancel]");
      if (!t) return;

      if (t.hasAttribute("data-kb-add")) {
        var item = itemIndex[t.getAttribute("data-kb-add")];
        if (item && item.options) chooseOption(item); else addToCart(item.id);
      } else if (t.hasAttribute("data-kb-dec")) {
        removeItemOnce(t.getAttribute("data-kb-dec"));
      } else if (t.hasAttribute("data-kb-line-inc")) {
        changeLine(t.getAttribute("data-kb-line-inc"), 1);
      } else if (t.hasAttribute("data-kb-line-dec")) {
        changeLine(t.getAttribute("data-kb-line-dec"), -1);
      } else if (t.hasAttribute("data-kb-open-cart")) {
        e.preventDefault(); openCart();
      } else if (t.hasAttribute("data-kb-close-cart")) {
        closeCart();
      } else if (t.hasAttribute("data-kb-checkout-open")) {
        openCheckout();
      } else if (t.hasAttribute("data-kb-close-checkout")) {
        $("[data-kb-checkout]").close();
      } else if (t.hasAttribute("data-kb-retry-checkout")) {
        $("[data-kb-checkout-result]").hidden = true;
        $("[data-kb-checkout-form]").hidden = false;
      } else if (t.hasAttribute("data-kb-choose")) {
        var dlg = $("[data-kb-option-dialog]");
        addToCart(dlg.getAttribute("data-item"), t.getAttribute("data-kb-choose"));
        dlg.close();
      } else if (t.hasAttribute("data-kb-option-cancel")) {
        $("[data-kb-option-dialog]").close();
      } else if (t.hasAttribute("data-kb-order-online")) {
        // "Order Online" → Pet Pooja hosted flow if configured, else on-site menu
        if (POS.startOnlineOrdering()) e.preventDefault();
      } else if (t.hasAttribute("data-kb-diet-tab")) {
        dietFilter = t.getAttribute("data-kb-diet-tab") || "all";
        $$("[data-kb-diet-tab]").forEach(function (tab) {
          tab.classList.toggle("is-active", tab === t);
        });
        applyFilters();
      } else if (t.hasAttribute("data-kb-chip")) {
        var val = t.getAttribute("data-kb-chip");
        $$("[data-kb-chip]").forEach(function (ch) {
          ch.classList.toggle("is-active", ch === t);
        });
        if (val === "all" || val === "bestseller") {
          chipFilter = val;
          applyFilters();
        } else {
          chipFilter = "all";
          applyFilters();
          var targetCat = $("#menu-" + val);
          if (targetCat) {
            targetCat.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      } else if (t.hasAttribute("data-kb-search-clear")) {
        var sInput = $("[data-kb-menu-search]");
        if (sInput) {
          sInput.value = "";
          searchQuery = "";
          applyFilters();
          sInput.focus();
        }
      } else if (t.hasAttribute("data-kb-quick-add")) {
        var qId = t.getAttribute("data-kb-quick-add");
        addToCart(qId);
      } else if (t.hasAttribute("data-kb-diet-filter")) {
        dietFilter = t.getAttribute("aria-pressed") === "true" ? "all" : "veg";
        t.setAttribute("aria-pressed", String(dietFilter === "veg"));
        applyFilters();
      } else if (t.hasAttribute("data-kb-nav-toggle")) {
        var open = t.getAttribute("aria-expanded") === "true";
        t.setAttribute("aria-expanded", String(!open));
        $("[data-kb-nav]").classList.toggle("is-open", !open);
      }
    });

    // Close mobile nav after choosing a link
    $$("[data-kb-nav] a").forEach(function (a) {
      a.addEventListener("click", function () {
        var btn = $("[data-kb-nav-toggle]");
        if (btn) { btn.setAttribute("aria-expanded", "false"); $("[data-kb-nav]").classList.remove("is-open"); }
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && $("[data-kb-cart]") && $("[data-kb-cart]").classList.contains("is-open")) closeCart();
    });

    var form = $("[data-kb-checkout-form]");
    if (form) {
      form.addEventListener("submit", submitCheckout);
      form.addEventListener("change", function (e) { if (e.target.name === "orderType") toggleAddress(); });
      form.querySelector("input[name='phone']").addEventListener("input", function (e) { e.target.setCustomValidity(""); });
    }

    var searchInput = $("[data-kb-menu-search]");
    if (searchInput) {
      searchInput.addEventListener("input", function (e) {
        searchQuery = e.target.value || "";
        applyFilters();
      });
    }

    // Header state on scroll
    var header = $("[data-kb-header]");
    if (header) {
      var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 24); };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }
  }

  // ------------------------------------------------------------------
  // Scroll reveal
  // ------------------------------------------------------------------
  function setupScrollReveal() {
    if (!("IntersectionObserver" in window)) {
      $$(".kb-reveal").forEach(function (el) { el.classList.add("is-revealed"); });
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
    $$(".kb-reveal").forEach(function (el) { obs.observe(el); });
  }

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  function init() {
    loadCart();
    renderMenu();
    renderCart();
    bindEvents();
    setupScrollReveal();
    var year = $("[data-kb-year]");
    if (year) year.textContent = new Date().getFullYear();

    POS.syncMenu().then(function (status) {
      (status.unavailable || []).forEach(function (id) { unavailable[id] = true; });
      Object.keys(status.prices || {}).forEach(function (id) {
        if (itemIndex[id]) itemIndex[id].price = status.prices[id];
      });
      if ((status.unavailable || []).length || Object.keys(status.prices || {}).length) renderMenu();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.KolBites = { addToCart: addToCart, openCart: openCart, cart: cart };
})(window, document);

/**
 * KolBites — POS adapter (Pet Pooja)
 * ==================================================================
 *
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  WHERE THE PET POOJA API ENDPOINTS GO                        │
 *  ├─────────────────────────────────────────────────────────────┤
 *  │ 1. NEVER put Pet Pooja credentials or endpoint URLs in this  │
 *  │    file. Anything in browser JavaScript is public.           │
 *  │                                                              │
 *  │ 2. Put them in wp-config.php (server side):                  │
 *  │      define('KOLBITES_PETPOOJA_SAVE_ORDER_URL', '…');        │
 *  │      define('KOLBITES_PETPOOJA_FETCH_MENU_URL', '…');        │
 *  │      define('KOLBITES_PETPOOJA_APP_KEY',        '…');        │
 *  │      define('KOLBITES_PETPOOJA_APP_SECRET',     '…');        │
 *  │      define('KOLBITES_PETPOOJA_ACCESS_TOKEN',   '…');        │
 *  │      define('KOLBITES_PETPOOJA_REST_ID',        '…');        │
 *  │      define('KOLBITES_WEBHOOK_SECRET',          '…');        │
 *  │    The exact URLs and field names come from the integration  │
 *  │    document Pet Pooja shares when your outlet is onboarded.  │
 *  │                                                              │
 *  │ 3. wordpress/kolbites-petpooja-proxy.php exposes safe        │
 *  │    WordPress REST routes that this file calls:               │
 *  │      POST /wp-json/kolbites/v1/order            → save order │
 *  │      GET  /wp-json/kolbites/v1/order-status/ID  → poll status│
 *  │      GET  /wp-json/kolbites/v1/menu-status      → stock      │
 *  │      POST /wp-json/kolbites/v1/petpooja-callback             │
 *  │           ← Pet Pooja webhook (order status, item on/off)    │
 *  │                                                              │
 *  │ 4. The browser only knows those WordPress routes. They are   │
 *  │    passed in via window.KOLBITES_CONFIG (wp_localize_script).│
 *  └─────────────────────────────────────────────────────────────┘
 *
 *  Demo mode: if KOLBITES_CONFIG.orderEndpoint is empty, checkout shows
 *  an order summary and asks the guest to call — nothing is sent anywhere.
 */
(function (window) {
  "use strict";

  var DEFAULT_CONFIG = {
    restaurantPhone: "9830455588",
    orderEndpoint: "",        // e.g. "/wp-json/kolbites/v1/order"
    orderStatusEndpoint: "",  // e.g. "/wp-json/kolbites/v1/order-status/"
    menuStatusEndpoint: "",   // e.g. "/wp-json/kolbites/v1/menu-status"
    hostedOrderingUrl: "",    // Optional: Pet Pooja-hosted online ordering link for your outlet
    wpNonce: "",              // wp_create_nonce('wp_rest') for REST calls
    orderTypes: ["pickup", "delivery"],
    statusPollMs: 15000,
  };

  var config = Object.assign({}, DEFAULT_CONFIG, window.KOLBITES_CONFIG || {});

  function isConnected() {
    return Boolean(config.orderEndpoint);
  }

  /**
   * Build the payload sent to the WordPress proxy.
   * The proxy (PHP) re-prices every line from the server-side menu and
   * converts this neutral shape into Pet Pooja's "save order" format —
   * so field names here stay stable even if Pet Pooja's spec changes.
   *
   * HOOK ▸ If you need extra fields (table no., coupon, delivery charge),
   *        add them here AND map them in kolbites_map_to_petpooja() in PHP.
   */
  function buildOrderPayload(cart, customer) {
    return {
      source: "website",
      clientOrderRef: "KB-" + Date.now().toString(36).toUpperCase(),
      createdAt: new Date().toISOString(),
      orderType: customer.orderType,          // "pickup" | "delivery"
      customer: {
        name: customer.name,
        phone: customer.phone,
        address: customer.address || "",
        notes: customer.notes || "",
      },
      payment: { method: customer.payment || "pay_on_collection" },
      items: cart.lines.map(function (line) {
        return {
          id: line.id,                         // website item ID
          posId: line.posId,                   // Pet Pooja item ID (from menu data)
          name: line.name,
          optionId: line.optionId || null,     // e.g. "dry" | "gravy"
          posVariationId: line.posVariationId || null,
          quantity: line.qty,
          unitPrice: line.price,               // informational; server re-prices
        };
      }),
      clientTotal: cart.total,                 // informational; server recalculates
    };
  }

  function request(url, options) {
    var headers = { "Content-Type": "application/json" };
    if (config.wpNonce) headers["X-WP-Nonce"] = config.wpNonce;
    return fetch(url, Object.assign({ headers: headers, credentials: "same-origin" }, options))
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) {
            var err = new Error(body.message || "The order service returned an error (" + res.status + ").");
            err.status = res.status;
            throw err;
          }
          return body;
        });
      });
  }

  /**
   * HOOK ▸ Submit order. Resolves to { ok, orderId, message }.
   * WordPress proxy → Pet Pooja "save order" API.
   */
  function submitOrder(payload) {
    if (!isConnected()) {
      return Promise.resolve({ ok: false, demo: true, message: "Online ordering is not connected yet." });
    }
    return request(config.orderEndpoint, { method: "POST", body: JSON.stringify(payload) });
  }

  /**
   * HOOK ▸ Order status. Pet Pooja pushes status changes to the webhook
   * (accepted / food ready / dispatched / cancelled); the proxy stores the
   * latest one, and the site polls it here.
   */
  function pollOrderStatus(orderId, onUpdate) {
    if (!config.orderStatusEndpoint || !orderId) return function () {};
    var stopped = false;
    var last = null;
    function tick() {
      if (stopped) return;
      request(config.orderStatusEndpoint + encodeURIComponent(orderId), { method: "GET" })
        .then(function (data) {
          if (data && data.status && data.status !== last) {
            last = data.status;
            onUpdate(data);
          }
        })
        .catch(function () { /* keep polling quietly */ })
        .then(function () { if (!stopped) setTimeout(tick, config.statusPollMs); });
    }
    tick();
    return function stop() { stopped = true; };
  }

  /**
   * HOOK ▸ Menu sync. Pet Pooja can switch items off (out of stock) and push
   * that to the webhook. Returns { unavailable: ["item-id", …], prices: { "item-id": 120 } }.
   */
  function syncMenu() {
    if (!config.menuStatusEndpoint) return Promise.resolve({ unavailable: [], prices: {} });
    return request(config.menuStatusEndpoint, { method: "GET" }).catch(function () {
      return { unavailable: [], prices: {} };
    });
  }

  /**
   * "Order Online" CTA. If your outlet uses Pet Pooja's hosted ordering
   * page, set hostedOrderingUrl and the CTA opens it; otherwise the on-site
   * menu and cart are used.
   */
  function startOnlineOrdering() {
    if (config.hostedOrderingUrl) {
      window.open(config.hostedOrderingUrl, "_blank", "noopener");
      return true;
    }
    return false;
  }

  window.KolBitesPOS = {
    config: config,
    isConnected: isConnected,
    buildOrderPayload: buildOrderPayload,
    submitOrder: submitOrder,
    pollOrderStatus: pollOrderStatus,
    syncMenu: syncMenu,
    startOnlineOrdering: startOnlineOrdering,
  };
})(window);

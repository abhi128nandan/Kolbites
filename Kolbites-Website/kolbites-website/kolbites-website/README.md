# KolBites — Calcutta Culinary · Website

A responsive restaurant ordering site built with semantic HTML5, scoped CSS and vanilla JavaScript. It has no build step and no framework, so it drops into any WordPress theme, Gutenberg HTML block or Elementor HTML widget.

Open `index.html` in a browser to see the complete site working in **demo mode**. In demo mode the cart works, but checkout asks the guest to call 98304 55588 instead of sending the order anywhere.

## Files

```
index.html                         Full page — each section is marked with its WordPress template-part name
assets/css/kolbites.css            All styles, prefixed .kb-  (design tokens at the top)
assets/js/kolbites-menu-data.js    The menu: 12 categories, 81 items, transcribed from the printed card
assets/js/kolbites-pos-adapter.js  Pet Pooja hook points (submit order, status polling, stock sync)
assets/js/kolbites-app.js          Menu rendering, veg filter, cart, option chooser, checkout
assets/data/menu.json              Same menu as JSON — used by the PHP proxy to re-price orders
assets/img/                        Logo (circular PNG), banner (text-free), dish photos, favicon
wordpress/functions-snippet.php    Enqueues assets, passes config via wp_localize_script, Customizer field
wordpress/kolbites-petpooja-proxy.php  Must-use plugin: REST routes + Pet Pooja webhook
```

## Putting it into WordPress

1. **Copy the assets.** Copy `assets/` to `wp-content/themes/<child-theme>/kolbites/assets/`.
2. **Load the snippet.** Paste or require `wordpress/functions-snippet.php` from the child theme's `functions.php`. It enqueues the fonts, CSS and three scripts in the correct order. It also adds the `kb-site` body class, which all the styles are scoped to.
3. **Move the markup into templates.** Split the body markup from `index.html` into template parts, following the comments in the file:

   | Section in index.html | Template part | Gutenberg / Elementor equivalent |
   |---|---|---|
   | `<header class="kb-header">` | `header.php` | Header template / Theme Builder header |
   | `.kb-hero` | `template-parts/hero.php` | Cover block / Section with background image |
   | `.kb-menu` | `template-parts/menu.php` | Custom HTML block / HTML widget |
   | `.kb-about` | `template-parts/about.php` | Media & Text block |
   | `.kb-contact` | `template-parts/contact.php` | Group block / Section |
   | `<footer class="kb-footer">` | `footer.php` | Footer template |
   | Cart, dialogs, toast | `template-parts/cart.php` (include once, before `wp_footer()`) | HTML widget in footer template |

4. **Remove the inline config.** Delete the inline `window.KOLBITES_CONFIG` script in `<head>`; WordPress now supplies it.
5. **Fix image paths.** Change image `src` attributes to `<?php echo esc_url( kolbites_asset_url( 'img/…' ) ); ?>`.

Every interactive element is wired through `data-kb-*` attributes, not IDs or theme classes. That means Elementor or Gutenberg can wrap the markup in extra containers without breaking anything.

## Connecting Pet Pooja

The browser never talks to Pet Pooja directly, because anything in JavaScript is public. The order flow looks like this:

```
Cart (kolbites-app.js)
  → KolBitesPOS.submitOrder()                (kolbites-pos-adapter.js)
  → POST /wp-json/kolbites/v1/order          (kolbites-petpooja-proxy.php — validates, re-prices)
  → Pet Pooja "save order" API               (credentials from wp-config.php)
Pet Pooja → POST /wp-json/kolbites/v1/petpooja-callback   (order status, item on/off)
Site      → GET  /wp-json/kolbites/v1/order-status/{ref}  (shows live status to the guest)
```

Steps:

1. **Get the integration details.** Ask Pet Pooja to enable online-ordering integration for the outlet. They will issue an app key, app secret, access token and restaurant ID, plus their API document.
2. **Link the menu items.** Fill in `posId` for every item in `kolbites-menu-data.js` using the item IDs from Pet Pooja's menu. For Chilli Paneer and Chilli Chicken, also fill in `posVariationId` for the Dry and Gravy choices. Then regenerate `menu.json` from the same data. The proxy refuses any item that has no `posId`, so a half-mapped menu can't create bad orders.
3. **Add credentials.** Add the `define()` lines listed at the top of `kolbites-petpooja-proxy.php` to `wp-config.php`.
4. **Install the proxy.** Copy the proxy to `wp-content/mu-plugins/`.
5. **Match Pet Pooja's field names.** Update `kolbites_map_to_petpooja()` and `kolbites_handle_callback()` to the exact field names and status codes in Pet Pooja's document. They are clearly marked as placeholders.
6. **Register the callback.** Give Pet Pooja the callback URL shown in the proxy header, including your secret.
7. **Test and go live.** Place a test order. Once the `KOLBITES_PETPOOJA_SAVE_ORDER_URL` constant exists, the site switches from demo mode to live ordering automatically.

**Using Pet Pooja's hosted ordering page instead:** If you'd rather use Pet Pooja's own hosted ordering page, paste its link into *Appearance → Customize → KolBites ordering*. "Order Online" will then open that page, and the on-site menu stays as a browsable menu.

## Editing the menu

Edit `kolbites-menu-data.js`. Keep `id` values stable once the site is live.

- **Items sold at MRP:** set `price: null`. They show the counter note and can't be added to the cart.
- **KolBites Special Chowmin items:** these are flagged `signature: true` and are highlighted in maroon.

## Design notes

- **Palette.** It is taken from the logo (brass gold, Ambassador-taxi yellow, paisley brown, parchment) and the banner (ember red, marigold). All tokens are CSS variables at the top of `kolbites.css`.
- **Typefaces.** Cinzel for headings, matching the banner's lettering. Hind Siliguri for text: it's an Indian-designed sans with Bengali support, ready for a Bangla menu later.
- **The menu card.** It's styled like the printed KolBites card, with dotted leaders between each dish and its price, gold corner ornaments, and standard veg/egg/non-veg marks.
- **Hero image.** The supplied banner had the tagline baked into the pixels, which would have doubled up with the live headline. `kolbites-banner-clean.jpg` is a retouched, text-free copy, mirrored so the lit café sits behind the right half of the hero. The original is kept as `kolbites-banner.jpg`. A higher-resolution, text-free export from the designer will look sharper on large screens.
- **Accessibility.** The site respects `prefers-reduced-motion`, shows visible keyboard focus, provides a skip link, uses labelled controls, and announces cart updates with `aria-live`.

## Before launch

- Add opening hours to the contact section (currently "Call for today's hours").
- Replace the four social `href="#"` links in the footer.
- Review the About copy. It's a draft written from the brand and menu.
- Decide on delivery charges and area. The cart note says charges are confirmed when the order is accepted.

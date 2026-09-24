<?php
/**
 * Plugin Name: KolBites — Pet Pooja order proxy
 * Description: Server-side bridge between the KolBites website cart and Pet Pooja. Keeps API credentials off the browser, re-prices orders, and receives Pet Pooja webhooks.
 * Version:     1.0.0
 *
 * Install as a must-use plugin: copy to wp-content/mu-plugins/kolbites-petpooja-proxy.php
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PET POOJA ENDPOINTS & CREDENTIALS — add to wp-config.php, never here │
 * │                                                                      │
 * │   define( 'KOLBITES_PETPOOJA_SAVE_ORDER_URL', 'https://…' );         │
 * │   define( 'KOLBITES_PETPOOJA_APP_KEY',        '…' );                 │
 * │   define( 'KOLBITES_PETPOOJA_APP_SECRET',     '…' );                 │
 * │   define( 'KOLBITES_PETPOOJA_ACCESS_TOKEN',   '…' );                 │
 * │   define( 'KOLBITES_PETPOOJA_REST_ID',        '…' );                 │
 * │   define( 'KOLBITES_WEBHOOK_SECRET',          'long-random-string' );│
 * │   define( 'KOLBITES_MENU_JSON', ABSPATH . 'wp-content/themes/…/kolbites/assets/data/menu.json' );
 * │                                                                      │
 * │ Pet Pooja provides the real URLs, field names and status codes in    │
 * │ its integration document when your outlet is onboarded. Update       │
 * │ kolbites_map_to_petpooja() and kolbites_handle_callback() to match.  │
 * │                                                                      │
 * │ Give Pet Pooja this callback URL (with your secret):                 │
 * │   https://YOUR-SITE/wp-json/kolbites/v1/petpooja-callback?secret=…   │
 * └──────────────────────────────────────────────────────────────────────┘
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', function () {
	register_rest_route( 'kolbites/v1', '/order', array(
		'methods'             => 'POST',
		'callback'            => 'kolbites_rest_create_order',
		'permission_callback' => 'kolbites_rest_verify_nonce',
	) );
	register_rest_route( 'kolbites/v1', '/order-status/(?P<id>[A-Za-z0-9_-]{3,64})', array(
		'methods'             => 'GET',
		'callback'            => 'kolbites_rest_order_status',
		'permission_callback' => '__return_true',
	) );
	register_rest_route( 'kolbites/v1', '/menu-status', array(
		'methods'             => 'GET',
		'callback'            => 'kolbites_rest_menu_status',
		'permission_callback' => '__return_true',
	) );
	register_rest_route( 'kolbites/v1', '/petpooja-callback', array(
		'methods'             => 'POST',
		'callback'            => 'kolbites_handle_callback',
		'permission_callback' => 'kolbites_verify_webhook_secret',
	) );
} );

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

function kolbites_rest_verify_nonce( WP_REST_Request $request ) {
	$nonce = $request->get_header( 'X-WP-Nonce' );
	if ( ! $nonce || ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
		return new WP_Error( 'kolbites_bad_nonce', 'Your session expired. Refresh the page and try again.', array( 'status' => 403 ) );
	}
	// Simple rate limit: 5 orders per 10 minutes per IP.
	$ip   = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : 'unknown';
	$key  = 'kolbites_rl_' . md5( $ip );
	$hits = (int) get_transient( $key );
	if ( $hits >= 5 ) {
		return new WP_Error( 'kolbites_rate_limited', 'Too many orders from this connection. Please call 98304 55588.', array( 'status' => 429 ) );
	}
	set_transient( $key, $hits + 1, 10 * MINUTE_IN_SECONDS );
	return true;
}

function kolbites_verify_webhook_secret( WP_REST_Request $request ) {
	if ( ! defined( 'KOLBITES_WEBHOOK_SECRET' ) || ! KOLBITES_WEBHOOK_SECRET ) {
		return false;
	}
	$given = $request->get_header( 'X-KolBites-Secret' );
	if ( ! $given ) {
		$given = (string) $request->get_param( 'secret' );
	}
	return hash_equals( KOLBITES_WEBHOOK_SECRET, (string) $given );
}

/* ------------------------------------------------------------------ */
/* Menu (server-side source of truth for prices)                        */
/* ------------------------------------------------------------------ */

function kolbites_menu_index() {
	static $index = null;
	if ( null !== $index ) {
		return $index;
	}
	$index = array();
	$file  = defined( 'KOLBITES_MENU_JSON' ) ? KOLBITES_MENU_JSON : get_stylesheet_directory() . '/kolbites/assets/data/menu.json';
	if ( ! file_exists( $file ) ) {
		return $index;
	}
	$menu = json_decode( file_get_contents( $file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	foreach ( (array) ( $menu['categories'] ?? array() ) as $cat ) {
		foreach ( (array) ( $cat['items'] ?? array() ) as $item ) {
			$index[ $item['id'] ] = $item;
		}
	}
	return $index;
}

/* ------------------------------------------------------------------ */
/* POST /order                                                         */
/* ------------------------------------------------------------------ */

function kolbites_rest_create_order( WP_REST_Request $request ) {
	foreach ( array( 'KOLBITES_PETPOOJA_SAVE_ORDER_URL', 'KOLBITES_PETPOOJA_APP_KEY', 'KOLBITES_PETPOOJA_APP_SECRET', 'KOLBITES_PETPOOJA_ACCESS_TOKEN', 'KOLBITES_PETPOOJA_REST_ID' ) as $const ) {
		if ( ! defined( $const ) || ! constant( $const ) ) {
			return new WP_Error( 'kolbites_not_configured', 'Online ordering is not set up yet. Please call 98304 55588.', array( 'status' => 503 ) );
		}
	}
	$body  = $request->get_json_params();
	$menu  = kolbites_menu_index();
	$off   = (array) get_option( 'kolbites_unavailable_items', array() );
	$lines = array();
	$total = 0;

	// Customer
	$name    = sanitize_text_field( $body['customer']['name'] ?? '' );
	$phone   = preg_replace( '/\D/', '', (string) ( $body['customer']['phone'] ?? '' ) );
	$type    = in_array( $body['orderType'] ?? '', array( 'pickup', 'delivery' ), true ) ? $body['orderType'] : 'pickup';
	$address = sanitize_textarea_field( $body['customer']['address'] ?? '' );
	$notes   = sanitize_text_field( $body['customer']['notes'] ?? '' );

	if ( '' === $name || ! preg_match( '/^[6-9]\d{9}$/', $phone ) ) {
		return new WP_Error( 'kolbites_bad_customer', 'Enter your name and a 10-digit mobile number.', array( 'status' => 400 ) );
	}
	if ( 'delivery' === $type && '' === $address ) {
		return new WP_Error( 'kolbites_no_address', 'Enter a delivery address.', array( 'status' => 400 ) );
	}

	// Items — re-priced from the server menu; client prices are ignored.
	foreach ( (array) ( $body['items'] ?? array() ) as $raw ) {
		$id  = sanitize_key( $raw['id'] ?? '' );
		$qty = (int) ( $raw['quantity'] ?? 0 );
		if ( ! isset( $menu[ $id ] ) || $qty < 1 || $qty > 25 ) {
			return new WP_Error( 'kolbites_bad_item', 'One of the items in your cart is no longer on the menu. Refresh and try again.', array( 'status' => 400 ) );
		}
		$item = $menu[ $id ];
		if ( null === $item['price'] || in_array( $id, $off, true ) ) {
			return new WP_Error( 'kolbites_unavailable', $item['name'] . ' is not available right now.', array( 'status' => 409 ) );
		}
		if ( empty( $item['posId'] ) ) {
			return new WP_Error( 'kolbites_unmapped', $item['name'] . ' is not linked to the POS yet. Please call 98304 55588.', array( 'status' => 500 ) );
		}
		$variation = null;
		if ( ! empty( $item['options'] ) ) {
			foreach ( $item['options']['choices'] as $choice ) {
				if ( ( $raw['optionId'] ?? '' ) === $choice['id'] ) {
					$variation = $choice;
				}
			}
			if ( ! $variation ) {
				return new WP_Error( 'kolbites_no_option', 'Choose ' . strtolower( $item['options']['label'] ) . ' for ' . $item['name'] . '.', array( 'status' => 400 ) );
			}
		}
		$lines[] = array(
			'item'      => $item,
			'variation' => $variation,
			'qty'       => $qty,
			'lineTotal' => $item['price'] * $qty,
		);
		$total += $item['price'] * $qty;
	}

	if ( ! $lines ) {
		return new WP_Error( 'kolbites_empty', 'Your cart is empty.', array( 'status' => 400 ) );
	}

	$ref   = 'KB' . gmdate( 'ymdHis' ) . wp_rand( 10, 99 );
	$order = compact( 'ref', 'name', 'phone', 'type', 'address', 'notes', 'lines', 'total' );
	$order['payment'] = sanitize_key( $body['payment']['method'] ?? 'pay_on_collection' );

	/**
	 * HOOK ▸ Send to Pet Pooja.
	 */
	$response = wp_remote_post( KOLBITES_PETPOOJA_SAVE_ORDER_URL, array(
		'timeout' => 15,
		'headers' => array( 'Content-Type' => 'application/json' ),
		'body'    => wp_json_encode( kolbites_map_to_petpooja( $order ) ),
	) );

	if ( is_wp_error( $response ) ) {
		return new WP_Error( 'kolbites_pos_unreachable', 'We couldn\'t reach the kitchen system.', array( 'status' => 502 ) );
	}
	$code = wp_remote_retrieve_response_code( $response );
	$data = json_decode( wp_remote_retrieve_body( $response ), true );

	// Adjust success detection to Pet Pooja's documented response (e.g. a "success" flag and an order ID).
	$ok         = $code >= 200 && $code < 300 && ! empty( $data ) && ( ! isset( $data['success'] ) || (string) $data['success'] === '1' || true === $data['success'] );
	$pos_order  = $data['orderID'] ?? $data['order_id'] ?? $ref;

	if ( ! $ok ) {
		error_log( 'KolBites Pet Pooja error: ' . wp_remote_retrieve_body( $response ) ); // phpcs:ignore
		return new WP_Error( 'kolbites_pos_rejected', 'The kitchen system didn\'t accept the order.', array( 'status' => 502 ) );
	}

	set_transient( 'kolbites_order_' . $ref, array( 'status' => 'placed', 'label' => 'Sent to kitchen', 'posOrderId' => $pos_order ), DAY_IN_SECONDS );
	if ( $pos_order !== $ref ) {
		set_transient( 'kolbites_posmap_' . $pos_order, $ref, DAY_IN_SECONDS );
	}

	return rest_ensure_response( array( 'ok' => true, 'orderId' => $ref, 'total' => $total ) );
}

/**
 * HOOK ▸ Map the neutral order to Pet Pooja's "save order" payload.
 * The keys below are PLACEHOLDERS — replace them with the exact structure
 * from Pet Pooja's integration document (it typically groups restaurant,
 * customer, order and item details, and requires app key/secret/token).
 */
function kolbites_map_to_petpooja( array $order ) {
	$items = array();
	foreach ( $order['lines'] as $line ) {
		$entry = array(
			'id'       => $line['item']['posId'],
			'name'     => $line['item']['name'],
			'price'    => (string) $line['item']['price'],
			'quantity' => (string) $line['qty'],
			'total'    => (string) $line['lineTotal'],
		);
		if ( $line['variation'] ) {
			$entry['variation_id']   = $line['variation']['posVariationId'];
			$entry['variation_name'] = $line['variation']['name'];
		}
		$items[] = $entry;
	}

	return array(
		'app_key'      => KOLBITES_PETPOOJA_APP_KEY,
		'app_secret'   => KOLBITES_PETPOOJA_APP_SECRET,
		'access_token' => KOLBITES_PETPOOJA_ACCESS_TOKEN,
		'restaurant'   => array( 'restID' => KOLBITES_PETPOOJA_REST_ID ),
		'customer'     => array(
			'name'    => $order['name'],
			'phone'   => $order['phone'],
			'address' => $order['address'],
		),
		'order'        => array(
			'orderID'      => $order['ref'],
			'order_type'   => 'delivery' === $order['type'] ? 'H' : 'P', // placeholder codes: confirm with Pet Pooja
			'payment_type' => 'COD',
			'total'        => (string) $order['total'],
			'description'  => $order['notes'],
			'created_on'   => current_time( 'mysql' ),
			'callback_url' => rest_url( 'kolbites/v1/petpooja-callback' ) . ( defined( 'KOLBITES_WEBHOOK_SECRET' ) ? '?secret=' . rawurlencode( KOLBITES_WEBHOOK_SECRET ) : '' ),
		),
		'items'        => $items,
	);
}

/* ------------------------------------------------------------------ */
/* GET /order-status/{id}  and  GET /menu-status                       */
/* ------------------------------------------------------------------ */

function kolbites_rest_order_status( WP_REST_Request $request ) {
	$status = get_transient( 'kolbites_order_' . $request['id'] );
	if ( ! $status ) {
		return new WP_Error( 'kolbites_unknown_order', 'Order not found.', array( 'status' => 404 ) );
	}
	return rest_ensure_response( array( 'status' => $status['status'], 'label' => $status['label'] ) );
}

function kolbites_rest_menu_status() {
	return rest_ensure_response( array(
		'unavailable' => array_values( (array) get_option( 'kolbites_unavailable_items', array() ) ),
		'prices'      => (object) array(),
	) );
}

/* ------------------------------------------------------------------ */
/* POST /petpooja-callback  (webhook from Pet Pooja)                   */
/* ------------------------------------------------------------------ */

/**
 * HOOK ▸ Pet Pooja webhook. Handles two kinds of events:
 *   1. Order status changes → stored for the site's status poll
 *   2. Item in-stock / out-of-stock toggles → hides "Add" on the menu
 * Field names and status codes are PLACEHOLDERS; align them with Pet Pooja's spec.
 */
function kolbites_handle_callback( WP_REST_Request $request ) {
	$data = $request->get_json_params();
	if ( empty( $data ) ) {
		$data = $request->get_body_params();
	}

	// 1) Order status
	if ( isset( $data['orderID'] ) || isset( $data['order_id'] ) ) {
		$pos_id = sanitize_text_field( $data['orderID'] ?? $data['order_id'] );
		$ref    = get_transient( 'kolbites_posmap_' . $pos_id );
		$ref    = $ref ? $ref : $pos_id;
		$labels = array( // placeholder status codes → guest-facing labels
			'1'  => 'Accepted',
			'2'  => 'Accepted',
			'3'  => 'Being prepared',
			'4'  => 'Ready for pickup',
			'5'  => 'Out for delivery',
			'10' => 'Delivered',
			'-1' => 'Cancelled — please call us',
		);
		$code = (string) ( $data['status'] ?? '' );
		set_transient( 'kolbites_order_' . $ref, array(
			'status' => $code,
			'label'  => $labels[ $code ] ?? 'Updated',
		), DAY_IN_SECONDS );
		return rest_ensure_response( array( 'success' => '1' ) );
	}

	// 2) Item stock toggle
	if ( isset( $data['itemID'] ) || isset( $data['item_ids'] ) ) {
		$pos_ids = (array) ( $data['item_ids'] ?? array( $data['itemID'] ) );
		$in      = ! empty( $data['inStock'] ) || ( isset( $data['type'] ) && 'item-on' === $data['type'] );
		$off     = (array) get_option( 'kolbites_unavailable_items', array() );
		foreach ( kolbites_menu_index() as $site_id => $item ) {
			if ( in_array( (string) $item['posId'], array_map( 'strval', $pos_ids ), true ) ) {
				$off = $in ? array_diff( $off, array( $site_id ) ) : array_unique( array_merge( $off, array( $site_id ) ) );
			}
		}
		update_option( 'kolbites_unavailable_items', array_values( $off ), false );
		return rest_ensure_response( array( 'success' => '1' ) );
	}

	return new WP_Error( 'kolbites_unknown_event', 'Unrecognised callback payload.', array( 'status' => 400 ) );
}

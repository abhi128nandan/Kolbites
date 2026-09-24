<?php
/**
 * KolBites — theme integration
 * ------------------------------------------------------------------
 * Paste into your (child) theme's functions.php, or require it:
 *     require_once get_stylesheet_directory() . '/kolbites/wordpress/functions-snippet.php';
 *
 * Assumes the /assets folder from this package is copied to:
 *     wp-content/themes/<your-child-theme>/kolbites/assets/
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'KOLBITES_VERSION', '1.0.0' );

function kolbites_asset_url( $path ) {
	return get_stylesheet_directory_uri() . '/kolbites/assets/' . ltrim( $path, '/' );
}

add_action( 'wp_enqueue_scripts', function () {
	// Fonts: Cinzel (display) + Hind Siliguri (text).
	wp_enqueue_style(
		'kolbites-fonts',
		'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Hind+Siliguri:wght@400;500;600&display=swap',
		array(),
		null
	);

	wp_enqueue_style( 'kolbites', kolbites_asset_url( 'css/kolbites.css' ), array( 'kolbites-fonts' ), KOLBITES_VERSION );

	wp_enqueue_script( 'kolbites-menu-data', kolbites_asset_url( 'js/kolbites-menu-data.js' ), array(), KOLBITES_VERSION, true );
	wp_enqueue_script( 'kolbites-pos', kolbites_asset_url( 'js/kolbites-pos-adapter.js' ), array( 'kolbites-menu-data' ), KOLBITES_VERSION, true );
	wp_enqueue_script( 'kolbites-app', kolbites_asset_url( 'js/kolbites-app.js' ), array( 'kolbites-pos' ), KOLBITES_VERSION, true );

	// Public, non-secret config for the browser. Pet Pooja credentials are NOT here —
	// they live in wp-config.php and are used only by kolbites-petpooja-proxy.php.
	$proxy_ready = defined( 'KOLBITES_PETPOOJA_SAVE_ORDER_URL' ) && KOLBITES_PETPOOJA_SAVE_ORDER_URL;
	wp_localize_script( 'kolbites-menu-data', 'KOLBITES_CONFIG', array(
		'restaurantPhone'     => '9830455588',
		'orderEndpoint'       => $proxy_ready ? rest_url( 'kolbites/v1/order' ) : '',
		'orderStatusEndpoint' => $proxy_ready ? rest_url( 'kolbites/v1/order-status/' ) : '',
		'menuStatusEndpoint'  => $proxy_ready ? rest_url( 'kolbites/v1/menu-status' ) : '',
		'hostedOrderingUrl'   => get_theme_mod( 'kolbites_hosted_ordering_url', '' ),
		'wpNonce'             => wp_create_nonce( 'wp_rest' ),
	) );

	// Optional: override the menu from a JSON file or ACF / custom post type.
	// $menu = json_decode( file_get_contents( get_stylesheet_directory() . '/kolbites/assets/data/menu.json' ), true );
	// wp_localize_script( 'kolbites-menu-data', 'KOLBITES_MENU', $menu );
} );

// Body class so the scoped .kb-site styles apply inside any theme.
add_filter( 'body_class', function ( $classes ) {
	$classes[] = 'kb-site';
	return $classes;
} );

// Customizer field for Pet Pooja's hosted ordering link (used by "Order Online").
add_action( 'customize_register', function ( $wp_customize ) {
	$wp_customize->add_section( 'kolbites', array( 'title' => 'KolBites ordering' ) );
	$wp_customize->add_setting( 'kolbites_hosted_ordering_url', array( 'sanitize_callback' => 'esc_url_raw' ) );
	$wp_customize->add_control( 'kolbites_hosted_ordering_url', array(
		'label'       => 'Pet Pooja online ordering link (optional)',
		'description' => 'If set, "Order Online" opens this link. Leave empty to use the on-site menu and cart.',
		'section'     => 'kolbites',
		'type'        => 'url',
	) );
} );

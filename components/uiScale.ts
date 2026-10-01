import { useEffect, useState } from 'preact/hooks';

/*
 * Viewport-adaptive UI scale.
 *
 * The layout is authored against a 2560px-wide desktop viewport (a maximized
 * browser on a 1440p monitor at 100% OS scaling). Other displays scale the whole
 * document with CSS `zoom` so they see the same composition, and fluid layout
 * rules absorb whatever difference is left. All sizes below are CSS px; "design
 * px" means CSS px after the zoom is applied.
 *
 * At the reference size the zoom is exactly 1 and no attributes are set, so the
 * reference layout renders exactly as authored.
 */

const REFERENCE_WIDTH = 2560;
// Upscaling only kicks in once the viewport is taller than this as well, so that
// ultrawide 1440p monitors keep the native size and use the extra width instead.
const UPSCALE_MIN_HEIGHT = 1313;
// Smallest design size the full layout is comfortable at before shrinking.
const FIT_WIDTH = 2304;
const FIT_HEIGHT = 1136;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2;

// Widest the app shell grows (design px); wider viewports center it.
export const MAX_APP_WIDTH = REFERENCE_WIDTH;
// Below this design width the uma column stacks above the main column.
export const STACKED_MAX_WIDTH = 1500;
// Below this design height the left column scrolls instead of squeezing the uma pane.
export const COMPACT_MAX_HEIGHT = 1080;

// Horizontal space the shell takes around the main column: 14px gutters on both
// sides, plus the 640px uma column and 14px gap when they sit side by side.
const SHELL_GUTTERS = 28;
const LEFT_COLUMN_SPAN = 640 + 14;

// Main column width tiers that results/charts reflow at (upper bounds, design px).
// 'large' covers everything narrower than the reference main column (1878px).
const MAIN_TIERS: [UiMainTier, number][] = [['tiny', 760], ['narrow', 1100], ['medium', 1280], ['large', 1830]];

export type UiLayout = 'columns' | 'stacked';
export type UiMainTier = 'wide' | 'large' | 'medium' | 'narrow' | 'tiny';

export interface UiViewport {
	zoom: number;
	/** Viewport size in design px. */
	width: number;
	height: number;
	layout: UiLayout;
	compactHeight: boolean;
	/** Width of the main (track + results) column in design px. */
	mainWidth: number;
	mainTier: UiMainTier;
}

export function computeUiZoom(width: number, height: number): number {
	if (!(width > 0 && height > 0)) return 1;
	const fit = Math.min(width / FIT_WIDTH, height / FIT_HEIGHT);
	let zoom: number;
	if (fit < 1) {
		zoom = Math.max(MIN_ZOOM, fit);
	} else {
		zoom = Math.min(MAX_ZOOM, Math.max(1, Math.min(width / REFERENCE_WIDTH, height / UPSCALE_MIN_HEIGHT)));
	}
	// Round toward 1 in hundredths so layout lands on stable fractional sizes.
	return zoom < 1 ? Math.ceil(zoom * 100) / 100 : Math.floor(zoom * 100) / 100;
}

function describe(zoom: number, width: number, height: number): UiViewport {
	const layout: UiLayout = width < STACKED_MAX_WIDTH ? 'stacked' : 'columns';
	const shellWidth = Math.min(width, MAX_APP_WIDTH) - SHELL_GUTTERS;
	const mainWidth = layout == 'stacked' ? shellWidth : shellWidth - LEFT_COLUMN_SPAN;
	const tier = MAIN_TIERS.find(([_, max]) => mainWidth < max);
	return {
		zoom,
		width,
		height,
		layout,
		compactHeight: height < COMPACT_MAX_HEIGHT,
		mainWidth,
		mainTier: tier ? tier[0] : 'wide'
	};
}

function measure(): UiViewport {
	const zoom = computeUiZoom(window.innerWidth, window.innerHeight);
	return describe(zoom, window.innerWidth / zoom, window.innerHeight / zoom);
}

function sameViewport(a: UiViewport, b: UiViewport) {
	return a.zoom == b.zoom && a.width == b.width && a.height == b.height;
}

let current: UiViewport = typeof window === 'undefined'
	? describe(1, REFERENCE_WIDTH, UPSCALE_MIN_HEIGHT)
	: measure();
const listeners = new Set<(v: UiViewport) => void>();

function applyToDocument(v: UiViewport) {
	const root = document.documentElement;
	if (v.zoom == 1) {
		root.style.removeProperty('zoom');
		root.style.removeProperty('--ui-zoom');
	} else {
		root.style.setProperty('zoom', String(v.zoom));
		root.style.setProperty('--ui-zoom', String(v.zoom));
	}
	if (v.layout == 'stacked') {
		root.setAttribute('data-ui-layout', 'stacked');
	} else {
		root.removeAttribute('data-ui-layout');
	}
	if (v.compactHeight) {
		root.setAttribute('data-ui-height', 'compact');
	} else {
		root.removeAttribute('data-ui-height');
	}
	if (v.mainTier != 'wide') {
		root.setAttribute('data-ui-main', v.mainTier);
	} else {
		root.removeAttribute('data-ui-main');
	}
}

let installed = false;

/** Applies the scale to the document and keeps it in sync with the window size. */
export function installUiScale() {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	applyToDocument(current);
	let frame = 0;
	const update = () => {
		frame = 0;
		const next = measure();
		if (sameViewport(next, current)) return;
		current = next;
		applyToDocument(current);
		listeners.forEach(fn => fn(current));
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(update);
	};
	window.addEventListener('resize', schedule);
}

export function getUiViewport(): UiViewport {
	return current;
}

export function useUiViewport(): UiViewport {
	const [viewport, setViewport] = useState(current);
	useEffect(() => {
		listeners.add(setViewport);
		setViewport(current);
		return () => { listeners.delete(setViewport); };
	}, []);
	return viewport;
}

/**
 * Ratio between on-screen (getBoundingClientRect / mouse event) pixels and the
 * element's own CSS pixels. 1 at the reference size.
 */
export function visualScale(el?: Element | null): number {
	const z = el && (el as any).currentCSSZoom;
	return typeof z == 'number' && z > 0 ? z : current.zoom;
}

function detectBasePath(): string {
	if (typeof window === 'undefined') return '';
	const pathname = window.location.pathname || '/';
	const marker = '/uma-tools/';
	const markerIdx = pathname.indexOf(marker);
	if (markerIdx >= 0) {
		return pathname.slice(0, markerIdx);
	}
	if (window.location.hostname.endsWith('github.io')) {
		const firstSegment = pathname.split('/').filter(Boolean)[0];
		if (firstSegment) return `/${firstSegment}`;
	}
	return '';
}

const BASE_PATH = detectBasePath();

export function withBasePath(url: string): string {
	if (!url) return url;
	if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
		return url;
	}
	if (!url.startsWith('/')) {
		return `${BASE_PATH}/${url}`;
	}
	return `${BASE_PATH}${url}`;
}

export function umaToolsAsset(relativePath: string): string {
	const normalized = relativePath.replace(/^\/+/, '');
	return withBasePath(`/uma-tools/${normalized}`);
}

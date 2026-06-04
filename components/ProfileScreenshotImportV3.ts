import { createWorker } from 'tesseract.js';

import skilldata from '../uma-skill-tools/data/skill_data.json';
import globalSkillNames from '../umalator-global/skillnames.json';
import globalSkillMeta from '../umalator-global/skill_meta.json';
import umas from '../umalator/umas.json';

type StatKey = 'speed' | 'stamina' | 'power' | 'guts' | 'wisdom';

export interface ImportScreenshotInput {
	id: string;
	name: string;
	dataUrl: string;
}

export interface SkillMatchCandidate {
	skillId: string;
	name: string;
	score: number;
}

export interface UnknownSkillPrompt {
	id: string;
	screenshotId: string;
	screenshotName: string;
	rawText: string;
	cropDataUrl: string;
	candidates: SkillMatchCandidate[];
}

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface OcrWorkers {
	stat: any;
	skillLeft: any;
	skillRight: any;
}

interface SkillLine {
	text: string;
	bbox: { x0: number; y0: number; x1: number; y1: number };
	column: 'left' | 'right';
}

interface UniqueSignal {
	skillId: string;
	score: number;
	source: 'probe' | 'line';
	y: number;
	hasLevel: boolean;
}

interface UniquePromptCleanupContext {
	uniqueSkillId: string | null;
	firstScreenshotId: string | null;
}

export interface ProfileImportDraft {
	stats: Partial<Record<StatKey, number>>;
	uniqueSkillId: string | null;
	uniqueLevel: number | null;
	outfitId: string | null;
	skillIds: string[];
	unknownSkills: UnknownSkillPrompt[];
	warnings: string[];
	debug?: {
		screenshots: Array<{
			name: string;
			panelWidth: number;
			panelHeight: number;
			statRect: Rect;
			statText: string;
			statNumbers: number[];
			leftSkillRect: Rect;
			rightSkillRect: Rect;
			lines: Array<{ column: 'left' | 'right'; text: string; y: number }>;
		}>;
	};
}

const CANONICAL_WIDTH = 1138;
const STAT_RECT = Object.freeze({ x: 52, y: 490, w: 1063, h: 72 });
const STAT_SLOT_INSET_X = 14;
const STAT_SLOT_INSET_Y = 8;
const SKILL_LEFT_TEXT_RECT = Object.freeze({ x: 112, y: 0, w: 438, h: 0 });
const SKILL_RIGHT_TEXT_RECT = Object.freeze({ x: 647, y: 0, w: 438, h: 0 });
const SKILL_BLOCK_BOTTOM_PCT_FROM_BOTTOM = 0.10;
const SKILL_BLOCK_TOP_PCT_FROM_BOTTOM_DEFAULT = 0.54;
const SKILL_BLOCK_TOP_PCT_FROM_BOTTOM_PARTNER = 0.44;
const PARTNER_PROBE_TOP_PCT_FROM_BOTTOM = 0.60;
const PARTNER_PROBE_BOTTOM_PCT_FROM_BOTTOM = 0.50;
const PARTNER_PROBE_LEFT_PCT = 0.18;
const PARTNER_PROBE_RIGHT_PCT = 0.82;
const SKILL_VERTICAL_PAD = 28;
const SKILL_TEXT_LEFT_PAD = 0;
const SKILL_TEXT_LEFT_EXPAND = 4;
const SKILL_TEXT_RIGHT_TRIM = 0;
const SKILL_TILE_RELATIVE_HEIGHT_PCT = 0.05;
const SKILL_TILE_MERGE_HEIGHT_TOLERANCE = 1.35;
const UNIQUE_PROBE_UPWARD_BUFFER_PCT = 0.04;
const UNIQUE_PROBE_HEIGHT_PCT = 0.08;
const UNIQUE_TOP_ROW_MAX_OFFSET_PCT = 0.07;
const UNIQUE_LINE_SCAN_HEIGHT_PCT = 0.10;
const UNIQUE_PARTNER_TOP_PCT = 0.37;
const UNIQUE_PARTNER_BOTTOM_PCT = 0.44;

const AUTO_ACCEPT_SCORE = 0.88;
const AUTO_ACCEPT_MARGIN = 0.03;
const HIGH_CONFIDENCE_SCORE = 0.965;
const SKILL_UI_BANNED_FRAGMENTS = Object.freeze([
	'skills',
	'inspiration',
	'career info'
]);

const canonicalSkillEntries = Object.keys(globalSkillNames)
	.filter(skillId => skilldata[skillId] != null && globalSkillMeta[skillId] != null)
	.map(skillId => ({ skillId, name: (globalSkillNames[skillId] || [])[0] || '' }))
	.filter(entry => entry.name.length > 0);

const uniqueSkillToOutfit = (() => {
	const map: Record<string, string> = {};
	Object.keys(umas).forEach(umaId => {
		const outfits = umas[umaId]?.outfits || {};
		Object.keys(outfits).forEach(outfitId => {
			const i = Number(outfitId.slice(1, -2));
			const v = Number(outfitId.slice(-2));
			if (!Number.isFinite(i) || !Number.isFinite(v)) return;
			const skillId = String(100000 + (10000 * (v - 1)) + (i * 10) + 1);
			if (skilldata[skillId] != null) map[skillId] = outfitId;
		});
	});
	return map;
})();

const inheritedUniqueByBaseName = (() => {
	const map: Record<string, string> = {};
	Object.keys(globalSkillNames).forEach(skillId => {
		const name = (globalSkillNames[skillId] || [])[0] || '';
		if (!/\(inherited\)/i.test(name)) return;
		const base = normalizeSkillText(name.replace(/\(inherited\)/ig, '').trim()).replace(/[◎○×]/g, '');
		if (base) map[base] = skillId;
	});
	return map;
})();

function clampStat(value: number): number {
	return Math.min(2000, Math.max(1, Math.round(value)));
}

function normalizeSkillText(raw: string): string {
	return String(raw || '')
		.toLowerCase()
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/[^\p{L}\p{N}○◎×+*#=.!?'":☆♡∞/ -]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeForDistance(raw: string): string {
	return normalizeSkillText(raw)
		.replace(/\(inherited\)/ig, '')
		.replace(/lvl\.?\s*\d/gi, '')
		.trim();
}

function normalizeForVerbatimMatch(raw: string): string {
	return normalizeSkillText(raw)
		.replace(/\(inherited\)/ig, '')
		.replace(/lvl\.?\s*\d/gi, '')
		.replace(/[◎○×]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeWordToken(raw: string): string {
	let token = normalizeForVerbatimMatch(raw).replace(/[^a-z0-9]/g, '');
	if (token.endsWith('ies') && token.length > 4) token = `${token.slice(0, -3)}y`;
	else if (token.endsWith('es') && token.length > 4) token = token.slice(0, -2);
	else if (token.endsWith('s') && token.length > 3) token = token.slice(0, -1);
	return token;
}

function tokenizeVerbatim(raw: string): string[] {
	return normalizeForVerbatimMatch(raw)
		.split(' ')
		.map(normalizeWordToken)
		.filter(token => token.length >= 2);
}

function tokenFullyContained(queryText: string, candidateText: string): boolean {
	const queryTokens = tokenizeVerbatim(queryText);
	if (queryTokens.length === 0) return false;
	const candidateTokens = tokenizeVerbatim(candidateText);
	if (candidateTokens.length === 0) return false;
	return queryTokens.every(queryToken => candidateTokens.includes(queryToken));
}

function isLikelyUiText(raw: string): boolean {
	const t = normalizeSkillText(raw);
	if (!t) return true;
	if (SKILL_UI_BANNED_FRAGMENTS.some(fragment => t.includes(fragment))) return true;
	// Match "close" as a full word only so skills like "Blue Rose Closer" survive.
	return /\bclose\b/.test(t);
}

function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const costs = new Array(b.length + 1).fill(0);
	for (let i = 0; i <= b.length; i++) costs[i] = i;
	for (let i = 1; i <= a.length; i++) {
		let prev = i - 1;
		costs[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cur = costs[j];
			const sub = prev + (a[i - 1] === b[j - 1] ? 0 : 1);
			const ins = costs[j] + 1;
			const del = costs[j - 1] + 1;
			costs[j] = Math.min(sub, ins, del);
			prev = cur;
		}
	}
	return costs[b.length];
}

function similarity(a: string, b: string): number {
	const x = normalizeForDistance(a);
	const y = normalizeForDistance(b);
	if (!x || !y) return 0;
	if (x === y) return 1;
	const dist = levenshteinDistance(x, y);
	return 1 - (dist / Math.max(x.length, y.length));
}

function isUniqueRarity(skillId: string): boolean {
	const rarity = skilldata[skillId]?.rarity;
	return rarity > 2 && rarity < 6;
}

export function getSkillCandidates(rawText: string, limit = 5): SkillMatchCandidate[] {
	const text = normalizeSkillText(rawText);
	if (!text) return [];
	const allScored = canonicalSkillEntries
		.map(({ skillId, name }) => ({ skillId, name, score: similarity(text, name) }))
		.sort((a, b) => b.score - a.score);
	let filtered = allScored;
	const normalizedQuery = normalizeForVerbatimMatch(text);
	const fullPhraseMatches = filtered.filter(candidate => normalizeForVerbatimMatch(candidate.name).includes(normalizedQuery));
	if (fullPhraseMatches.length > 0) {
		filtered = fullPhraseMatches;
	} else {
		const tokenContained = filtered.filter(candidate => tokenFullyContained(text, candidate.name));
		// Fallback only when OCR text is too noisy to preserve all tokens.
		if (tokenContained.length > 0) filtered = tokenContained;
	}
	return filtered.slice(0, limit);
}

function getUniqueSkillCandidates(rawText: string, limit = 5, mappableOnly = false): SkillMatchCandidate[] {
	const text = normalizeSkillText(rawText);
	if (!text) return [];
	// Unique detection intentionally avoids phrase gates so words like "Closer"
	// don't get over-constrained by generic candidate filters.
	return canonicalSkillEntries
		.map(({ skillId, name }) => ({ skillId, name, score: similarity(text, name) }))
		.filter(candidate => {
			if (!isUniqueRarity(candidate.skillId) || candidate.skillId.startsWith('9')) return false;
			if (!mappableOnly) return true;
			return uniqueSkillToOutfit[candidate.skillId] != null;
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}

export function parseStatsFromText(text: string): ProfileImportDraft['stats'] {
	const nums = Array.from(String(text || '').matchAll(/\b(\d{2,4})\b/g)).map(m => Number(m[1])).filter(n => n >= 1 && n <= 2000);
	const stats: ProfileImportDraft['stats'] = {};
	(['speed', 'stamina', 'power', 'guts', 'wisdom'] as StatKey[]).forEach((key, idx) => {
		if (nums[idx] != null) stats[key] = clampStat(nums[idx]);
	});
	return stats;
}

function parseUniqueLevel(text: string): number | null {
	const m = /l[vy][il1]?[.\s:-]*([0-9])/i.exec(text || '');
	if (!m) return null;
	const n = Number(m[1]);
	return Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : null;
}

function parseBestStatValue(text: string): number | null {
	const values = Array.from(String(text || '').matchAll(/\b(\d{2,4})\b/g))
		.map(m => Number(m[1]))
		.filter(n => n >= 1 && n <= 2000);
	if (!values.length) return null;
	// Prefer the strongest numeric token when OCR includes extra fragments.
	return clampStat(Math.max(...values));
}

function sanitizeSkillLineText(raw: string): string {
	const tokens = String(raw || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
	if (!tokens.length) return '';
	const last = tokens[tokens.length - 1];
	// Border OCR often appears as a trailing singleton token.
	if ((last === '7' || last === '|' || last === '¦' || last === 'I' || last === 'l') && tokens.length > 1) {
		tokens.pop();
	}
	return tokens.join(' ').trim();
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = width;
	c.height = height;
	return c;
}

function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load screenshot image.'));
		img.src = dataUrl;
	});
}

function panelBoundsFromPixels(image: HTMLImageElement): { x: number; y: number; w: number; h: number } {
	// Minimal robust bounds: keep full image if detection fails.
	const c = makeCanvas(image.naturalWidth, image.naturalHeight);
	const ctx = c.getContext('2d');
	if (!ctx) return { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
	ctx.drawImage(image, 0, 0);
	const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
	const at = (x: number, y: number) => {
		const i = ((y * width) + x) * 4;
		return { r: data[i], g: data[i + 1], b: data[i + 2] };
	};
	let top = -1, bottom = -1, left = -1, right = -1;
	for (let y = 0; y < height; y++) {
		let green = 0;
		for (let x = 0; x < width; x += 3) {
			const p = at(x, y);
			if (p.r >= 90 && p.r <= 190 && p.g >= 150 && p.g <= 255 && p.b <= 150) green++;
		}
		if (green > (width / 3) * 0.2) { top = y; break; }
	}
	for (let y = height - 1; y >= 0; y--) {
		let white = 0;
		for (let x = 0; x < width; x += 3) {
			const p = at(x, y);
			if (p.r >= 235 && p.g >= 235 && p.b >= 235) white++;
		}
		if (white > (width / 3) * 0.25) { bottom = y; break; }
	}
	for (let x = 0; x < width; x++) {
		let white = 0;
		for (let y = 0; y < height; y += 3) {
			const p = at(x, y);
			if (p.r >= 235 && p.g >= 235 && p.b >= 235) white++;
		}
		if (white > (height / 3) * 0.25) { left = x; break; }
	}
	for (let x = width - 1; x >= 0; x--) {
		let white = 0;
		for (let y = 0; y < height; y += 3) {
			const p = at(x, y);
			if (p.r >= 235 && p.g >= 235 && p.b >= 235) white++;
		}
		if (white > (height / 3) * 0.25) { right = x; break; }
	}
	if (top < 0 || bottom <= top || left < 0 || right <= left) return { x: 0, y: 0, w: width, h: height };
	return { x: left, y: top, w: right - left, h: bottom - top };
}

function normalizePanelCanvas(image: HTMLImageElement): HTMLCanvasElement {
	const b = panelBoundsFromPixels(image);
	const src = makeCanvas(b.w, b.h);
	const srcCtx = src.getContext('2d');
	if (!srcCtx) throw new Error('Unable to create source canvas.');
	srcCtx.drawImage(image, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
	const scale = CANONICAL_WIDTH / b.w;
	const out = makeCanvas(CANONICAL_WIDTH, Math.round(b.h * scale));
	const outCtx = out.getContext('2d');
	if (!outCtx) throw new Error('Unable to create output canvas.');
	outCtx.drawImage(src, 0, 0, out.width, out.height);
	return out;
}

function preprocess(source: HTMLCanvasElement): HTMLCanvasElement {
	const out = makeCanvas(source.width, source.height);
	const ctx = out.getContext('2d');
	if (!ctx) return source;
	ctx.filter = 'grayscale(1) contrast(1.45) brightness(1.05)';
	ctx.drawImage(source, 0, 0);
	return out;
}

function toScaledRect(c: HTMLCanvasElement, rect: { x: number; y: number; w: number; h: number }): Rect {
	const scale = c.width / CANONICAL_WIDTH;
	return {
		left: Math.max(0, Math.round(rect.x * scale)),
		top: Math.max(0, Math.round(rect.y * scale)),
		width: Math.max(8, Math.round(rect.w * scale)),
		height: Math.max(8, Math.round(rect.h * scale))
	};
}

function clampRectToCanvas(rect: Rect, canvas: HTMLCanvasElement): Rect {
	const left = Math.min(Math.max(0, rect.left), Math.max(0, canvas.width - 8));
	const top = Math.min(Math.max(0, rect.top), Math.max(0, canvas.height - 8));
	const width = Math.max(8, Math.min(rect.width, canvas.width - left));
	const height = Math.max(8, Math.min(rect.height, canvas.height - top));
	return { left, top, width, height };
}

function extractLines(result: any, column: 'left' | 'right'): SkillLine[] {
	const blocks = result?.data?.blocks || [];
	const lines = blocks.flatMap((b: any) => (b?.paragraphs || []).flatMap((p: any) => p?.lines || []));
	return (lines || []).map((line: any) => ({
		text: String(line?.text || '').trim(),
		bbox: line?.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
		column
	}));
}

function mergeMultiline(lines: SkillLine[], panelHeight: number): SkillLine[] {
	const byColumn = {
		left: lines.filter(line => line.column === 'left'),
		right: lines.filter(line => line.column === 'right')
	};
	const mergedColumns: SkillLine[] = [];
	const maxMergedLineHeight = Math.max(
		24,
		Math.round(panelHeight * SKILL_TILE_RELATIVE_HEIGHT_PCT * SKILL_TILE_MERGE_HEIGHT_TOLERANCE)
	);
	(['left', 'right'] as const).forEach(column => {
		const colLines = byColumn[column]
			.filter(line => line.text.length > 0)
			.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
		if (!colLines.length) return;
		const heights = colLines.map(line => Math.max(1, line.bbox.y1 - line.bbox.y0)).sort((a, b) => a - b);
		const medianHeight = heights[Math.floor(heights.length / 2)] || 16;
		const mergeGapThreshold = Math.max(10, Math.round(medianHeight * 0.8));
		const out: SkillLine[] = [];
		colLines.forEach(line => {
			if (!out.length) {
				out.push({ ...line });
				return;
			}
			const prev = out[out.length - 1];
			const gap = line.bbox.y0 - prev.bbox.y1;
			const overlap = Math.max(0, Math.min(prev.bbox.x1, line.bbox.x1) - Math.max(prev.bbox.x0, line.bbox.x0));
			const minWidth = Math.max(1, Math.min(prev.bbox.x1 - prev.bbox.x0, line.bbox.x1 - line.bbox.x0));
			const overlapRatio = overlap / minWidth;
			const mergedHeight = Math.max(1, Math.max(prev.bbox.y1, line.bbox.y1) - Math.min(prev.bbox.y0, line.bbox.y0));
			const shouldMerge = gap <= mergeGapThreshold
				&& overlapRatio >= 0.45
				&& mergedHeight <= maxMergedLineHeight;
			if (!shouldMerge) {
				out.push({ ...line });
				return;
			}
			prev.text = `${prev.text} ${line.text}`.replace(/\s+/g, ' ').trim();
			prev.bbox = {
				x0: Math.min(prev.bbox.x0, line.bbox.x0),
				y0: Math.min(prev.bbox.y0, line.bbox.y0),
				x1: Math.max(prev.bbox.x1, line.bbox.x1),
				y1: Math.max(prev.bbox.y1, line.bbox.y1)
			};
		});
		mergedColumns.push(...out);
	});
	return mergedColumns.sort((a, b) => a.bbox.y0 - b.bbox.y0 || (a.column === 'left' ? -1 : 1));
}

function shouldAmbiguous(cands: SkillMatchCandidate[]): boolean {
	const top = cands[0];
	const second = cands[1];
	if (!top) return true;
	if (top.score >= HIGH_CONFIDENCE_SCORE) return false;
	if (!second) return top.score < AUTO_ACCEPT_SCORE;
	if (top.score < AUTO_ACCEPT_SCORE) return true;
	if ((top.score - second.score) < AUTO_ACCEPT_MARGIN) return true;
	return false;
}

function dedupeUniqueInheritedVariants(cands: SkillMatchCandidate[], isTopLeftUnique: boolean): SkillMatchCandidate[] {
	const byBase = new Map<string, SkillMatchCandidate[]>();
	cands.forEach(c => {
		const base = normalizeSkillText(c.name).replace(/\(inherited\)/ig, '').replace(/[◎○×]/g, '').trim();
		const list = byBase.get(base) || [];
		list.push(c);
		byBase.set(base, list);
	});
	const out: SkillMatchCandidate[] = [];
	byBase.forEach(list => {
		if (list.length === 1) {
			out.push(list[0]);
			return;
		}
		if (isTopLeftUnique) {
			out.push(list.find(x => !x.skillId.startsWith('9')) || list[0]);
		} else {
			out.push(list.find(x => x.skillId.startsWith('9')) || list[0]);
		}
	});
	return out.sort((a, b) => b.score - a.score);
}

function inheritedVariantForSkillId(skillId: string): string | null {
	if (!isUniqueRarity(skillId) || skillId.startsWith('9')) return null;
	const direct = `9${String(skillId).slice(1)}`;
	if (skilldata[direct] != null && globalSkillMeta[direct] != null) return direct;
	const name = (globalSkillNames[skillId] || [])[0] || '';
	const base = normalizeSkillText(name).replace(/\(inherited\)/ig, '').replace(/[◎○×]/g, '').trim();
	const fallback = inheritedUniqueByBaseName[base];
	if (fallback && skilldata[fallback] != null && globalSkillMeta[fallback] != null) return fallback;
	return null;
}

function forceInheritedUniqueCandidates(cands: SkillMatchCandidate[]): SkillMatchCandidate[] {
	const collapsed = new Map<string, SkillMatchCandidate>();
	cands.forEach(candidate => {
		let skillId = candidate.skillId;
		let name = candidate.name;
		if (isUniqueRarity(skillId) && !skillId.startsWith('9')) {
			const inherited = inheritedVariantForSkillId(skillId);
			if (inherited) {
				skillId = inherited;
				name = (globalSkillNames[inherited] || [])[0] || name;
			}
		}
		const existing = collapsed.get(skillId);
		if (!existing || candidate.score > existing.score) {
			collapsed.set(skillId, { skillId, name, score: candidate.score });
		}
	});
	return Array.from(collapsed.values()).sort((a, b) => b.score - a.score);
}

function isLikelyRedundantUniquePrompt(
	prompt: UnknownSkillPrompt,
	ctx: UniquePromptCleanupContext
): boolean {
	if (!ctx.uniqueSkillId || !ctx.firstScreenshotId) return false;
	if (prompt.screenshotId !== ctx.firstScreenshotId) return false;
	// If first screenshot already resolved the exact unique skill,
	// do not ask the user to resolve that same unique tile again.
	return prompt.candidates.some(candidate => candidate.skillId === ctx.uniqueSkillId);
}

async function extractStatsBySlots(canvas: HTMLCanvasElement, worker: any): Promise<Partial<Record<StatKey, number>>> {
	const slotWidth = STAT_RECT.w / 5;
	const orderedKeys: StatKey[] = ['speed', 'stamina', 'power', 'guts', 'wisdom'];
	const parsed: Partial<Record<StatKey, number>> = {};
	for (let i = 0; i < orderedKeys.length; i++) {
		const slot = {
			x: STAT_RECT.x + (slotWidth * i) + STAT_SLOT_INSET_X,
			y: STAT_RECT.y + STAT_SLOT_INSET_Y,
			w: Math.max(20, slotWidth - (STAT_SLOT_INSET_X * 2)),
			h: Math.max(20, STAT_RECT.h - (STAT_SLOT_INSET_Y * 2))
		};
		const rect = toScaledRect(canvas, slot);
		const result = await worker.recognize(canvas, { rectangle: rect }, { blocks: true });
		const value = parseBestStatValue(result?.data?.text || '');
		if (value != null) parsed[orderedKeys[i]] = value;
	}
	return parsed;
}

async function detectHasPartnerButton(canvas: HTMLCanvasElement, worker: any): Promise<boolean> {
	const probeBand = skillBlockFromBottomPercents(
		canvas,
		PARTNER_PROBE_TOP_PCT_FROM_BOTTOM,
		PARTNER_PROBE_BOTTOM_PCT_FROM_BOTTOM
	);
	const probeRect = clampRectToCanvas({
		left: Math.round(canvas.width * PARTNER_PROBE_LEFT_PCT),
		top: probeBand.top,
		width: Math.round(canvas.width * (PARTNER_PROBE_RIGHT_PCT - PARTNER_PROBE_LEFT_PCT)),
		height: probeBand.height
	}, canvas);
	const result = await worker.recognize(canvas, { rectangle: probeRect }, { blocks: true });
	const text = String(result?.data?.text || '').toLowerCase();
	const normalized = text.replace(/[^a-z]/g, '');
	const hasPartnerButton =
		text.includes('partner')
		|| normalized.includes('partner')
		|| text.includes('practice partner')
		|| normalized.includes('practicepartner');
	return hasPartnerButton;
}

function uniqueProbeRectFromLeftBand(panel: HTMLCanvasElement, leftRect: Rect, hasPartnerButton: boolean): Rect {
	if (hasPartnerButton) {
		const top = Math.round(panel.height * UNIQUE_PARTNER_TOP_PCT);
		const bottom = Math.round(panel.height * UNIQUE_PARTNER_BOTTOM_PCT);
		return clampRectToCanvas({
			left: leftRect.left,
			top,
			width: leftRect.width,
			height: Math.max(8, bottom - top)
		}, panel);
	}
	const upward = Math.round(panel.height * UNIQUE_PROBE_UPWARD_BUFFER_PCT);
	const probeHeight = Math.max(24, Math.round(panel.height * UNIQUE_PROBE_HEIGHT_PCT));
	return clampRectToCanvas({
		left: leftRect.left,
		top: Math.max(0, leftRect.top - upward),
		width: leftRect.width,
		height: probeHeight
	}, panel);
}

function chooseBestUniqueSignal(signals: UniqueSignal[], requireLevelSignal: boolean): UniqueSignal | null {
	if (!signals.length) return null;
	const scored = [...signals];
	const leveled = scored.filter(signal => signal.hasLevel);
	const candidates = leveled.length > 0 ? leveled : (requireLevelSignal ? [] : scored);
	if (candidates.length === 0) return null;
	return candidates.sort((a, b) => {
		// Prefer explicit level marker (Lvl X), it strongly indicates the unique row.
		if (a.hasLevel !== b.hasLevel) return a.hasLevel ? -1 : 1;
		// Then prefer high OCR confidence.
		if (b.score !== a.score) return b.score - a.score;
		// Prefer probe-derived signal over row-derived when tied.
		if (a.source !== b.source) return a.source === 'probe' ? -1 : 1;
		// Finally prefer the visually higher tile.
		return a.y - b.y;
	})[0] || null;
}

function skillBlockFromBottomPercents(canvas: HTMLCanvasElement, topPctFromBottom: number, bottomPctFromBottom: number): { top: number; height: number } {
	const top = Math.round(canvas.height * (1 - topPctFromBottom));
	const bottom = Math.round(canvas.height * (1 - bottomPctFromBottom));
	const safeTop = Math.max(0, Math.min(top, canvas.height - 8));
	const safeBottom = Math.max(safeTop + 8, Math.min(bottom, canvas.height));
	return {
		top: safeTop,
		height: Math.max(8, safeBottom - safeTop)
	};
}

async function makeWorkers(): Promise<OcrWorkers> {
	const stat = await createWorker('eng');
	await stat.setParameters({ tessedit_char_whitelist: '0123456789 ', preserve_interword_spaces: '1' });
	const skillLeft = await createWorker('eng');
	const skillRight = await createWorker('eng');
	await Promise.all([skillLeft.setParameters({ preserve_interword_spaces: '1' }), skillRight.setParameters({ preserve_interword_spaces: '1' })]);
	return { stat, skillLeft, skillRight };
}

async function terminateWorkers(workers: OcrWorkers | null) {
	if (!workers) return;
	await Promise.all([workers.stat.terminate(), workers.skillLeft.terminate(), workers.skillRight.terminate()]);
}

export async function importProfileFromScreenshots(screenshots: ImportScreenshotInput[]): Promise<ProfileImportDraft> {
	if (!screenshots.length) throw new Error('Upload or paste at least one screenshot.');
	let workers: OcrWorkers | null = null;
	const warnings: string[] = [];
	const unknownSkills: UnknownSkillPrompt[] = [];
	const resolvedSkills: string[] = [];
	const debugShots: NonNullable<ProfileImportDraft['debug']>['screenshots'] = [];
	let stats: Partial<Record<StatKey, number>> = {};
	let uniqueLevel: number | null = null;
	let uniqueSkillId: string | null = null;

	try {
		workers = await makeWorkers();

		for (let i = 0; i < screenshots.length; i++) {
			const screenshot = screenshots[i];
			const image = await dataUrlToImage(screenshot.dataUrl);
			const panel = normalizePanelCanvas(image);
			const pp = preprocess(panel);

			const statRect = toScaledRect(panel, STAT_RECT);
			const hasPartnerButton = await detectHasPartnerButton(pp, workers.skillLeft);
			const skillBand = skillBlockFromBottomPercents(
				panel,
				hasPartnerButton ? SKILL_BLOCK_TOP_PCT_FROM_BOTTOM_PARTNER : SKILL_BLOCK_TOP_PCT_FROM_BOTTOM_DEFAULT,
				SKILL_BLOCK_BOTTOM_PCT_FROM_BOTTOM
			);
			const leftRect = clampRectToCanvas(
				toScaledRect(panel, { ...SKILL_LEFT_TEXT_RECT, y: skillBand.top, h: skillBand.height }),
				panel
			);
			const rightRect = clampRectToCanvas(
				toScaledRect(panel, { ...SKILL_RIGHT_TEXT_RECT, y: skillBand.top, h: skillBand.height }),
				panel
			);

			if (i === 0) {
				const slotStats = await extractStatsBySlots(pp, workers.stat);
				stats = { ...slotStats };
				if (Object.keys(stats).length < 5) {
					const statRes = await workers.stat.recognize(pp, { rectangle: statRect }, { blocks: true });
					const fallbackStats = parseStatsFromText(statRes?.data?.text || '');
					(['speed', 'stamina', 'power', 'guts', 'wisdom'] as StatKey[]).forEach(k => {
						if (stats[k] == null && fallbackStats[k] != null) stats[k] = fallbackStats[k];
					});
				}
			}

			const [leftRes, rightRes] = await Promise.all([
				workers.skillLeft.recognize(pp, { rectangle: leftRect }, { blocks: true }),
				workers.skillRight.recognize(pp, { rectangle: rightRect }, { blocks: true })
			]);
			const lines = mergeMultiline([...extractLines(leftRes, 'left'), ...extractLines(rightRes, 'right')], panel.height)
				.filter(line => line.text.length > 0)
				.filter(line => !isLikelyUiText(line.text))
				.sort((a, b) => a.bbox.y0 - b.bbox.y0 || (a.column === 'left' ? -1 : 1));

			const debugLineRows = lines.map(line => ({ column: line.column, text: line.text, y: line.bbox.y0 }));
			const uniqueTopLimit = leftRect.top + Math.round(panel.height * UNIQUE_TOP_ROW_MAX_OFFSET_PCT);
			const uniqueSignals: UniqueSignal[] = [];

			if (i === 0) {
				const uniqueProbeRect = uniqueProbeRectFromLeftBand(panel, leftRect, hasPartnerButton);
				const uniqueProbeResult = await workers.skillLeft.recognize(pp, { rectangle: uniqueProbeRect }, { blocks: true });
				const uniqueProbeText = sanitizeSkillLineText(String(uniqueProbeResult?.data?.text || ''));
				if (uniqueProbeText) {
					const lv = parseUniqueLevel(uniqueProbeText);
					if (lv != null) uniqueLevel = lv;
					const uniqueProbeCandidates = dedupeUniqueInheritedVariants(
						getUniqueSkillCandidates(uniqueProbeText.replace(/lvl\.?\s*\d/ig, '').trim(), 6, true),
						true
					);
					if (uniqueProbeCandidates.length > 0) {
						uniqueSignals.push({
							skillId: uniqueProbeCandidates[0].skillId,
							score: uniqueProbeCandidates[0].score,
							source: 'probe',
							y: uniqueProbeRect.top,
							hasLevel: lv != null
						});
					}
				}
			}

			for (let idx = 0; idx < lines.length; idx++) {
				const line = lines[idx];
				const isTopLeft = i === 0
					&& line.column === 'left'
					&& line.bbox.y0 <= uniqueTopLimit
					&& !lines.slice(0, idx).some(prev => prev.column === 'left');
				const text = sanitizeSkillLineText(line.text);
				if (!text) continue;

				const textOnly = text.replace(/lvl\.?\s*\d/ig, '').trim();
				if (isLikelyUiText(textOnly)) continue;
				if (i === 0 && !hasPartnerButton && line.column === 'left' && line.bbox.y0 <= leftRect.top + Math.round(panel.height * UNIQUE_LINE_SCAN_HEIGHT_PCT)) {
					const lineLv = parseUniqueLevel(text);
					const lineUniqueCandidates = dedupeUniqueInheritedVariants(
						getUniqueSkillCandidates(textOnly, 5, true),
						true
					);
					if (lineUniqueCandidates.length > 0) {
						uniqueSignals.push({
							skillId: lineUniqueCandidates[0].skillId,
							score: lineUniqueCandidates[0].score,
							source: 'line',
							y: line.bbox.y0,
							hasLevel: lineLv != null
						});
						if (lineLv != null && uniqueLevel == null) uniqueLevel = lineLv;
					}
				}
				const rawCandidates = isTopLeft
					? getUniqueSkillCandidates(textOnly, 6, true)
					: getSkillCandidates(textOnly, 6);
				// Only collapse inherited/non-inherited variants for the unique tile.
				const candidates = isTopLeft
					? dedupeUniqueInheritedVariants(
						rawCandidates.filter(c => !c.skillId.startsWith('9')),
						true
					)
					: forceInheritedUniqueCandidates(rawCandidates);

				// Crop only the text band: exclude left icon and trim right border.
				const tileRect: Rect = {
					left: Math.max(0, Math.round(line.bbox.x0 + SKILL_TEXT_LEFT_PAD - SKILL_TEXT_LEFT_EXPAND)),
					top: Math.max(0, Math.round(line.bbox.y0 - SKILL_VERTICAL_PAD)),
					width: Math.max(24, Math.round((line.bbox.x1 - line.bbox.x0) - SKILL_TEXT_RIGHT_TRIM - SKILL_TEXT_LEFT_PAD + SKILL_TEXT_LEFT_EXPAND)),
					height: Math.max(24, Math.round((line.bbox.y1 - line.bbox.y0) + (SKILL_VERTICAL_PAD * 2)))
				};
				if (tileRect.left + tileRect.width > panel.width) {
					tileRect.width = Math.max(24, panel.width - tileRect.left);
				}
				if (tileRect.top + tileRect.height > panel.height) {
					tileRect.height = Math.max(24, panel.height - tileRect.top);
				}
				const crop = makeCanvas(tileRect.width, tileRect.height);
				const cropCtx = crop.getContext('2d');
				if (cropCtx) cropCtx.drawImage(panel, tileRect.left, tileRect.top, tileRect.width, tileRect.height, 0, 0, tileRect.width, tileRect.height);
				const cropDataUrl = crop.toDataURL('image/png');

				if (isTopLeft) {
					const lv = parseUniqueLevel(text);
					if (lv != null) uniqueLevel = lv;
				}

				const ambiguous = shouldAmbiguous(candidates);
				const shouldAsk = !candidates.length || (!isTopLeft && ambiguous) || (isTopLeft && ambiguous && (candidates[0]?.score ?? 0) < 0.8);
				if (shouldAsk) {
					if (candidates.length) {
						unknownSkills.push({
							id: `${screenshot.id}-${idx}`,
							screenshotId: screenshot.id,
							screenshotName: screenshot.name,
							rawText: textOnly,
							cropDataUrl,
							candidates
						});
					}
					continue;
				}

				let picked = candidates[0].skillId;
				if (!isTopLeft && isUniqueRarity(picked)) {
					const inherited = inheritedVariantForSkillId(picked);
					if (inherited) picked = inherited;
				}
				if (isTopLeft && picked.startsWith('9')) {
					const nonInherited = candidates.find(c => !c.skillId.startsWith('9'));
					if (nonInherited) picked = nonInherited.skillId;
				}

				if (!resolvedSkills.includes(picked)) resolvedSkills.push(picked);
				if (isTopLeft && isUniqueRarity(picked) && !picked.startsWith('9')) uniqueSkillId = picked;
			}

			if (i === 0) {
				const bestUnique = chooseBestUniqueSignal(uniqueSignals, hasPartnerButton);
				const uniqueMinScore = hasPartnerButton ? 0.86 : 0.79;
				if (bestUnique && (uniqueSkillId == null || bestUnique.score >= uniqueMinScore)) {
					uniqueSkillId = bestUnique.skillId;
					if (!resolvedSkills.includes(bestUnique.skillId)) resolvedSkills.push(bestUnique.skillId);
				}
			}

			debugShots.push({
				name: screenshot.name,
				panelWidth: panel.width,
				panelHeight: panel.height,
				statRect,
				statText: i === 0 ? JSON.stringify(stats) : '',
				statNumbers: i === 0 ? Object.values(stats) as number[] : [],
				leftSkillRect: leftRect,
				rightSkillRect: rightRect,
				lines: debugLineRows
			});
		}
	} finally {
		await terminateWorkers(workers);
	}

	if (Object.keys(stats).length < 5) warnings.push('Could not confidently read all five stats. Review before applying.');
	if (!uniqueSkillId) warnings.push('Could not resolve the unique skill from the first rainbow skill tile.');
	if (!resolvedSkills.length) warnings.push('No skill tiles were detected. Try a clearer screenshot or include more of the skills panel.');

	const outfitId = uniqueSkillId ? (uniqueSkillToOutfit[uniqueSkillId] || null) : null;
	if (uniqueSkillId && !outfitId) {
		const uniqueName = (globalSkillNames[uniqueSkillId] || [])[0] || '(name unavailable)';
		warnings.push(`Unique skill was matched, but no outfit mapping was found (matched unique id=${uniqueSkillId}, name="${uniqueName}").`);
	}

	const firstScreenshotId = screenshots[0]?.id || null;
	const filteredUnknownSkills = unknownSkills.filter(prompt => !isLikelyRedundantUniquePrompt(prompt, {
		uniqueSkillId,
		firstScreenshotId
	}));

	return {
		stats,
		uniqueSkillId,
		uniqueLevel,
		outfitId,
		skillIds: resolvedSkills.filter(skillId => skilldata[skillId] != null && globalSkillMeta[skillId] != null),
		unknownSkills: filteredUnknownSkills,
		warnings,
		debug: { screenshots: debugShots }
	};
}

export function outfitIdForUniqueSkill(skillId: string): string | null {
	return uniqueSkillToOutfit[skillId] || null;
}

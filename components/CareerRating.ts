// Career Rating Calculation Utilities
// Based on the rating calculation logic from optimizer.js

import skillmeta from '../skill_meta.json';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillnames from '../umalator-global/skillnames.json';

const STAT_BLOCK_SIZE = 50;
const STAT_MULTIPLIERS = [
	0.5, 0.8, 1, 1.3, 1.6, 1.8, 2.1, 2.4, 2.6, 2.8, 2.9, 3, 3.1, 3.3, 3.4,
	3.5, 3.9, 4.1, 4.2, 4.3, 5.2, 5.5, 6.6, 6.8, 6.9
];

// Multipliers for stats above 1200 (blocks of 10)
const STAT_MULTIPLIERS_ABOVE_1200 = [
	7.888, 8, 8.1, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 9, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8, 10, 10.1, 10.2, 10.3, 10.5, 10.6, 10.7, 10.9, 11, 11.1, 11.3, 11.4, 11.5, 11.7, 11.8, 11.9, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.8, 13, 13.1, 13.2, 13.4, 13.5, 13.6, 13.8, 13.9, 14, 14.1, 14.3, 14.4, 14.5, 14.7, 14.8, 14.9, 15.1, 15.2, 15.3, 15.5, 15.6, 15.7, 15.9, 16, 16.1, 16.2, 16.4, 16.5, 16.6, 16.8, 16.9, 17, 17.2, 17.3, 17.4, 17.6, 17.7, 17.8, 17.9, 18.1, 18.2, 18.3
];

const MAX_STAT_VALUE = 2000;

export interface RatingBreakdown {
	statsScore: number;
	skillScore: number;
	uniqueBonus: number;
	total: number;
}

export interface RatingBadge {
	threshold: number;
	label: string;
	sprite: {
		col: number;
		row: number;
	};
}

export const RATING_BADGES: RatingBadge[] = [
	{ threshold: 300, label: 'G', sprite: { col: 0, row: 0 } },
	{ threshold: 600, label: 'G+', sprite: { col: 0, row: 1 } },
	{ threshold: 900, label: 'F', sprite: { col: 0, row: 2 } },
	{ threshold: 1300, label: 'F+', sprite: { col: 0, row: 3 } },
	{ threshold: 1800, label: 'E', sprite: { col: 0, row: 4 } },
	{ threshold: 2300, label: 'E+', sprite: { col: 0, row: 5 } },
	{ threshold: 2900, label: 'D', sprite: { col: 1, row: 0 } },
	{ threshold: 3500, label: 'D+', sprite: { col: 1, row: 1 } },
	{ threshold: 4900, label: 'C', sprite: { col: 1, row: 2 } },
	{ threshold: 6500, label: 'C+', sprite: { col: 1, row: 3 } },
	{ threshold: 8200, label: 'B', sprite: { col: 1, row: 4 } },
	{ threshold: 10000, label: 'B+', sprite: { col: 1, row: 5 } },
	{ threshold: 12100, label: 'A', sprite: { col: 2, row: 0 } },
	{ threshold: 14500, label: 'A+', sprite: { col: 2, row: 1 } },
	{ threshold: 15900, label: 'S', sprite: { col: 2, row: 2 } },
	{ threshold: 17500, label: 'S+', sprite: { col: 2, row: 3 } },
	{ threshold: 19200, label: 'SS', sprite: { col: 2, row: 4 } },
	{ threshold: 19600, label: 'SS+', sprite: { col: 2, row: 5 } },
	{ threshold: 20000, label: 'UG', sprite: { col: 3, row: 0 } },
	{ threshold: 20400, label: 'UG1', sprite: { col: 3, row: 1 } },
	{ threshold: 20800, label: 'UG2', sprite: { col: 3, row: 2 } },
	{ threshold: 21200, label: 'UG3', sprite: { col: 3, row: 3 } },
	{ threshold: 21600, label: 'UG4', sprite: { col: 3, row: 4 } },
	{ threshold: 22100, label: 'UG5', sprite: { col: 3, row: 5 } },
	{ threshold: 22500, label: 'UG6', sprite: { col: 4, row: 0 } },
	{ threshold: 23000, label: 'UG7', sprite: { col: 4, row: 1 } },
	{ threshold: 23400, label: 'UG8', sprite: { col: 4, row: 2 } },
	{ threshold: 23900, label: 'UG9', sprite: { col: 4, row: 3 } },
	{ threshold: 24300, label: 'UF', sprite: { col: 4, row: 4 } },
	{ threshold: 24800, label: 'UF1', sprite: { col: 4, row: 5 } },
	{ threshold: 25300, label: 'UF2', sprite: { col: 5, row: 0 } },
	{ threshold: 25800, label: 'UF3', sprite: { col: 5, row: 1 } },
	{ threshold: 26300, label: 'UF4', sprite: { col: 5, row: 2 } },
	{ threshold: 26800, label: 'UF5', sprite: { col: 5, row: 3 } },
	{ threshold: 27300, label: 'UF6', sprite: { col: 5, row: 4 } },
	{ threshold: 27800, label: 'UF7', sprite: { col: 5, row: 5 } },
	{ threshold: Infinity, label: 'UF7', sprite: { col: 5, row: 5 } },
];

function clampStatValue(value: number): number {
	if (typeof value !== 'number' || isNaN(value)) return 0;
	return Math.max(0, Math.min(MAX_STAT_VALUE, value));
}

function getMultiplierForBlock(blockIndex: number): number {
	if (blockIndex < STAT_MULTIPLIERS.length) {
		return STAT_MULTIPLIERS[blockIndex];
	}
	return STAT_MULTIPLIERS[STAT_MULTIPLIERS.length - 1];
}

/**
 * Calculate rating score contribution from a single stat value.
 * For stats <= 1200: Divided into blocks of 50, each with a different multiplier.
 * For stats > 1200: Uses different calculation with blocks of 10 and higher multipliers.
 */
export function calcStatScore(statValue: number): number {
	const value = clampStatValue(statValue);
	
	// For stats <= 1200: Use original block-based calculation
	if (value <= 1200) {
		let t = value + 1; // Add 1 as per the new logic
		let total = 0;
		
		for (let i = 0; i < STAT_MULTIPLIERS.length; i++) {
			if (STAT_MULTIPLIERS[i] === 0) {
				return 0; // "Undefined Pram is Included!!" case
			}
			
			if (t > 50) {
				total += 50 * STAT_MULTIPLIERS[i];
				t -= 50;
			} else {
				total += t * STAT_MULTIPLIERS[i];
				break;
			}
		}
		
		return Math.floor(total);
	}
	
	// For stats 1201-1209: Special formula
	if (value > 1200 && value <= 1209) {
		return Math.ceil((value - 1200) * STAT_MULTIPLIERS_ABOVE_1200[0]) + 3841;
	}
	
	// For stats 1210-2000: Blocks of 10 with multipliers from m array (starting at index 1)
	if (value > 1209 && value <= 2000) {
		let t = value - 1210 + 1; // Adjust: 1210 becomes 1, 1211 becomes 2, etc.
		let total = 0;
		
		// Start from index 1 (skip m[0] which was used for 1201-1209)
		for (let i = 1; i < STAT_MULTIPLIERS_ABOVE_1200.length; i++) {
			if (STAT_MULTIPLIERS_ABOVE_1200[i] === 0) {
				return 0; // Error case
			}
			
			if (t > 10) {
				total += Math.ceil(10 * STAT_MULTIPLIERS_ABOVE_1200[i]);
				t -= 10;
			} else {
				total += Math.ceil(t * STAT_MULTIPLIERS_ABOVE_1200[i]);
				break;
			}
		}
		
		return total + 3912; // Base value for 1210+
	}
	
	// Fallback (shouldn't reach here due to clamp, but return 0 for safety)
	return 0;
}

/**
 * Calculate unique skill bonus based on star level and unique skill level.
 * Star levels 1-2 use multiplier 120, star levels 3+ use multiplier 170.
 */
export function calcUniqueBonus(starLevel: number, uniqueLevel: number): number {
	const lvl = typeof uniqueLevel === 'number' && uniqueLevel > 0 ? uniqueLevel : 0;
	if (!lvl) return 0;
	const multiplier = starLevel === 1 || starLevel === 2 ? 120 : 170;
	return lvl * multiplier;
}

/**
 * Get the rating badge for a given total score.
 */
export function getRatingBadge(totalScore: number): RatingBadge {
	for (const badge of RATING_BADGES) {
		if (totalScore < badge.threshold) return badge;
	}
	return RATING_BADGES[RATING_BADGES.length - 1];
}

/**
 * Get the index of the rating badge for a given total score.
 */
export function getRatingBadgeIndex(totalScore: number): number {
	for (let i = 0; i < RATING_BADGES.length; i++) {
		if (totalScore < RATING_BADGES[i].threshold) return i;
	}
	return RATING_BADGES.length - 1;
}

// Cache for CSV data
let skillRatingCache: Map<string, number> | null = null;
let csvLoadPromise: Promise<void> | null = null;

/**
 * Normalize a skill name for lookup (lowercase, trim)
 */
function normalizeSkillName(name: string): string {
	return (name || '').trim().toLowerCase();
}

/**
 * Parse CSV content and create a skill name -> rating score mapping.
 */
function parseSkillsCSV(csvText: string): Map<string, number> {
	const map = new Map<string, number>();
	const lines = csvText.split(/\r?\n/);
	
	if (lines.length < 2) return map;
	
	// Skip header line
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;
		
		// Parse CSV line (handling quoted fields)
		const fields: string[] = [];
		let current = '';
		let inQuotes = false;
		
		for (let j = 0; j < line.length; j++) {
			const char = line[j];
			if (char === '"') {
				if (inQuotes && line[j + 1] === '"') {
					current += '"';
					j++;
				} else {
					inQuotes = !inQuotes;
				}
			} else if (char === ',' && !inQuotes) {
				fields.push(current);
				current = '';
			} else {
				current += char;
			}
		}
		fields.push(current);
		
		if (fields.length < 3) continue;
		
		const name = fields[1]?.trim();
		const baseValue = parseFloat(fields[2]?.trim() || '0');
		
		if (name && !isNaN(baseValue)) {
			const normalizedName = normalizeSkillName(name);
			// Use the highest rating if multiple entries exist for the same name
			const existing = map.get(normalizedName);
			if (!existing || baseValue > existing) {
				map.set(normalizedName, baseValue);
			}
		}
	}
	
	return map;
}

/**
 * Load the skills CSV and cache the rating scores.
 */
async function loadSkillsCSV(): Promise<void> {
	if (skillRatingCache) return;
	if (csvLoadPromise) return csvLoadPromise;
	
	csvLoadPromise = (async () => {
		try {
			const response = await fetch('/uma-tools/uma-skill-tools/data/uma_skills.csv');
			if (!response.ok) {
				console.warn('Failed to load uma_skills.csv, using fallback calculation');
				skillRatingCache = new Map();
				return;
			}
			const csvText = await response.text();
			skillRatingCache = parseSkillsCSV(csvText);
		} catch (error) {
			console.warn('Error loading uma_skills.csv:', error);
			skillRatingCache = new Map();
		}
	})();
	
	return csvLoadPromise;
}

/**
 * Get skill name from skill ID using skillnames.json.
 */
function getSkillName(skillId: string): string | null {
	const names = (skillnames as any)[skillId];
	if (!names || !Array.isArray(names) || names.length === 0) {
		return null;
	}
	// Use English name if available, otherwise first name
	return names[names.length > 1 ? 1 : 0] || names[0];
}

/**
 * Find the lower skill version for a gold skill based on groupId.
 * Gold skills (rarity 4) often have a lower version (rarity < 4) in the same group.
 */
function findLowerSkillForGold(goldSkillId: string): string | null {
	const goldMeta = (skillmeta as any)[goldSkillId];
	if (!goldMeta || !goldMeta.groupId) return null;
	
	const goldSkill = (skilldata as any)[goldSkillId];
	if (!goldSkill || goldSkill.rarity !== 4) return null; // Only for gold skills
	
	const groupId = goldMeta.groupId;
	
	// Find skills in the same group with lower rarity
	for (const skillId in skillmeta) {
		if (skillId === goldSkillId) continue;
		const meta = (skillmeta as any)[skillId];
		const skill = (skilldata as any)[skillId];
		
		if (meta && meta.groupId === groupId && skill && skill.rarity < 4) {
			return skillId;
		}
	}
	
	return null;
}

/**
 * Get rating contribution for a single skill by its ID.
 * Uses the CSV data (base_value) which is the actual rating score contribution.
 * For gold skills, includes the rating contribution from the lower skill version.
 */
export async function getSkillRatingContribution(skillId: string): Promise<number> {
	await loadSkillsCSV();
	
	if (!skillRatingCache) {
		// Fallback if CSV loading failed
		const meta = (skillmeta as any)[skillId];
		if (meta && typeof meta.baseCost === 'number' && meta.baseCost > 0) {
			return meta.baseCost;
		}
		return 0;
	}
	
	const skillName = getSkillName(skillId);
	if (!skillName) return 0;
	
	const normalizedName = normalizeSkillName(skillName);
	let rating = skillRatingCache.get(normalizedName) || 0;
	
	// For gold skills, include the lower skill's rating contribution
	const skill = (skilldata as any)[skillId];
	if (skill && skill.rarity === 4) {
		const lowerSkillId = findLowerSkillForGold(skillId);
		if (lowerSkillId) {
			const lowerSkillName = getSkillName(lowerSkillId);
			if (lowerSkillName) {
				const lowerNormalizedName = normalizeSkillName(lowerSkillName);
				const lowerRating = skillRatingCache.get(lowerNormalizedName) || 0;
				rating += lowerRating;
			}
		}
	}
	
	return rating;
}

/**
 * Calculate total skill score from a set of skill IDs.
 * @param skillIds Array or Set of skill IDs (excluding unique skill)
 */
export async function calculateSkillScore(skillIds: Iterable<string>): Promise<number> {
	await loadSkillsCSV();
	
	let total = 0;
	for (const skillId of skillIds) {
		total += await getSkillRatingContribution(skillId);
	}
	return total;
}

/**
 * Calculate the complete career rating breakdown.
 * @param stats Object with speed, stamina, power, guts, wisdom
 * @param skillScore Total rating contribution from skills (excluding unique)
 * @param starLevel Uma star level (1-5)
 * @param uniqueLevel Unique skill level (1-6, 0 if none)
 */
export function calculateRatingBreakdown(
	stats: { speed: number; stamina: number; power: number; guts: number; wisdom: number },
	skillScore: number,
	starLevel: number = 3,
	uniqueLevel: number = 0
): RatingBreakdown {
	const statsScore = 
		calcStatScore(stats.speed) +
		calcStatScore(stats.stamina) +
		calcStatScore(stats.power) +
		calcStatScore(stats.guts) +
		calcStatScore(stats.wisdom);
	
	const uniqueBonus = calcUniqueBonus(starLevel, uniqueLevel);
	const total = statsScore + uniqueBonus + skillScore;
	
	return {
		statsScore,
		skillScore,
		uniqueBonus,
		total
	};
}

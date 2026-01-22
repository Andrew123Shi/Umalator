import { CourseData } from '../uma-skill-tools/CourseData';
import { RaceParameters, Mood } from '../uma-skill-tools/RaceParameters';
import { RaceSolverBuilder, buildBaseStats, buildAdjustedStats, Perspective } from '../uma-skill-tools/RaceSolverBuilder';
import { RaceSolver, PosKeepMode } from '../uma-skill-tools/RaceSolver';
import { HorseState } from '../components/HorseDefTypes';
import { Rule30CARng } from '../uma-skill-tools/Random';
import { calculateRatingBreakdown, calculateSkillScore } from '../components/CareerRating';
import { runComparison } from './compare';
import skillmeta from '../skill_meta.json';

export interface OptimizerStats {
	speed: number;
	stamina: number;
	power: number;
	guts: number;
	wisdom: number;
}

export type EvaluationMethod = 'mean' | 'median' | 'aggregate';

export interface OptimizerIteration {
	iteration: number;
	stats: OptimizerStats;
	// Evaluation value is margin (bashin difference); more negative is better for Uma 1.
	evaluationValue: number; // Mean or median margin depending on method
	// Distribution of margins for this iteration (length = nsamples)
	diffs: number[];
	// Precomputed summary stats for UI
	marginStats: { min: number; max: number; mean: number; median: number };
	careerRating: number;
	valid: boolean; // Whether this iteration satisfies the career rating constraint
	chartData?: any; // Race chart data for this iteration
	runData?: any; // Run data for this iteration
	// Best-so-far info (for real-time UI without recomputing on frontend)
	bestSoFarValue: number;
	bestSoFarStats: OptimizerStats;
	bestSoFarCareerRating: number;
}

export interface OptimizerResult {
	iterations: OptimizerIteration[];
	finalStats: OptimizerStats;
	bestValue: number;
	bestStats: OptimizerStats;
	evaluationMethod: EvaluationMethod;
	finalRunData?: any;
	finalChartData?: any;
	finalCareerRating?: number;
}

/**
 * Generate random stats that satisfy the career rating constraint and min/max bounds
 */
function generateRandomStats(
	skillScore: number,
	starLevel: number,
	uniqueLevel: number,
	maxCareerRating: number,
	minStat: number,
	maxStat: number,
	rng: () => number
): OptimizerStats | null {
	for (let attempt = 0; attempt < 1000; attempt++) {
		const stats: OptimizerStats = {
			speed: Math.floor(rng() * (maxStat - minStat + 1)) + minStat,
			stamina: Math.floor(rng() * (maxStat - minStat + 1)) + minStat,
			power: Math.floor(rng() * (maxStat - minStat + 1)) + minStat,
			guts: Math.floor(rng() * (maxStat - minStat + 1)) + minStat,
			wisdom: Math.floor(rng() * (maxStat - minStat + 1)) + minStat,
		};
		
		const rating = calculateRatingBreakdown(stats, skillScore, starLevel, uniqueLevel);
		if (rating.total <= maxCareerRating) {
			return stats;
		}
	}
	return null;
}

/**
 * Mutate stats while respecting the career rating constraint and min/max bounds
 */
function mutateStats(
	stats: OptimizerStats,
	skillScore: number,
	starLevel: number,
	uniqueLevel: number,
	maxCareerRating: number,
	minStat: number,
	maxStat: number,
	mutationRate: number,
	mutationAmount: number,
	rng: () => number
): OptimizerStats | null {
	const mutated = { ...stats };
	const bigJumpChance = 0.05;
	
	// Randomly mutate some stats
	if (rng() < mutationRate) mutated.speed = Math.max(minStat, Math.min(maxStat, mutated.speed + (rng() < 0.5 ? -mutationAmount : mutationAmount)));
	if (rng() < mutationRate) mutated.stamina = Math.max(minStat, Math.min(maxStat, mutated.stamina + (rng() < 0.5 ? -mutationAmount : mutationAmount)));
	if (rng() < mutationRate) mutated.power = Math.max(minStat, Math.min(maxStat, mutated.power + (rng() < 0.5 ? -mutationAmount : mutationAmount)));
	if (rng() < mutationRate) mutated.guts = Math.max(minStat, Math.min(maxStat, mutated.guts + (rng() < 0.5 ? -mutationAmount : mutationAmount)));
	if (rng() < mutationRate) mutated.wisdom = Math.max(minStat, Math.min(maxStat, mutated.wisdom + (rng() < 0.5 ? -mutationAmount : mutationAmount)));

	// Occasionally apply a larger local jump to escape local minima
	if (rng() < bigJumpChance) {
		const statKeys: Array<keyof OptimizerStats> = ['speed', 'stamina', 'power', 'guts', 'wisdom'];
		const key = statKeys[Math.floor(rng() * statKeys.length)];
		const jump = Math.floor((rng() * 4 - 2) * mutationAmount);
		mutated[key] = Math.max(minStat, Math.min(maxStat, mutated[key] + jump));
	}
	
	const rating = calculateRatingBreakdown(mutated, skillScore, starLevel, uniqueLevel);
	if (rating.total <= maxCareerRating) {
		return mutated;
	}
	
	// If mutation violates constraint, try to fix it by reducing stats
	const excess = rating.total - maxCareerRating;
	const statKeys: Array<keyof OptimizerStats> = ['speed', 'stamina', 'power', 'guts', 'wisdom'];
	let attempts = 0;
	while (rating.total > maxCareerRating && attempts < 100) {
		const key = statKeys[Math.floor(rng() * statKeys.length)];
		mutated[key] = Math.max(minStat, mutated[key] - Math.ceil(excess / 5));
		const newRating = calculateRatingBreakdown(mutated, skillScore, starLevel, uniqueLevel);
		if (newRating.total <= maxCareerRating) {
			return mutated;
		}
		attempts++;
	}
	
	return null;
}

/**
 * Evaluate stats by optimizing margin of win (bashin difference from runComparison).
 * Returns evaluation value (mean or median margin) and chart data from runComparison.
 *
 * Note: runComparison.results is basinn difference (Uma1 - Uma2), so more negative is better for Uma1.
 */
function evaluateStats(
	stats: OptimizerStats,
	course: CourseData,
	racedef: RaceParameters,
	baseUma: HorseState,
	referenceUma: HorseState,
	options: any,
	nsamples: number,
	evaluationMethod: EvaluationMethod,
	onProgress?: (completed: number, total: number) => void
): { value: number; chartData: any; runData: any } {
	const uma = baseUma.merge({
		speed: stats.speed,
		stamina: stats.stamina,
		power: stats.power,
		guts: stats.guts,
		wisdom: stats.wisdom,
	});

	// Ensure we are in compare mode for correct behavior
	const compareOptions = {...options, mode: 'compare' as const};

	// Use runComparison to get margin of win distribution and chart data
	const comparisonResult = runComparison(nsamples, course, racedef, uma, referenceUma, null, compareOptions, onProgress);

	const diffs: number[] = comparisonResult.results || [];
	const sorted = [...diffs].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
	const mean = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;

	// evaluationValue is margin (more negative is better)
	const value = evaluationMethod === 'mean'
		? mean
		: evaluationMethod === 'median'
		? median
		: mean + median;

	// Get chart data from the appropriate representative run
	const runType = evaluationMethod === 'mean' ? 'meanrun' : evaluationMethod === 'median' ? 'medianrun' : 'meanrun';
	const chartData = comparisonResult.runData?.[runType] ||
		comparisonResult.runData?.meanrun ||
		comparisonResult.runData?.minrun ||
		null;

	return {
		value,
		chartData,
		runData: {
			...(comparisonResult.runData || {}),
			__diffs: diffs,
			__marginStats: {
				min: sorted.length ? sorted[0] : 0,
				max: sorted.length ? sorted[sorted.length - 1] : 0,
				mean,
				median
			}
		}
	};
}

/**
 * Run optimization
 */
export async function runOptimization(
	course: CourseData,
	racedef: RaceParameters,
	uma: HorseState,
	uniqueSkillId: string | undefined,
	maxCareerRating: number,
	options: any,
	useReferenceInit: boolean = false,
	initCandidates: number = 100,
	initSamples: number = 10,
	iterSamples: number = 50,
	finalRunSamples: number = 200,
	maxIterations: number = 50,
	evaluationMethod: EvaluationMethod = 'median',
	minStat: number = 300,
	maxStat: number = 1200,
	onInitProgress?: (completed: number, total: number) => void,
	onProgress?: (iteration: OptimizerIteration) => void,
	onFinalProgress?: (completed: number, total: number) => void
): Promise<OptimizerResult> {
	// Calculate skill score (excluding unique skill)
	const allSkills = Array.from(uma.skills.values());
	const skillIds = uniqueSkillId ? allSkills.filter(id => id !== uniqueSkillId) : allSkills;
	const skillScore = await calculateSkillScore(skillIds);
	
	const baseSeed = options.seed || 2615953739;
	const rng = new Rule30CARng(baseSeed);
	const random = () => rng.random();
	
	// Create a fixed reference uma (use initial uma stats but keep it constant)
	const referenceUma = uma;
	
	// Monte Carlo initialization: generate random umas, or use reference as IC
	let bestInitial: OptimizerStats | null = null;
	let bestInitialValue = Infinity;
	let bestInitialChartData: any = null;
	let bestInitialRunData: any = null;
	
	if (useReferenceInit) {
		const stats = {
			speed: uma.speed,
			stamina: uma.stamina,
			power: uma.power,
			guts: uma.guts,
			wisdom: uma.wisdom
		};
		const evalResult = evaluateStats(stats, course, racedef, uma, referenceUma, options, initSamples, evaluationMethod);
		bestInitialValue = evalResult.value;
		bestInitial = stats;
		bestInitialChartData = evalResult.chartData;
		bestInitialRunData = evalResult.runData;
		onInitProgress?.(1, 1);
	} else {
		const initialCandidates: OptimizerStats[] = [];
		for (let i = 0; i < initCandidates; i++) {
			const stats = generateRandomStats(
				skillScore,
				uma.starLevel,
				uma.uniqueLevel,
				maxCareerRating,
				minStat,
				maxStat,
				random
			);
			if (stats) {
				initialCandidates.push(stats);
			}
		}
		
		// Evaluate initial candidates
		let initCompleted = 0;
		for (const stats of initialCandidates) {
			const evalResult = evaluateStats(stats, course, racedef, uma, referenceUma, options, initSamples, evaluationMethod);
			initCompleted += 1;
			onInitProgress?.(initCompleted, initCandidates);
			if (evalResult.value < bestInitialValue) {
				bestInitialValue = evalResult.value;
				bestInitial = stats;
				bestInitialChartData = evalResult.chartData;
				bestInitialRunData = evalResult.runData;
			}
		}
	}
	
	if (!bestInitial) {
		throw new Error('Failed to generate valid initial stats');
	}
	
	let currentStats = { ...bestInitial };
	let currentValue = bestInitialValue;
	let currentChartData = bestInitialChartData;
	let currentRunData = bestInitialRunData;
	let bestStats = { ...bestInitial };
	let bestValue = bestInitialValue;
	let stagnation = 0;
	
	const iterations: OptimizerIteration[] = [];
	const convergenceHistory: number[] = [bestInitialValue];
	const tolerance = 0.001; // Convergence tolerance
	let convergenceStreak = 0;
	
	// Record initial iteration
	const initialRating = calculateRatingBreakdown(currentStats, skillScore, uma.starLevel, uma.uniqueLevel);
	{
		const diffs: number[] = (bestInitialRunData && bestInitialRunData.__diffs) ? bestInitialRunData.__diffs : [];
		const marginStats = (bestInitialRunData && bestInitialRunData.__marginStats) ? bestInitialRunData.__marginStats : {
			min: 0, max: 0, mean: 0, median: 0
		};
		iterations.push({
			iteration: 0,
			stats: { ...currentStats },
			evaluationValue: currentValue,
			diffs,
			marginStats,
			careerRating: initialRating.total,
			valid: true,
			chartData: currentChartData,
			runData: bestInitialRunData,
			bestSoFarValue: bestValue,
			bestSoFarStats: { ...bestStats },
			bestSoFarCareerRating: initialRating.total
		});
	}
	onProgress?.(iterations[0]);
	
	// Optimization loop
	for (let iter = 1; iter <= maxIterations; iter++) {
		// Mutation rate decreases over time
		const mutationRate = 0.5 * (1 - iter / maxIterations) + 0.1;
		const mutationAmount = Math.round(20 + (1 - iter / maxIterations) * 60);
		const randomCandidateRate = 0.05;
		
		// Try multiple mutations and pick the best
		let candidateStats: OptimizerStats | null = null;
		let candidateValue = Infinity;
		let candidateChartData: any = null;
		let candidateRunData: any = null;
		
		// Try multiple mutations per iteration
		for (let mutation = 0; mutation < 5; mutation++) {
			const baseStats = random() < 0.6 ? bestStats : currentStats;
			const mutated = random() < randomCandidateRate
				? generateRandomStats(
					skillScore,
					uma.starLevel,
					uma.uniqueLevel,
					maxCareerRating,
					minStat,
					maxStat,
					random
				)
				: mutateStats(
					baseStats,
					skillScore,
					uma.starLevel,
					uma.uniqueLevel,
					maxCareerRating,
					minStat,
					maxStat,
					mutationRate,
					mutationAmount,
					random
				);
			
			if (mutated) {
				let evalResult = evaluateStats(
					mutated,
					course,
					racedef,
					uma,
					referenceUma,
					options,
					iterSamples,
					evaluationMethod
				);

				// Confirm improvements with extra samples to reduce variance
				if (evalResult.value < bestValue) {
					const confirmSamples = Math.min(iterSamples * 5, finalRunSamples);
					evalResult = evaluateStats(
						mutated,
						course,
						racedef,
						uma,
						referenceUma,
						options,
						confirmSamples,
						evaluationMethod
					);
				}
				
				if (evalResult.value < candidateValue) {
					candidateValue = evalResult.value;
					candidateStats = mutated;
					candidateChartData = evalResult.chartData;
					candidateRunData = evalResult.runData;
				}
			}
		}
		
		// Accept if better, or with probability if worse (simulated annealing)
		if (candidateStats) {
			const temp = 0.5 * (1 - iter / maxIterations) + 0.1; // Cooling schedule
			const accept = candidateValue < currentValue || random() < Math.exp(-(candidateValue - currentValue) / temp);
			
			if (accept) {
				currentStats = candidateStats;
				currentValue = candidateValue;
				currentChartData = candidateChartData;
				currentRunData = candidateRunData;
				
				if (candidateValue < bestValue) {
					bestStats = { ...candidateStats };
					bestValue = candidateValue;
					stagnation = 0;
				} else {
					stagnation += 1;
				}
			}
		} else {
			stagnation += 1;
		}

		// If we're stuck or repeatedly converging, force a random restart candidate
		if (stagnation >= 10 || convergenceStreak >= 2) {
			const restart = mutateStats(
				bestStats,
				skillScore,
				uma.starLevel,
				uma.uniqueLevel,
				maxCareerRating,
				minStat,
				maxStat,
				1.0,
				mutationAmount * 2,
				random
			);
			if (restart) {
				const evalResult = evaluateStats(
					restart,
					course,
					racedef,
					uma,
					referenceUma,
					options,
					iterSamples,
					evaluationMethod
				);
				currentStats = restart;
				currentValue = evalResult.value;
				currentChartData = evalResult.chartData;
				currentRunData = evalResult.runData;
			}
			stagnation = 0;
			convergenceStreak = 0;
		}
		
		// Track convergence
		convergenceHistory.push(currentValue);
		const convergence = convergenceHistory.length >= 5 
			? Math.abs(convergenceHistory[convergenceHistory.length - 1] - convergenceHistory[convergenceHistory.length - 5]) < tolerance
			: false;
		if (convergence) {
			convergenceStreak += 1;
		} else {
			convergenceStreak = 0;
		}
		
		const rating = calculateRatingBreakdown(currentStats, skillScore, uma.starLevel, uma.uniqueLevel);
		const diffs: number[] = (currentRunData && currentRunData.__diffs) ? currentRunData.__diffs : [];
		const marginStats = (currentRunData && currentRunData.__marginStats) ? currentRunData.__marginStats : {
			min: 0, max: 0, mean: 0, median: 0
		};
		const roundedBestStats = {
			speed: Math.round(bestStats.speed),
			stamina: Math.round(bestStats.stamina),
			power: Math.round(bestStats.power),
			guts: Math.round(bestStats.guts),
			wisdom: Math.round(bestStats.wisdom)
		};
		const bestSoFarRating = calculateRatingBreakdown(roundedBestStats, skillScore, uma.starLevel, uma.uniqueLevel).total;
		const iteration: OptimizerIteration = {
			iteration: iter,
			stats: { ...currentStats },
			evaluationValue: currentValue,
			diffs,
			marginStats,
			careerRating: rating.total,
			valid: rating.total <= maxCareerRating,
			chartData: currentChartData,
			runData: currentRunData,
			bestSoFarValue: bestValue,
			bestSoFarStats: { ...bestStats },
			bestSoFarCareerRating: bestSoFarRating
		};
		
		iterations.push(iteration);
		onProgress?.(iteration);
		
		// Do not early-stop; use convergence to trigger restarts instead.
	}
	
	const bestIter = iterations.reduce((best, it) => {
		return it.evaluationValue < best.evaluationValue ? it : best;
	}, iterations[0]);
	const finalStats = { ...bestIter.stats };
	// Signal final run start so UI can switch to best-so-far before samples begin
	onFinalProgress?.(0, finalRunSamples);
	const finalEval = evaluateStats(finalStats, course, racedef, uma, referenceUma, options, finalRunSamples, evaluationMethod, onFinalProgress);
	const finalRoundedStats = {
		speed: Math.round(finalStats.speed),
		stamina: Math.round(finalStats.stamina),
		power: Math.round(finalStats.power),
		guts: Math.round(finalStats.guts),
		wisdom: Math.round(finalStats.wisdom)
	};
	const finalCareerRating = calculateRatingBreakdown(finalRoundedStats, skillScore, uma.starLevel, uma.uniqueLevel).total;
	return {
		iterations,
		finalStats,
		bestValue: bestIter.evaluationValue,
		bestStats: finalStats,
		evaluationMethod,
		finalRunData: finalEval.runData,
		finalChartData: finalEval.chartData,
		finalCareerRating
	};
}

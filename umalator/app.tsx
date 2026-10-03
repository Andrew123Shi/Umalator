import { h, Fragment, render } from 'preact';
import type { ComponentChildren } from 'preact';
import { useState, useReducer, useMemo, useEffect, useLayoutEffect, useRef, useId, useCallback } from 'preact/hooks';
import { Text, IntlProvider } from 'preact-i18n';
import { Info, Settings } from 'lucide-preact';
import { Record, Set as ImmSet, Map as ImmMap } from 'immutable';
import * as d3 from 'd3';
import { computePosition, flip } from '@floating-ui/dom';

import '../components/theme.css';

import { CourseHelpers, CourseData, DistanceType, Surface } from '../uma-skill-tools/CourseData';
import courses from '../uma-skill-tools/data/course_data.json';
import { RaceParameters, Mood, GroundCondition, Weather, Season, Time, Grade } from '../uma-skill-tools/RaceParameters';
import { PosKeepMode } from '../uma-skill-tools/RaceSolver';
import type { GameHpPolicy } from '../uma-skill-tools/HpPolicy';

import { Language, LanguageSelect, useLanguageSelect } from '../components/Language';
import { ExpandedSkillDetails, Skill, SkillList, SkillIconTypeFilter, SkillRarityFilter, createInitialIconTypeFilterState, createInitialRarityFilterState, skillPassesIconTypeFilters, skillPassesRarityFilters, STRINGS_en as SKILL_STRINGS_en } from '../components/SkillList';
import type { SkillIconTypeFilterState, SkillRarityFilterState } from '../components/SkillList';
import { RaceTrack, TrackSelect, RegionDisplayType } from '../components/RaceTrack';
import { HorseState, SkillSet, RANDOM_MOOD } from '../components/HorseDefTypes';
import { HorseDef, horseDefTabs, isGeneralSkill } from '../components/HorseDef';
import { getRatingBadge } from '../components/CareerRating';
import { SkillProcDataDialog } from '../components/SkillProcDataDialog';
import { applyAssetCssVars, appIconUrl, umaToolsAsset, withBasePath } from '../components/assetPaths';
import { installUiScale, useUiViewport, visualScale } from '../components/uiScale';
import type { UiViewport } from '../components/uiScale';
import { TRACKNAMES_ja, TRACKNAMES_en } from '../strings/common';
import { RaceState } from '../uma-skill-tools/RaceSolver';

import { getActivateableSkills, isPurpleSkill, getNullRow, BasinnChart } from './BasinnChart';

import { initTelemetry, postEvent } from './telemetry';

import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import skillmeta from './skill_meta.json';
import nonGlobalPresetDefs from './presets.json';
import globalPresetDefs from '../umalator-global/presets.json';

// Global build flag injected at runtime
declare const CC_GLOBAL: boolean;

import './app.css';

const DEFAULT_SAMPLES = 500;
const CHART_PROGRESS_RENDER_INTERVAL_MS = 100;
const DEFAULT_SEED = 2615953739;

type OptimizerMaxStatKey = 'speed' | 'stamina' | 'power' | 'guts' | 'wisdom';
type OptimizerMaxStatPreset = 'ura' | 'unity' | 'trackblazer' | 'concert' | 'custom';
type OptimizerMaxStats = Record<OptimizerMaxStatKey, number>;

const OPTIMIZER_MAX_STAT_PRESETS: Record<OptimizerMaxStatPreset, OptimizerMaxStats> = {
	ura: {speed: 1400, stamina: 1400, power: 1400, guts: 1400, wisdom: 1400},
	unity: {speed: 1300, stamina: 1300, power: 1300, guts: 1300, wisdom: 1800},
	trackblazer: {speed: 1200, stamina: 1900, power: 1200, guts: 1200, wisdom: 1500},
	concert: {speed: 1600, stamina: 1300, power: 1300, guts: 1500, wisdom: 1300},
	custom: {speed: 2000, stamina: 2000, power: 2000, guts: 2000, wisdom: 2000}
};

function optimizerMaxStatsEqual(a: OptimizerMaxStats, b: OptimizerMaxStats) {
	return a.speed === b.speed && a.stamina === b.stamina && a.power === b.power && a.guts === b.guts && a.wisdom === b.wisdom;
}

function presetForOptimizerMaxStats(stats: OptimizerMaxStats): OptimizerMaxStatPreset {
	const match = (Object.keys(OPTIMIZER_MAX_STAT_PRESETS) as OptimizerMaxStatPreset[])
		.find(key => key !== 'custom' && optimizerMaxStatsEqual(OPTIMIZER_MAX_STAT_PRESETS[key], stats));
	return match || 'custom';
}

// Race track plot width: fills the main column minus the plot's 50px axis
// margins and some breathing room, capped at 1400.
function trackWidthFor(viewport: UiViewport) {
	return Math.round(Math.max(480, Math.min(1400, viewport.mainWidth - 80)));
}



class RaceParams extends Record({
	mood: 2 as Mood,
	ground: GroundCondition.Good,
	weather: Weather.Sunny,
	season: Season.Spring,
	time: Time.Midday,
	grade: Grade.G1
}) {}

const enum EventType { CM, LOH }

const PRESET_EVENT_TYPE = Object.freeze({
	CM: EventType.CM,
	LOH: EventType.LOH
});
const PRESET_SEASON = Object.freeze({
	Spring: Season.Spring,
	Summer: Season.Summer,
	Autumn: Season.Autumn,
	Winter: Season.Winter,
	Sakura: Season.Sakura
});
const PRESET_GROUND = Object.freeze({
	Good: GroundCondition.Good,
	Yielding: GroundCondition.Yielding,
	Soft: GroundCondition.Soft,
	Heavy: GroundCondition.Heavy
});
const PRESET_WEATHER = Object.freeze({
	Sunny: Weather.Sunny,
	Cloudy: Weather.Cloudy,
	Rainy: Weather.Rainy,
	Snowy: Weather.Snowy
});
const PRESET_TIME = Object.freeze({
	NoTime: Time.NoTime,
	Morning: Time.Morning,
	Midday: Time.Midday,
	Evening: Time.Evening,
	Night: Time.Night
});
const PRESET_SEASON_LABEL = Object.freeze({
	[Season.Spring]: 'Spring',
	[Season.Summer]: 'Summer',
	[Season.Autumn]: 'Autumn',
	[Season.Winter]: 'Winter',
	[Season.Sakura]: 'Sakura'
});
const PRESET_GROUND_LABEL = Object.freeze({
	[GroundCondition.Good]: 'Good',
	[GroundCondition.Yielding]: 'Yielding',
	[GroundCondition.Soft]: 'Soft',
	[GroundCondition.Heavy]: 'Heavy'
});
const PRESET_WEATHER_LABEL = Object.freeze({
	[Weather.Sunny]: 'Sunny',
	[Weather.Cloudy]: 'Cloudy',
	[Weather.Rainy]: 'Rainy',
	[Weather.Snowy]: 'Snowy'
});
const PRESET_TIME_LABEL = Object.freeze({
	[Time.NoTime]: 'NoTime',
	[Time.Morning]: 'Morning',
	[Time.Midday]: 'Midday',
	[Time.Evening]: 'Evening',
	[Time.Night]: 'Night'
});
const presetDefs = CC_GLOBAL ? globalPresetDefs : nonGlobalPresetDefs;

type PresetDef = {
	id?: number
	name?: string
	type?: string
	date: string
	courseId: number
	season: keyof typeof PRESET_SEASON
	time: keyof typeof PRESET_TIME
	ground?: keyof typeof PRESET_GROUND
	weather?: keyof typeof PRESET_WEATHER
}

const presets = (presetDefs as PresetDef[])
	.map(def => {
		const typeKey = typeof def.type == 'string' ? def.type.trim() : '';
		const eventType = typeKey.length > 0 ? PRESET_EVENT_TYPE[typeKey as keyof typeof PRESET_EVENT_TYPE] : undefined;
		return {
			id: def.id,
			name: def.name,
			type: eventType,
			rawType: typeKey,
			date: new Date(def.date),
			courseId: def.courseId,
			racedef: new RaceParams({
				mood: 2 as Mood,
				ground: eventType == EventType.CM ? PRESET_GROUND[def.ground ?? 'Good'] : GroundCondition.Good,
				weather: eventType == EventType.CM ? PRESET_WEATHER[def.weather ?? 'Sunny'] : Weather.Sunny,
				season: PRESET_SEASON[def.season],
				time: PRESET_TIME[def.time],
				grade: Grade.G1
			})
		};
	})
	.sort((a,b) => +b.date - +a.date);

const DEFAULT_PRESET = presets[Math.max(presets.findIndex((now => p => new Date(p.date.getFullYear(), p.date.getUTCMonth() + 1, 0) < now)(new Date())) - 1, 0)];
const DEFAULT_COURSE_ID = DEFAULT_PRESET.courseId;

const UI_ja = Object.freeze({
	'stats': Object.freeze(['なし', 'スピード', 'スタミナ', 'パワー', '根性', '賢さ']),
	'joiner': '、',
});

const UI_en = Object.freeze({
	'stats': Object.freeze(['None', 'Speed', 'Stamina', 'Power', 'Guts', 'Wisdom']),
	'joiner': ', ',
});

const UI_global = Object.freeze({
	'stats': Object.freeze(['None', 'Speed', 'Stamina', 'Power', 'Guts', 'Wit']),
	'joiner': ', ',
});

function id(x) { return x; }

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	const secondsStr = remainingSeconds.toFixed(3).padStart(6, '0');
	return `${minutes}:${secondsStr}`;
}

function rankForStat(x: number) {
	// Match `components/HorseDef.tsx` exactly for rank icons
	if (x > 1200) {
		// over 1200 letter (eg UG) goes up by 100 and minor number (eg UG8) goes up by 10
		return Math.min(18 + Math.floor((x - 1200) / 100) * 10 + Math.floor(x / 10) % 10, 97);
	} else if (x >= 1150) {
		return 17; // SS+
	} else if (x >= 1100) {
		return 16; // SS
	} else if (x >= 400) {
		// between 400 and 1100 letter goes up by 100 starting with C (8)
		return 8 + Math.floor((x - 400) / 100);
	} else {
		// between 1 and 400 letter goes up by 50 starting with G+ (0)
		return Math.floor(x / 50);
	}
}

function OptimizerStatsBar({stats, onLoadToUma1, careerRating, isOptimal}: {
	stats: any,
	onLoadToUma1: () => void,
	careerRating: number | null | undefined,
	isOptimal: boolean
}) {
	if (!stats) return null;
	const rounded = {
		speed: Math.round(stats.speed),
		stamina: Math.round(stats.stamina),
		power: Math.round(stats.power),
		guts: Math.round(stats.guts),
		wisdom: Math.round(stats.wisdom)
	};
	const statItems = [
		{key: 'speed', label: 'Speed', icon: '00'},
		{key: 'stamina', label: 'Stamina', icon: '01'},
		{key: 'power', label: 'Power', icon: '02'},
		{key: 'guts', label: 'Guts', icon: '03'},
		{key: 'wisdom', label: CC_GLOBAL ? 'Wit' : 'Wisdom', icon: '04'}
	] as const;
	const ratingBadge = getRatingBadge(careerRating || 0);
	return (
		<div class="optimizerStatsBar">
			<div class="optimizerStatsHeading">
				<strong>{isOptimal ? 'Optimal Stats' : 'Current Best Candidate'}</strong>
			</div>
			<div class="optimizerCareerRating">
				<span class="optimizerCareerRatingLabel">Career rating</span>
				<div class="optimizerCareerRatingValue">
					<span
						class="optimizerCareerRatingBadge"
						style={{
							backgroundImage: `url(${umaToolsAsset('icons/rank_badges.png')})`,
							backgroundPosition: `-${ratingBadge.sprite.col * 52}px -${ratingBadge.sprite.row * 52}px`
						}}
						title={ratingBadge.label}
					/>
					<strong>{careerRating != null ? Math.round(careerRating).toLocaleString() : '—'}</strong>
				</div>
			</div>
			<div class="optimizerCandidateStats">
				{statItems.map(({key, label, icon}) => (
					<div class={`optimizerCandidateStat optimizerCandidateStat--${key}`} key={key}>
						<div class="optimizerCandidateStatLabel">
							<img src={umaToolsAsset(`icons/status_${icon}.png`)} />
							<span>{label}</span>
						</div>
						<div class="optimizerCandidateStatValue">
							<img src={umaToolsAsset(`icons/statusrank/ui_statusrank_${(100 + rankForStat(rounded[key])).toString().slice(1)}.png`)} />
							<strong>{rounded[key]}</strong>
						</div>
					</div>
				))}
			</div>
			<div class="optimizerCandidateActions">
				<button type="button" class="resetUmaButton app-btn app-btn-primary optimizerApplyButton" onClick={onLoadToUma1}>
					Apply Stats
				</button>
			</div>
		</div>
	);
}

function binSearch(a: number[], x: number) {
	let lo = 0, hi = a.length - 1;
	if (x < a[0]) return 0;
	if (x > a[hi]) return hi - 1;
	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (x < a[mid]) {
			hi = mid - 1;
		} else if (x > a[mid]) {
			lo = mid + 1;
		} else {
			return mid;
		}
	}
	return Math.abs(a[lo] - x) < Math.abs(a[hi] - x) ? lo : hi;
}

function TimeOfDaySelect(props) {
	function click(e) {
		e.stopPropagation();
		if (!('timeofday' in e.target.dataset)) return;
		props.set(+e.target.dataset.timeofday);
	}
	// + 2 because for some reason the icons are 00-02 (noon/evening/night) but the enum values are 1-4 (morning(?) noon evening night)
	return (
		<div class="timeofdaySelect" onClick={click}>
			{Array(3).fill(0).map((_,i) =>
				<img src={umaToolsAsset(`icons/utx_ico_timezone_0${i}.png`)} title={SKILL_STRINGS_en.skilldetails.time[i+2]}
					class={i+2 == props.value ? 'selected' : ''} data-timeofday={i+2} />)}
		</div>
	);
}

function GlobalFilterButtons<T extends number>(props: {
	id: string,
	value: T,
	tabindex: number,
	options: Array<{value: T, label: string, hint?: string, tone?: string}>,
	onChange: (value: T) => void
}) {
	function onKeyDown(e) {
		const idx = props.options.findIndex(o => o.value === props.value);
		if (idx < 0) return;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
			e.preventDefault();
			props.onChange(props.options[(idx + 1) % props.options.length].value);
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
			e.preventDefault();
			props.onChange(props.options[(idx - 1 + props.options.length) % props.options.length].value);
		}
	}
	return (
		<div
			id={props.id}
			class="globalFilterButtons"
			role="radiogroup"
			tabindex={props.tabindex}
			onKeyDown={onKeyDown}
		>
			{props.options.map(opt => (
				<button
					type="button"
					key={opt.value}
					class={`globalFilterButton${opt.tone ? ` globalFilterButton--${opt.tone}` : ''}${opt.value === props.value ? ' active' : ''}`}
					role="radio"
					aria-checked={opt.value === props.value ? 'true' : 'false'}
					tabindex={-1}
					title={opt.hint ? `${opt.label} (${opt.hint})` : opt.label}
					onClick={() => props.onChange(opt.value)}
				>
					<span class="globalFilterButtonLabel">{opt.label}</span>
					{opt.hint && <span class="globalFilterButtonHint">{opt.hint}</span>}
				</button>
			))}
		</div>
	);
}

function GroundSelect(props) {
	if (CC_GLOBAL) {
		return (
			<select class="groundSelect" value={props.value} onInput={(e) => props.set(+e.currentTarget.value)}>
				<option value="1">Firm</option>
				<option value="2">Good</option>
				<option value="3">Soft</option>
				<option value="4">Heavy</option>
			</select>
		);
	}
	return (
		<select class="groundSelect" value={props.value} onInput={(e) => props.set(+e.currentTarget.value)}>
			<option value="1">良</option>
			<option value="2">稍重</option>
			<option value="3">重</option>
			<option value="4">不良</option>
		</select>
	);
}

function WeatherSelect(props) {
	function click(e) {
		e.stopPropagation();
		if (!('weather' in e.target.dataset)) return;
		props.set(+e.target.dataset.weather);
	}
	return (
		<div class="weatherSelect" onClick={click}>
			{Array(4).fill(0).map((_,i) =>
				<img src={umaToolsAsset(`icons/utx_ico_weather_0${i}.png`)} title={SKILL_STRINGS_en.skilldetails.weather[i+1]}
					class={i+1 == props.value ? 'selected' : ''} data-weather={i+1} />)}
		</div>
	);
}

function SeasonSelect(props) {
	function click(e) {
		e.stopPropagation();
		if (!('season' in e.target.dataset)) return;
		props.set(+e.target.dataset.season);
	}
	return (
		<div class="seasonSelect" onClick={click}>
			{Array(4 + +!CC_GLOBAL /* global doenst have late spring for some reason */).fill(0).map((_,i) =>
				<img src={umaToolsAsset(`icons${CC_GLOBAL?'/global':''}/utx_txt_season_0${i}.png`)} title={SKILL_STRINGS_en.skilldetails.season[i+1]}
					class={i+1 == props.value ? 'selected' : ''} data-season={i+1} />)}
		</div>
	);
}

function Histogram(props) {
	const {data, width, height} = props;
	const axes = useRef(null);
	const topPad = 10;
	const bottomPad = 34;
	const yW = 48;

	const x = d3.scaleLinear().domain(
		data[0] == 0 && data[data.length-1] == 0
			? [-1,1]
			: [Math.min(0,Math.floor(data[0])),Math.ceil(data[data.length-1])]
	).range([yW,width-yW]);
	const bucketize = d3.bin().value(id).domain(x.domain()).thresholds(x.ticks(30));
	const buckets = bucketize(data);
	const y = d3.scaleLinear().domain([0,d3.max(buckets, b => b.length)]).range([height-bottomPad,topPad]);

	useEffect(function () {
		const g = d3.select(axes.current);
		g.selectAll('*').remove();
		g.append('g').attr('transform', `translate(0,${height - bottomPad})`).call(d3.axisBottom(x));
		g.append('g').attr('transform', `translate(${yW},0)`).call(d3.axisLeft(y));
		g.selectAll('.domain, .tick line').attr('stroke', 'rgba(232, 240, 255, 0.45)');
		g.selectAll('.tick text').attr('fill', 'rgba(232, 240, 255, 0.72)');
	}, [data, width, height]);

	const rects = buckets.map((b,i) => {
		const bucketMidpoint = ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2;
		const fillColor = bucketMidpoint > 0 ? '#ef5350' : '#6ea8fe';
		return (
			<rect key={i} fill={fillColor} fill-opacity="0.75" stroke="rgba(232, 240, 255, 0.45)" x={x(b.x0)} y={y(b.length)} width={x(b.x1) - x(b.x0)} height={height - bottomPad - y(b.length)} />
		);
	});
	return (
		<svg id="histogram" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
			<g class="histogramGrid">
				{y.ticks(5).map(tick =>
					<line x1={yW} x2={width-yW} y1={y(tick)} y2={y(tick)} />
				)}
			</g>
			{x.domain()[0] < 0 && x.domain()[1] > 0 && (
				<line class="histogramZeroLine" x1={x(0)} x2={x(0)} y1={topPad} y2={height-bottomPad} />
			)}
			<g>{rects}</g>
			<g ref={axes}></g>
			<text class="histogramAxisLabel" x={width / 2} y={height - 3} text-anchor="middle">Finish margin (lengths)</text>
			<text class="histogramAxisLabel" x="11" y={height / 2} text-anchor="middle" transform={`rotate(-90 11 ${height / 2})`}>Samples</text>
		</svg>
	);
}

function HistogramResultCard(props) {
	const data = props.data;
	const leftLabel = props.leftLabel || 'Uma 1';
	const rightLabel = props.rightLabel || 'Uma 2';
	const part = props.part || 'all';
	const uma1Wins = data.filter(value => value < 0).length;
	const ties = data.filter(value => value == 0).length;
	const uma2Wins = data.length - uma1Wins - ties;
	const percentage = (count) => count / data.length * 100;

	const outcome = (
		<div class="histogramOutcome">
			<div class="histogramOutcomeLabels">
				<span><strong>{percentage(uma1Wins).toFixed(1)}%</strong> {leftLabel}</span>
				{ties > 0 && <span><strong>{percentage(ties).toFixed(1)}%</strong> Tied</span>}
				<span>{rightLabel} <strong>{percentage(uma2Wins).toFixed(1)}%</strong></span>
			</div>
			<div class="histogramOutcomeBar" aria-hidden="true">
				<div class="uma1Outcome" style={`width:${percentage(uma1Wins)}%`} />
				{ties > 0 && <div class="tieOutcome" style={`width:${percentage(ties)}%`} />}
				<div class="uma2Outcome" style={`width:${percentage(uma2Wins)}%`} />
			</div>
		</div>
	);

	return (
		<div class={`resultsCard histogramCard${part === 'chart' ? ' histogramChartCard' : ''}${props.compact ? ' histogramCard--compact' : ''}`}>
			<div class="histogramChartWrap">
				<Histogram width={560} height={props.compact ? 250 : 380} data={data} />
			</div>
			{outcome}
		</div>
	);
}

function OptimizerGraphs({iterations, width: widthProp}: {iterations: any[], width?: number}) {
	if (!iterations || iterations.length === 0) return null;
	
	const width = widthProp || 420;
	const height = 260;
	const margin = { top: 10, right: 16, bottom: 42, left: 48 };
	const chartWidth = width - margin.left - margin.right;
	const chartHeight = height - margin.top - margin.bottom;
	
	// Cost function graph (margin of win over iterations)
	const costAxes = useRef(null);
	const costLine = useRef(null);
	const bestCostLine = useRef(null);
	
	useEffect(() => {
		if (!costAxes.current || !costLine.current || !bestCostLine.current) return;
		
		const x = d3.scaleLinear()
			.domain([0, iterations.length - 1])
			.range([0, chartWidth]);
		const bestSoFar: number[] = [];
		let runningBest = Infinity;
		iterations.forEach((it) => {
			runningBest = Math.min(runningBest, it.evaluationValue);
			bestSoFar.push(runningBest);
		});
		const y = d3.scaleLinear()
			.domain(d3.extent([
				...iterations.map(it => it.evaluationValue),
				...bestSoFar
			]))
			.range([chartHeight, 0]);
		
		const candidateLine = d3.line()
			.x((d, i) => x(i))
			.y(d => y(d.evaluationValue))
			.curve(d3.curveMonotoneX);
		const bestLine = d3.line()
			.x((d, i) => x(i))
			.y(d => y(d))
			.curve(d3.curveMonotoneX);
		
		d3.select(costLine.current).selectAll('*').remove();
		d3.select(bestCostLine.current).selectAll('*').remove();
		d3.select(costAxes.current).selectAll('*').remove();
		
		d3.select(costLine.current)
			.append('path')
			.datum(iterations)
			.attr('fill', 'none')
			.attr('stroke', 'rgba(110, 168, 254, 0.62)')
			.attr('stroke-width', 1.75)
			.attr('d', candidateLine);

		d3.select(bestCostLine.current)
			.append('path')
			.datum(bestSoFar)
			.attr('fill', 'none')
			.attr('stroke', '#ffb74d')
			.attr('stroke-width', 3)
			.attr('d', bestLine);
		
		const xAxis = d3.axisBottom(x).ticks(Math.min(6, iterations.length)).tickPadding(8);
		const yAxis = d3.axisLeft(y).ticks(5).tickSize(-chartWidth).tickPadding(8);
		
		const costAxesG = d3.select(costAxes.current);
		costAxesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		
		costAxesG
			.append('g')
			.call(yAxis);

		costAxesG.selectAll('.domain').attr('stroke', 'rgba(148, 163, 184, 0.2)');
		costAxesG.selectAll('.tick line').attr('stroke', 'rgba(148, 163, 184, 0.12)');
		costAxesG.selectAll('.tick text').attr('fill', 'rgba(232, 240, 255, 0.62)').style('font-family', 'inherit').style('font-size', '10px');
	}, [iterations, chartWidth, chartHeight]);
	
	// Convergence graph
	const convergenceAxes = useRef(null);
	const convergenceLine = useRef(null);
	
	useEffect(() => {
		if (!convergenceAxes.current || !convergenceLine.current || iterations.length < 2) return;
		
		// Calculate convergence: difference between current and previous value
		const convergence = iterations.map((it, idx) => {
			if (idx === 0) return 0;
			return Math.abs(it.evaluationValue - iterations[idx - 1].evaluationValue);
		});
		
		const x = d3.scaleLinear()
			.domain([0, iterations.length - 1])
			.range([0, chartWidth]);
		
		const y = d3.scaleLog()
			.clamp(true)
			.domain([Math.max(1e-6, d3.min(convergence.filter(v => v > 0)) || 1e-6), d3.max(convergence) || 1])
			.range([chartHeight, 0]);
		
		const line = d3.line()
			.x((d, i) => x(i))
			.y(d => y(d))
			.curve(d3.curveMonotoneX);
		
		// Clear previous
		d3.select(convergenceLine.current).selectAll('*').remove();
		d3.select(convergenceAxes.current).selectAll('*').remove();
		
		// Draw line
		d3.select(convergenceLine.current)
			.append('path')
			.datum(convergence)
			.attr('fill', 'none')
			.attr('stroke', '#ef5350')
			.attr('stroke-width', 2)
			.attr('d', line);
		
		// Draw axes
		const xAxis = d3.axisBottom(x).ticks(Math.min(6, iterations.length)).tickPadding(8);
		const yAxis = d3.axisLeft(y).ticks(5, '.1g').tickSize(-chartWidth).tickPadding(8);
		
		const convAxesG = d3.select(convergenceAxes.current);
		convAxesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		
		convAxesG
			.append('g')
			.call(yAxis);

		convAxesG.selectAll('.domain').attr('stroke', 'rgba(148, 163, 184, 0.2)');
		convAxesG.selectAll('.tick line').attr('stroke', 'rgba(148, 163, 184, 0.12)');
		convAxesG.selectAll('.tick text').attr('fill', 'rgba(232, 240, 255, 0.62)').style('font-family', 'inherit').style('font-size', '10px');
	}, [iterations, chartWidth, chartHeight]);
	
	// Stats evolution graph
	const statsAxes = useRef(null);
	const statsLines = useRef(null);
	
	useEffect(() => {
		if (!statsAxes.current || !statsLines.current || iterations.length === 0) return;
		
		const statKeys = ['speed', 'stamina', 'power', 'guts', 'wisdom'];
		const colors = ['#39bfff', '#ff7e6b', '#fea60e', '#fd7fad', '#14d29c'];
		
		const x = d3.scaleLinear()
			.domain([0, iterations.length - 1])
			.range([0, chartWidth]);
		
		const allStats = iterations.flatMap(it => [
			it.stats.speed, it.stats.stamina, it.stats.power, it.stats.guts, it.stats.wisdom
		]);
		const y = d3.scaleLinear()
			.domain(d3.extent(allStats))
			.range([chartHeight, 0]);
		
		const line = d3.line()
			.x((d, i) => x(i))
			.y(d => y(d))
			.curve(d3.curveMonotoneX);
		
		// Clear previous
		d3.select(statsLines.current).selectAll('*').remove();
		d3.select(statsAxes.current).selectAll('*').remove();
		
		// Draw lines for each stat
		statKeys.forEach((key, idx) => {
			const data = iterations.map(it => it.stats[key]);
			d3.select(statsLines.current)
				.append('path')
				.datum(data)
				.attr('fill', 'none')
				.attr('stroke', colors[idx])
				.attr('stroke-width', 2)
				.attr('d', line);
		});
		
		// Draw axes
		const xAxis = d3.axisBottom(x).ticks(Math.min(6, iterations.length)).tickPadding(8);
		const yAxis = d3.axisLeft(y).ticks(5).tickSize(-chartWidth).tickPadding(8);
		
		const statsAxesG = d3.select(statsAxes.current);
		statsAxesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		
		statsAxesG
			.append('g')
			.call(yAxis);

		statsAxesG.selectAll('.domain').attr('stroke', 'rgba(148, 163, 184, 0.2)');
		statsAxesG.selectAll('.tick line').attr('stroke', 'rgba(148, 163, 184, 0.12)');
		statsAxesG.selectAll('.tick text').attr('fill', 'rgba(232, 240, 255, 0.62)').style('font-family', 'inherit').style('font-size', '10px');
	}, [iterations, chartWidth, chartHeight]);

	const bestValue = Math.min(...iterations.map(it => it.evaluationValue));
	const currentValue = iterations[iterations.length - 1].evaluationValue;
	
	return (
		<div class="optimizerGraphs">
			<div class="optimizerGraphsHeader">
				<h2>Optimization Diagnostics</h2>
			</div>
			<div class="optimizerGraphsGrid">
				<section class="optimizerGraphCard optimizerGraphCard--trajectory">
					<div class="optimizerGraphHeading">
						<div>
							<h3>Cost Function Trajectory</h3>
						</div>
						<div class="optimizerTrajectorySummary">
							<span><i class="optimizerGraphSwatch optimizerGraphSwatch--current" aria-hidden="true"></i>Current <strong>{currentValue.toFixed(2)}</strong></span>
							<span><i class="optimizerGraphSwatch optimizerGraphSwatch--best" aria-hidden="true"></i>Best <strong>{bestValue.toFixed(2)}</strong></span>
						</div>
					</div>
					<svg class="optimizerGraphPlot optimizerGraphPlot--trajectory" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
						<g transform={`translate(${margin.left},${margin.top})`}>
							<g ref={costLine}></g>
							<g ref={bestCostLine}></g>
							<g ref={costAxes}></g>
							<text class="optimizerGraphAxisLabel" x={chartWidth / 2} y={chartHeight + 38} textAnchor="middle">Iteration</text>
							<text class="optimizerGraphAxisLabel" x={-chartHeight / 2} y={-40} textAnchor="middle" transform="rotate(-90)">{CC_GLOBAL ? 'Margin (lengths)' : 'Margin (バ身)'}</text>
						</g>
					</svg>
				</section>
				<section class="optimizerGraphCard optimizerGraphCard--convergence">
					<div class="optimizerGraphHeading">
						<div>
							<h3>Convergence</h3>
						</div>
					</div>
					<svg class="optimizerGraphPlot" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
						<g transform={`translate(${margin.left},${margin.top})`}>
							<g ref={convergenceLine}></g>
							<g ref={convergenceAxes}></g>
							<text class="optimizerGraphAxisLabel" x={chartWidth / 2} y={chartHeight + 38} textAnchor="middle">Iteration</text>
							<text class="optimizerGraphAxisLabel" x={-chartHeight / 2} y={-40} textAnchor="middle" transform="rotate(-90)">Change</text>
						</g>
					</svg>
				</section>
				<section class="optimizerGraphCard optimizerGraphCard--stats">
					<div class="optimizerGraphHeading">
						<div>
							<h3>Stat Evolution</h3>
						</div>
						<div class="optimizerGraphLegend">
							{['Speed', 'Stamina', 'Power', 'Guts', CC_GLOBAL ? 'Wit' : 'Wisdom'].map((label, idx) => (
								<div key={label} class={`optimizerGraphLegendItem optimizerGraphLegendItem--${idx}`}>
									<span aria-hidden="true"></span>
									<strong>{label}</strong>
								</div>
							))}
						</div>
					</div>
					<svg class="optimizerGraphPlot" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
						<g transform={`translate(${margin.left},${margin.top})`}>
							<g ref={statsLines}></g>
							<g ref={statsAxes}></g>
							<text class="optimizerGraphAxisLabel" x={chartWidth / 2} y={chartHeight + 38} textAnchor="middle">Iteration</text>
							<text class="optimizerGraphAxisLabel" x={-chartHeight / 2} y={-40} textAnchor="middle" transform="rotate(-90)">Stat value</text>
						</g>
					</svg>
				</section>
			</div>
		</div>
	);
}

const SKILL_CHART_PHASE_COLORS = [
	'rgba(110, 168, 254, 0.18)',
	'rgba(52, 210, 123, 0.16)',
	'rgba(244, 114, 182, 0.16)',
	'rgba(244, 114, 182, 0.16)'
];

function BarChart(props) {
	const {width, height, bins, xScale, yScale, phaseBackgrounds, xAxisTicks, yAxisTicks, yTickValues, yAxisFormat, barColor} = props;
	const axes = useRef(null);
	const gridLines = useRef(null);
	const xH = 20;
	const yW = props.yAxisWidth || 52;
	const rightPad = props.rightPad || 16;
	const chartWidth = width - yW - rightPad;
	const chartHeight = height - xH - 5;

	useEffect(function () {
		if (!axes.current || !gridLines.current) return;
		const axesG = d3.select(axes.current);
		axesG.selectAll('*').remove();
		const xAxis = d3.axisBottom(xScale).ticks(xAxisTicks);
		const yAxis = d3.axisLeft(yScale);
		if (yTickValues) {
			yAxis.tickValues(yTickValues);
		} else {
			yAxis.ticks(yAxisTicks);
		}
		if (yAxisFormat) {
			yAxis.tickFormat(yAxisFormat);
		}
		
		const xAxisG = axesG.append('g').attr('transform', `translate(0,${chartHeight})`).call(xAxis);
		const yAxisG = axesG.append('g').attr('transform', `translate(0,0)`).call(yAxis);
		axesG.selectAll('.domain, .tick line').attr('stroke', 'rgba(232, 240, 255, 0.45)');
		axesG.selectAll('.tick text').attr('fill', 'rgba(232, 240, 255, 0.72)');
		
		const gridG = d3.select(gridLines.current);
		gridG.selectAll('*').remove();
		
		xScale.ticks(xAxisTicks).forEach(tickValue => {
			gridG.append('line')
				.attr('class', 'grid-line')
				.attr('x1', xScale(tickValue))
				.attr('x2', xScale(tickValue))
				.attr('y1', 0)
				.attr('y2', chartHeight)
				.attr('stroke', 'rgba(148, 163, 184, 0.22)')
				.attr('stroke-width', 0.5);
		});
		
		const finalYTickValues = yTickValues || yScale.ticks(yAxisTicks);
		finalYTickValues.forEach((tickValue) => {
			gridG.append('line')
				.attr('class', 'grid-line')
				.attr('x1', 0)
				.attr('x2', chartWidth)
				.attr('y1', yScale(tickValue))
				.attr('y2', yScale(tickValue))
				.attr('stroke', 'rgba(148, 163, 184, 0.22)')
				.attr('stroke-width', 0.5);
		});
	}, [xScale, yScale, chartHeight, chartWidth, xAxisTicks, yAxisTicks, yTickValues, yAxisFormat]);

	const rects = bins.map((bin, i) => {
		const barHeight = chartHeight - yScale(bin.value);
		const binWidth = xScale(bin.end) - xScale(bin.start);
		const barWidth = Math.max(3, binWidth * 1.5);
		const barX = xScale(bin.start) + (binWidth - barWidth) / 2;
		return (
			<rect 
				key={i} 
				fill={barColor || "#6ea8fe"} 
				stroke="none" 
				x={barX} 
				y={yScale(bin.value)} 
				width={barWidth} 
				height={barHeight}
			/>
		);
	});

	return (
		<div class="barChart" style={`width: ${width}px; height: ${height}px;`}>
			<svg width={width} height={height} style="overflow: visible;">
				<g transform={`translate(${yW},5)`}>
					{phaseBackgrounds && phaseBackgrounds.map((phase, i) => (
						<rect
							key={i}
							x={xScale(phase.start)}
							y={0}
							width={xScale(phase.end) - xScale(phase.start)}
							height={chartHeight}
							fill={phase.color}
						/>
					))}
					<g ref={gridLines}></g>
					{rects}
					<g ref={axes}></g>
				</g>
			</svg>
		</div>
	);
}

export function LengthDifferenceChart(props) {
	const {skillId, runData, courseDistance} = props;
	const width = Math.max(120, props.width || 300);
	const height = Math.max(80, props.height || 150);
	const yAxisWidth = props.yAxisWidth || 52;

	if (!skillId || !runData) {
		return null;
	}

	if (!runData.allruns || !runData.allruns.skBasinn || !Array.isArray(runData.allruns.skBasinn)) {
		return null;
	}

	const allActivations: Array<[number, number]> = [];
	
	runData.allruns.skBasinn.forEach((skBasinnMap: any) => {
		if (!skBasinnMap) return;
		let activations = null;
		if (skBasinnMap instanceof Map || (typeof skBasinnMap.has === 'function' && typeof skBasinnMap.get === 'function')) {
			if (skBasinnMap.has(skillId)) {
				activations = skBasinnMap.get(skillId);
			}
		} else if (typeof skBasinnMap === 'object' && skillId in skBasinnMap) {
			activations = skBasinnMap[skillId];
		}
		if (activations && Array.isArray(activations)) {
			activations.forEach((activation: any) => {
				if (Array.isArray(activation) && activation.length === 2 && 
				    typeof activation[0] === 'number' && typeof activation[1] === 'number') {
					allActivations.push([activation[0], activation[1]]);
				}
			});
		}
	});

	if (allActivations.length === 0) {
		return null;
	}

	const binSize = 10;
	const maxDistance = Math.ceil(courseDistance / binSize) * binSize;
	const bins = [];
	for (let i = 0; i < maxDistance; i += binSize) {
		bins.push({start: i, end: i + binSize, maxBasinn: 0});
	}

	allActivations.forEach(([activationPos, basinn]) => {
		if (basinn > 0) {
			const binIndex = Math.floor(activationPos / binSize);
			if (binIndex >= 0 && binIndex < bins.length) {
				bins[binIndex].maxBasinn = Math.max(bins[binIndex].maxBasinn, basinn);
			}
		}
	});

	bins.forEach(bin => {
		bin.value = bin.maxBasinn;
	});

	const maxValue = Math.max(...bins.map(b => b.value), 0);
	if (maxValue === 0) {
		return null;
	}

	const rightPad = props.rightPad || 16;
	const x = d3.scaleLinear().domain([0, maxDistance]).range([0, width - yAxisWidth - rightPad]);
	const y = d3.scaleLinear().domain([0, maxValue]).range([height - 20 - 5, 0]);

	const baseTicks = y.ticks(5);
	const threshold = Math.max(maxValue * 0.02, 0.05);
	const yTickValues = baseTicks.filter(tick => Math.abs(tick - maxValue) >= threshold);
	if (!yTickValues.some(tick => Math.abs(tick - maxValue) < 0.01)) {
		yTickValues.push(maxValue);
		yTickValues.sort((a, b) => a - b);
	}

	const phase0End = CourseHelpers.phaseStart(courseDistance, 1);
	const phase1End = CourseHelpers.phaseStart(courseDistance, 2);
	
	const phaseBackgrounds = [
		{start: 0, end: phase0End, color: SKILL_CHART_PHASE_COLORS[0]},
		{start: phase0End, end: phase1End, color: SKILL_CHART_PHASE_COLORS[1]},
		{start: phase1End, end: courseDistance, color: SKILL_CHART_PHASE_COLORS[2]}
	];

	return (
		<BarChart
			width={width}
			height={height}
			yAxisWidth={yAxisWidth}
			rightPad={rightPad}
			bins={bins}
			xScale={x}
			yScale={y}
			phaseBackgrounds={phaseBackgrounds}
			xAxisTicks={Math.min(6, Math.floor(maxDistance / 200))}
			yAxisTicks={5}
			yTickValues={yTickValues}
			yAxisFormat={(d, i, ticks) => {
				return `${d.toFixed(1)}L`;
			}}
			barColor="#6ea8fe"
		/>
	);
}

function getSkillPositionsFromRun(skillId: string, selectedRun: any, umaIndex?: number): {positions: Array<[number, number]>, umaIndex: number} | null {
	if (!selectedRun?.sk) return null;

	const indices = umaIndex != null ? [umaIndex] : selectedRun.sk.map((_: any, i: number) => i);
	for (const i of indices) {
		const skMap = selectedRun.sk[i];
		if (!skMap) continue;

		let positions = null;
		if (skMap instanceof Map || (typeof skMap.has === 'function' && typeof skMap.get === 'function')) {
			if (skMap.has(skillId)) {
				positions = skMap.get(skillId);
			}
		} else if (typeof skMap === 'object' && skillId in skMap) {
			positions = skMap[skillId];
		}

		if (positions && Array.isArray(positions) && positions.length > 0) {
			return {positions, umaIndex: i};
		}
	}
	return null;
}

function interpolateValue(
	value: number,
	valueArray: number[],
	resultArray: number[]
): number {
	if (valueArray.length === 0 || resultArray.length === 0) return resultArray[0] || 0;
	if (value <= valueArray[0]) return resultArray[0];
	if (value >= valueArray[valueArray.length - 1]) return resultArray[resultArray.length - 1];
	
	for (let i = 0; i < valueArray.length - 1; i++) {
		if (valueArray[i] <= value && value <= valueArray[i + 1]) {
			const v1 = valueArray[i];
			const v2 = valueArray[i + 1];
			const r1 = resultArray[i];
			const r2 = resultArray[i + 1];
			if (v2 === v1) return r1;
			return r1 + (r2 - r1) * (value - v1) / (v2 - v1);
		}
	}
	return resultArray[resultArray.length - 1];
}

function calculatePhaseBackgrounds(
	courseDistance: number,
	positionData: Array<[number, number]>,
	minTime: number,
	maxTime: number
): Array<{start: number, end: number, color: string}> {
	if (!courseDistance || positionData.length === 0) return [];
	
	const phaseEndDistances = [
		CourseHelpers.phaseStart(courseDistance, 1),
		CourseHelpers.phaseStart(courseDistance, 2),
		CourseHelpers.phaseStart(courseDistance, 3)
	];
	
	const positions = positionData.map(([_, pos]) => pos);
	const times = positionData.map(([time, _]) => time);
	
	const phaseEndTimes = phaseEndDistances.map(dist => 
		interpolateValue(dist, positions, times)
	);
	
	const phaseColors = [
		SKILL_CHART_PHASE_COLORS[0],
		SKILL_CHART_PHASE_COLORS[1],
		SKILL_CHART_PHASE_COLORS[2],
		SKILL_CHART_PHASE_COLORS[3]
	];
	
	const backgrounds: Array<{start: number, end: number, color: string}> = [];
	const phaseStarts = [Math.max(minTime, 0), ...phaseEndTimes];
	const phaseEnds = [...phaseEndTimes, maxTime];
	
	for (let i = 0; i < phaseStarts.length; i++) {
		const start = Math.max(minTime, phaseStarts[i]);
		const end = Math.min(maxTime, phaseEnds[i]);
		if (end > start) {
			backgrounds.push({
				start,
				end,
				color: phaseColors[i]
			});
		}
	}
	
	return backgrounds;
}

const UMA_VELOCITY_COLORS = ['#6ea8fe', '#ef5350'];
const SKILL_PROC_VELOCITY_COLOR = '#e040fb';

function strokeVelocityPath(ctx, data, x, y) {
	ctx.beginPath();
	data.forEach((d, i) => {
		const px = x(Number(d[0].toFixed(2)));
		const py = y(Number(d[1].toFixed(2)));
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	});
	ctx.stroke();
}

function drawVelocityTrace(ctx, data, x, y, startTime, endTime, baseColor, activeColor) {
	if (data.length === 0) return;

	ctx.lineWidth = 2;
	ctx.strokeStyle = baseColor;
	strokeVelocityPath(ctx, data, x, y);

	const activeData = [];
	for (let i = 0; i < data.length; i++) {
		const t = data[i][0];
		if (t >= startTime && t <= endTime) {
			if (activeData.length === 0 && i > 0) {
				activeData.push(data[i - 1]);
			}
			activeData.push(data[i]);
		} else if (activeData.length > 0 && t > endTime) {
			activeData.push(data[i]);
			break;
		}
	}

	if (activeData.length > 1) {
		ctx.lineWidth = 3;
		ctx.strokeStyle = activeColor;
		strokeVelocityPath(ctx, activeData, x, y);
	}
}

function buildProcHighlightVelocityModel(props, chartWidth, chartHeight) {
	const {skillId, runData, courseDistance, displaying, umaIndex} = props;
	const TIME_WINDOW_PADDING = 10;
	const Y_MIN_VELOCITY = 18;

	if (!skillId || !runData || !displaying) return null;
	const selectedRun = runData[displaying];
	if (!selectedRun?.t || !selectedRun?.v || !selectedRun?.p || !selectedRun?.sk) return null;

	const skillData = getSkillPositionsFromRun(skillId, selectedRun, umaIndex);
	if (!skillData || skillData.positions.length === 0) return null;

	const {positions: skillPositions, umaIndex: skillUmaIndex} = skillData;
	const times = selectedRun.t[skillUmaIndex];
	const velocities = selectedRun.v[skillUmaIndex];
	const positions = selectedRun.p[skillUmaIndex];
	if (!times || !velocities || !positions || times.length === 0) return null;

	const [startPos, endPos] = skillPositions[0];
	const startTime = interpolateValue(startPos, positions, times);
	const endTime = interpolateValue(endPos, positions, times);
	const timeWindowStart = Math.max(0, startTime - TIME_WINDOW_PADDING);
	const timeWindowEnd = endTime + TIME_WINDOW_PADDING;

	const velocityData = [];
	const positionData = [];
	for (let i = 0; i < times.length; i++) {
		const t = times[i];
		if (t >= timeWindowStart && t <= timeWindowEnd) {
			velocityData.push([t, velocities[i]]);
			positionData.push([t, positions[i]]);
		}
	}
	if (velocityData.length === 0) return null;

	const minTime = timeWindowStart;
	const maxTime = timeWindowEnd;
	const minVelocity = Math.min(...velocityData.map(d => d[1]));
	const maxVelocityRoundedUp = Math.ceil(Math.max(...velocities)) + 1;
	const yMin = Math.min(Y_MIN_VELOCITY, minVelocity);
	const yMax = Math.max(Y_MIN_VELOCITY, maxVelocityRoundedUp);
	const x = d3.scaleLinear().domain([minTime, maxTime]).range([0, chartWidth]);
	const y = d3.scaleLinear().domain([yMin, yMax]).range([chartHeight, 0]);
	const phaseBackgrounds = calculatePhaseBackgrounds(courseDistance, positionData, minTime, maxTime);
	const baseColor = UMA_VELOCITY_COLORS[skillUmaIndex] || UMA_VELOCITY_COLORS[0];

	return {
		variant: 'procHighlight',
		x,
		y,
		yMin,
		maxVelocityRoundedUp,
		phaseBackgrounds,
		velocityData,
		startTime,
		endTime,
		baseColor
	};
}

function buildSkillImpactVelocityModel(props, chartWidth, chartHeight) {
	const {skillId, runData, courseDistance, displaying} = props;
	const TIME_WINDOW_PADDING = 10;
	const Y_MIN_VELOCITY = 18;
	const VELOCITY_CONVERGENCE_THRESHOLD = 0.02;

	if (!skillId || !runData || !displaying) return null;
	const selectedRun = runData[displaying];
	if (!selectedRun?.t || !selectedRun?.v || !selectedRun?.p || !selectedRun?.sk) return null;
	if (!selectedRun.t[0] || !selectedRun.v[0] || !selectedRun.p[0] ||
		!selectedRun.t[1] || !selectedRun.v[1] || !selectedRun.p[1]) return null;

	const skillData = getSkillPositionsFromRun(skillId, selectedRun);
	if (!skillData || skillData.positions.length === 0) return null;

	const uma1Times = selectedRun.t[0];
	const uma1Velocities = selectedRun.v[0];
	const uma1Positions = selectedRun.p[0];
	const uma2Times = selectedRun.t[1];
	const uma2Velocities = selectedRun.v[1];
	const uma2Positions = selectedRun.p[1];
	if (!uma1Times || !uma1Velocities || !uma1Positions || uma1Times.length === 0 ||
		!uma2Times || !uma2Velocities || !uma2Positions || uma2Times.length === 0) return null;

	const {positions: skillPositions} = skillData;
	const [startPos, endPos] = skillPositions[0];
	const startTime = interpolateValue(startPos, uma2Positions, uma2Times);
	const endTime = interpolateValue(endPos, uma2Positions, uma2Times);
	const timeWindowStart = Math.max(0, startTime - TIME_WINDOW_PADDING);
	const timeWindowEnd = endTime + TIME_WINDOW_PADDING;

	const uma1VelocityData = [];
	const uma2VelocityData = [];
	const positionData = [];
	for (let i = 0; i < uma1Times.length; i++) {
		const t = uma1Times[i];
		if (t >= timeWindowStart && t <= timeWindowEnd) {
			uma1VelocityData.push([t, uma1Velocities[i]]);
			positionData.push([t, uma1Positions[i]]);
		}
	}
	for (let i = 0; i < uma2Times.length; i++) {
		const t = uma2Times[i];
		if (t >= timeWindowStart && t <= timeWindowEnd) {
			uma2VelocityData.push([t, uma2Velocities[i]]);
		}
	}
	if (uma1VelocityData.length === 0 || uma2VelocityData.length === 0) return null;

	const minTime = timeWindowStart;
	const maxTime = timeWindowEnd;
	const allVelocities = [...uma1VelocityData.map(d => d[1]), ...uma2VelocityData.map(d => d[1])];
	const minVelocity = Math.min(...allVelocities);
	const maxVelocityRoundedUp = Math.ceil(Math.max(Math.max(...uma1Velocities), Math.max(...uma2Velocities))) + 1;
	const yMin = Math.min(Y_MIN_VELOCITY, minVelocity);
	const yMax = Math.max(Y_MIN_VELOCITY, maxVelocityRoundedUp);
	const x = d3.scaleLinear().domain([minTime, maxTime]).range([0, chartWidth]);
	const y = d3.scaleLinear().domain([yMin, yMax]).range([chartHeight, 0]);
	const phaseBackgrounds = calculatePhaseBackgrounds(courseDistance, positionData, minTime, maxTime);

	let convergenceTime = maxTime;
	for (let i = 0; i < uma2Times.length; i++) {
		const t = uma2Times[i];
		if (t >= endTime) {
			if (Math.abs(uma1Velocities[i] - uma2Velocities[i]) <= VELOCITY_CONVERGENCE_THRESHOLD) {
				convergenceTime = t;
				break;
			}
		}
	}
	const uma2VelocityDataFiltered = [];
	for (let i = 0; i < uma2VelocityData.length; i++) {
		const [t, v] = uma2VelocityData[i];
		if (t >= startTime && t <= Math.min(convergenceTime, timeWindowEnd)) {
			uma2VelocityDataFiltered.push([t, v]);
		}
	}

	return {
		variant: 'skillImpact',
		x,
		y,
		yMin,
		maxVelocityRoundedUp,
		phaseBackgrounds,
		uma1VelocityData,
		uma2VelocityDataFiltered,
		startTime,
		endTime
	};
}

export function VelocityChart(props) {
	const {skillId, runData, courseDistance, displaying} = props;
	const variant = props.variant || 'skillImpact';
	const width = Math.max(160, props.width || 400);
	const height = Math.max(100, props.height || 200);
	const margin = {top: 8, right: 8, bottom: 24, left: props.yAxisWidth || 56};
	const chartWidth = Math.max(40, width - margin.left - margin.right);
	const chartHeight = Math.max(40, height - margin.top - margin.bottom);
	const canvasRef = useRef(null);
	const axesRef = useRef(null);

	const TICK_EPSILON = 0.01;

	const model = useMemo(() => {
		if (variant === 'procHighlight') {
			return buildProcHighlightVelocityModel({skillId, runData, courseDistance, displaying, umaIndex: props.umaIndex}, chartWidth, chartHeight);
		}
		return buildSkillImpactVelocityModel({skillId, runData, courseDistance, displaying}, chartWidth, chartHeight);
	}, [variant, skillId, runData, courseDistance, displaying, props.umaIndex, chartWidth, chartHeight]);

	useEffect(function () {
		if (!model || !canvasRef.current) return;
		const canvas = canvasRef.current;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const {x, y, yMin, maxVelocityRoundedUp, phaseBackgrounds} = model;
		ctx.clearRect(0, 0, width, height);
		ctx.save();
		ctx.translate(margin.left, margin.top);
		phaseBackgrounds.forEach((phase, i) => {
			ctx.fillStyle = SKILL_CHART_PHASE_COLORS[i] || 'rgba(255, 255, 255, 0.08)';
			ctx.fillRect(x(phase.start), 0, x(phase.end) - x(phase.start), chartHeight);
		});
		const suggestedTicks = y.ticks(5);
		const step = suggestedTicks.length > 1 ? suggestedTicks[1] - suggestedTicks[0] : 1;
		const startTick = Math.floor(yMin / step) * step;
		const yTickValues = [];
		for (let v = startTick; v <= maxVelocityRoundedUp; v += step) {
			if (v >= yMin) yTickValues.push(v);
		}
		if (!yTickValues.some(tick => Math.abs(tick - maxVelocityRoundedUp) < TICK_EPSILON)) {
			yTickValues.push(maxVelocityRoundedUp);
		}
		yTickValues.sort((a, b) => a - b);
		ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
		ctx.lineWidth = 0.5;
		yTickValues.forEach(tickValue => {
			const yPos = y(tickValue);
			ctx.beginPath();
			ctx.moveTo(0, yPos);
			ctx.lineTo(chartWidth, yPos);
			ctx.stroke();
		});
		x.ticks(5).forEach(tickValue => {
			const xPos = x(tickValue);
			ctx.beginPath();
			ctx.moveTo(xPos, 0);
			ctx.lineTo(xPos, chartHeight);
			ctx.stroke();
		});
		if (model.variant === 'procHighlight') {
			drawVelocityTrace(ctx, model.velocityData, x, y, model.startTime, model.endTime, model.baseColor, SKILL_PROC_VELOCITY_COLOR);
		} else {
			ctx.lineWidth = 2;
			ctx.strokeStyle = UMA_VELOCITY_COLORS[0];
			strokeVelocityPath(ctx, model.uma1VelocityData, x, y);
			if (model.uma2VelocityDataFiltered.length > 0) {
				ctx.strokeStyle = UMA_VELOCITY_COLORS[1];
				strokeVelocityPath(ctx, model.uma2VelocityDataFiltered, x, y);
			}
		}
		ctx.restore();
	}, [model, width, height, chartWidth, chartHeight, margin.left, margin.top]);

	useEffect(function () {
		if (!model || !axesRef.current) return;
		const {x, y, yMin, maxVelocityRoundedUp} = model;
		const axesG = d3.select(axesRef.current);
		axesG.selectAll('*').remove();
		const suggestedTicks = y.ticks(5);
		const step = suggestedTicks.length > 1 ? suggestedTicks[1] - suggestedTicks[0] : 1;
		const startTick = Math.floor(yMin / step) * step;
		const yTickValues = [];
		for (let v = startTick; v <= maxVelocityRoundedUp; v += step) {
			if (v >= yMin) yTickValues.push(v);
		}
		if (!yTickValues.some(tick => Math.abs(tick - maxVelocityRoundedUp) < TICK_EPSILON)) {
			yTickValues.push(maxVelocityRoundedUp);
		}
		yTickValues.sort((a, b) => a - b);
		const xAxis = d3.axisBottom(x).ticks(5).tickFormat(d => `${d}s`);
		const yAxis = d3.axisLeft(y).tickValues(yTickValues).tickFormat(d => `${Number(d).toFixed(1)}m/s`);
		axesG.append('g').attr('transform', `translate(${margin.left},${height - margin.bottom})`).call(xAxis);
		axesG.append('g').attr('transform', `translate(${margin.left},${margin.top})`).call(yAxis);
		axesG.selectAll('.domain, .tick line').attr('stroke', 'rgba(232, 240, 255, 0.45)');
		axesG.selectAll('.tick text').attr('fill', 'rgba(232, 240, 255, 0.72)');
	}, [model, width, height, margin.left, margin.top, margin.bottom]);

	if (!model) return null;

	return (
		<div class="velocityChart" style={`width: ${width}px; height: ${height}px; position: relative; overflow: hidden;`}>
			<canvas ref={canvasRef} width={width} height={height} style="position: absolute; top: 0; left: 0;" />
			<svg width={width} height={height} style="position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible;">
				<g ref={axesRef}></g>
			</svg>
		</div>
	);
}

export function ActivationFrequencyChart(props) {
	const {skillId, runData, courseDistance} = props;
	const width = Math.max(120, props.width || 300);
	const height = Math.max(36, props.height || 50);
	const yW = props.yAxisWidth || 52;
	const rightPad = props.rightPad || 16;
	const chartWidth = width - yW - rightPad;
	const chartHeight = height - 20 - 5;

	if (!skillId || !runData) {
		return null;
	}

	const activations = [];
	if (!runData.allruns || !runData.allruns.sk || !Array.isArray(runData.allruns.sk)) {
		return null;
	}

	runData.allruns.sk.forEach((skMap) => {
		if (!skMap) return;
		let positions = null;
		if (skMap instanceof Map || (typeof skMap.has === 'function' && typeof skMap.get === 'function')) {
			if (skMap.has(skillId)) {
				positions = skMap.get(skillId);
			}
		} else if (typeof skMap === 'object' && skillId in skMap) {
			positions = skMap[skillId];
		}
		if (positions && Array.isArray(positions)) {
			positions.forEach((pos) => {
				if (typeof pos === 'number') {
					activations.push(pos);
				}
			});
		}
	});

	if (activations.length === 0) {
		return null;
	}

	const binSize = 10;
	const maxDistance = Math.ceil(courseDistance / binSize) * binSize;
	const bins = [];
	for (let i = 0; i < maxDistance; i += binSize) {
		bins.push({start: i, end: i + binSize, count: 0});
	}

	activations.forEach(pos => {
		const binIndex = Math.floor(pos / binSize);
		if (binIndex >= 0 && binIndex < bins.length) {
			bins[binIndex].count++;
		}
	});

	const maxCount = Math.max(...bins.map(b => b.count));
	const totalActivations = activations.length;

	const phase0End = CourseHelpers.phaseStart(courseDistance, 1);
	const phase1End = CourseHelpers.phaseStart(courseDistance, 2);

	const phaseBackgrounds = [
		{start: 0, end: phase0End, color: SKILL_CHART_PHASE_COLORS[0]},
		{start: phase0End, end: phase1End, color: SKILL_CHART_PHASE_COLORS[1]},
		{start: phase1End, end: courseDistance, color: SKILL_CHART_PHASE_COLORS[2]}
	];

	const chartBins = bins.map(bin => ({...bin, value: bin.count}));
	const xScale = d3.scaleLinear().domain([0, maxDistance]).range([0, chartWidth]);
	const yScale = d3.scaleLinear().domain([0, maxCount > 0 ? maxCount : 1]).range([chartHeight, 0]);

	const yTickValues = [0, maxCount > 0 ? maxCount : 1];

	return (
		<div class="activationFrequencyChart">
			<BarChart
				width={width}
				height={height}
				yAxisWidth={yW}
				rightPad={rightPad}
				bins={chartBins}
				xScale={xScale}
				yScale={yScale}
				phaseBackgrounds={phaseBackgrounds}
				xAxisTicks={Math.min(6, Math.floor(maxDistance / 200))}
				yAxisTicks={2}
				yTickValues={yTickValues}
				yAxisFormat={(d, i, ticks) => {
					if (i === 0 || i === ticks.length - 1) {
						return `${Math.round((d / totalActivations) * 100)}%`;
					}
					return '';
				}}
				barColor="#6ea8fe"
			/>
		</div>
	);
}

function useElementSize() {
	const ref = useRef(null);
	const [size, setSize] = useState({width: 0, height: 0});
	useEffect(function () {
		const el = ref.current;
		if (!el) return;
		const update = () => {
			const rect = el.getBoundingClientRect();
			const scale = visualScale(el);
			setSize({
				width: Math.max(0, Math.floor(rect.width / scale)),
				height: Math.max(0, Math.floor(rect.height / scale))
			});
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return [ref, size];
}

const SKILL_CHART_AXIS = Object.freeze({
	yAxisWidth: 56,
	rightPad: 18
});

export function SkillChartSidePlots(props) {
	const orientation = props.orientation || 'vertical';
	const [histRef, histSize] = useElementSize();
	const [plotRef, plotSize] = useElementSize();
	const freqHeight = Math.min(40, Math.max(28, Math.floor(histSize.height * 0.22)));
	const histHeight = Math.max(0, histSize.height - freqHeight - 6);
	const hasPlotData = Boolean(
		props.runData &&
		(props.runData[props.displaying] || props.runData.allruns?.totalRuns > 0)
	);

	return (
		<div class={`skillChartExpandedPlots${orientation === 'horizontal' ? ' skillChartExpandedPlots--horizontal' : ''}`}>
			<div class="skillChartExpandedPlotSlot skillChartExpandedPlotSlot--stacked" ref={histRef}>
				{!hasPlotData ? (
					<div class="skillChartPlotEmpty">No activation data available yet</div>
				) : histSize.width > 0 && histHeight > 0 && (
					<>
						<LengthDifferenceChart
							skillId={props.skillId}
							runData={props.runData}
							courseDistance={props.courseDistance}
							width={histSize.width}
							height={histHeight}
							yAxisWidth={SKILL_CHART_AXIS.yAxisWidth}
							rightPad={SKILL_CHART_AXIS.rightPad}
						/>
						<ActivationFrequencyChart
							skillId={props.skillId}
							runData={props.runData}
							courseDistance={props.courseDistance}
							width={histSize.width}
							height={freqHeight}
							yAxisWidth={SKILL_CHART_AXIS.yAxisWidth}
							rightPad={SKILL_CHART_AXIS.rightPad}
						/>
					</>
				)}
			</div>
			<div class="skillChartExpandedPlotSlot" ref={plotRef}>
				{!hasPlotData ? (
					<div class="skillChartPlotEmpty">No velocity data available yet</div>
				) : plotSize.width > 0 && plotSize.height > 0 && (
					<VelocityChart
						skillId={props.skillId}
						runData={props.runData}
						courseDistance={props.courseDistance}
						displaying={props.displaying}
						variant={props.velocityVariant || 'skillImpact'}
						umaIndex={props.umaIndex}
						width={plotSize.width}
						height={plotSize.height}
						yAxisWidth={SKILL_CHART_AXIS.yAxisWidth}
					/>
				)}
			</div>
		</div>
	);
}

function BasinnChartPopover(props) {
	const popover = useRef(null);
	useEffect(function () {
		if (popover.current == null) return;
		const anchor = document.querySelector(`.basinnChart tr[data-skillid="${props.skillid}"] img`);
		if (anchor == null) return;
		computePosition(anchor, popover.current, {
			placement: 'bottom-start',
			middleware: [flip()]
		}).then(({x,y}) => {
			const scale = visualScale(popover.current);
			popover.current.style.transform = `translate(${x / scale}px,${y / scale}px)`;
			popover.current.style.visibility = 'visible';
		});
		popover.current.focus();
	}, [popover.current, props.skillid]);
	return (
		<div class="basinnChartPopover" tabindex={1000} style="visibility:hidden" ref={popover}>
			<ExpandedSkillDetails id={props.skillid} distanceFactor={props.courseDistance} raceContext={props.raceContext} dismissable={false} />
		</div>
	);
}

function VelocityLines(props) {
	const axes = useRef(null);
	const data = props.data;
	const x = d3.scaleLinear().domain([0,props.courseDistance]).range([0,props.width]);
	const y = data && d3.scaleLinear().domain([0,d3.max(data.v, v => d3.max(v))]).range([props.height,0]);
	const hpY = data && d3.scaleLinear().domain([0,d3.max(data.hp, hp => d3.max(hp))]).range([props.height,0]);
	
	const pacemakerY = data && data.pacerGap && (() => {
		const allValues = data.pacerGap.flatMap(gap => gap.filter(d => d !== undefined));
		if (allValues.length === 0) return null;
		const maxValue = d3.max(allValues);
		const bottom60Percent = props.height * 0.6;
		const domainMax = Math.max(maxValue, 10);
		return d3.scaleLinear().domain([0, domainMax]).range([props.height, bottom60Percent]);
	})();
	
	const laneY = data && data.currentLane && props.horseLane && (() => {
		const gateCount = 9;
		const maxLane = Math.max(gateCount + 1, 11) * props.horseLane;
		const bottom50Percent = props.height * 0.5;
		return d3.scaleLinear().domain([0, maxLane]).range([props.height, bottom50Percent]);
	})();
	
	useEffect(function () {
		if (axes.current == null) return;
		const g = d3.select(axes.current);
		g.selectAll('*').remove();
		g.append('g').attr('transform', `translate(${props.xOffset},${props.height+5})`).call(d3.axisBottom(x));
		if (data) {
			g.append('g').attr('transform', `translate(${props.xOffset},4)`).call(d3.axisLeft(y));
		}
	}, [props.data, props.courseDistance, props.width, props.height]);
	const colors = ['#2a77c5', '#c52a2a'];
	const hpColors = ['#688aab', '#ab6868'];
	const laneColors = ['#87ceeb', '#ff0000'];
	const pacemakerColors = ['#22c55e', '#a855f7', '#ec4899'];
	return (
		<Fragment>
			<g transform={`translate(${props.xOffset},5)`}>
				{data && data.v.map((v,i) =>
					<path fill="none" stroke={colors[i]} stroke-width="2.5" d={
						d3.line().x(j => x(data.p[i][j])).y(j => y(v[j]))(data.p[i].map((_,j) => j))
					} />
				).concat(props.showHp ? data.hp.map((hp,i) =>
					<path fill="none" stroke={hpColors[i]} stroke-width="2.5" d={
						d3.line().x(j => x(data.p[i][j])).y(j => hpY(hp[j]))(data.p[i].map((_,j) => j))
					} />
				) : []).concat(props.showLanes && data.currentLane && laneY ? data.currentLane.map((lanes,i) =>
					<path fill="none" stroke={laneColors[i]} stroke-width="2.5" d={
						d3.line().x(j => x(data.p[i][j])).y(j => laneY(lanes[j]))(data.p[i].map((_,j) => j))
					} />
				) : []).concat(data.pacerGap && pacemakerY ? data.pacerGap.map((gap,i) => {
					const validPoints = data.p[i].map((_,j) => ({x: j, gap: gap[j]})).filter(p => p.gap !== undefined && p.gap >= 0);
					if (validPoints.length === 0) return null;
					
					return <path key={i} fill="none" stroke={colors[i]} stroke-width="2" stroke-dasharray="5,5" d={
						d3.line().x(j => x(data.p[i][j])).y(j => pacemakerY(gap[j]))(validPoints.map(p => p.x))
					} />;
				}).filter(Boolean) : []).concat(props.showVirtualPacemaker && data.pacerV && data.pacerP ? (() => {
					const pacemakerLines = [];
					for (let pacemakerIndex = 0; pacemakerIndex < 3; pacemakerIndex++) {
						if (props.selectedPacemakers && props.selectedPacemakers[pacemakerIndex] && 
							data.pacerV && data.pacerV[pacemakerIndex] && data.pacerP && data.pacerP[pacemakerIndex]) {
							const pacerV = data.pacerV[pacemakerIndex];
							const pacerP = data.pacerP[pacemakerIndex];
							const validPoints = pacerP.map((_,j) => ({x: j, vel: pacerV[j], pos: pacerP[j]})).filter(p => p.vel !== undefined && p.pos !== undefined);
							if (validPoints.length > 0) {
								pacemakerLines.push(
									<path key={`vp-${pacemakerIndex}`} fill="none" stroke={pacemakerColors[pacemakerIndex]} stroke-width="2.5" d={
										d3.line().x(j => x(pacerP[j])).y(j => y(pacerV[j]))(validPoints.map(p => p.x))
									} />
								);
							}
						}
					}
					return pacemakerLines;
				})() : [])}
			</g>
			<g ref={axes} />
		</Fragment>
	);
}

function formatActivationCount(n) {
	if (!Number.isFinite(n)) return '0';
	const rounded = Math.round(n * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatActivationScore(n) {
	if (!Number.isFinite(n)) return '0';
	return Math.round(n).toLocaleString();
}

function classifyResultSkill(id: string): 'unique' | 'rare' | 'regular' | null {
	const rarity = (skilldata as any)[id]?.rarity;
	if (rarity == null) return null;
	if (rarity >= 3 && rarity <= 5) return 'unique';
	if (rarity === 2 || rarity === 6) return 'rare';
	if (rarity === 1) return 'regular';
	return null;
}

function uniqueResultSkillScore(uniqueLevel: number): number {
	const level = Math.min(6, Math.max(1, uniqueLevel || 1));
	return 2000 + (level >= 2 ? 100 * level : 0);
}

const RARE_RESULT_SKILL_SCORE = 1200;
const REGULAR_RESULT_SKILL_SCORE = 500;

function statForDisplayMode(stats, displaying, score = false) {
	if (!stats) return 0;
	const key = displaying === 'minrun' ? 'min'
		: displaying === 'maxrun' ? 'max'
		: displaying === 'medianrun' ? 'median'
		: 'mean';
	return stats[score ? `${key}Score` : key] || 0;
}

function rateAlertsHigherBetter(value: number, yellowBelow: number, redBelow: number) {
	if (!Number.isFinite(value)) return {valueAlertClass: '', labelAlertClass: '', showZeroBarGlow: false};
	let valueAlertClass = '';
	if (value < 50) valueAlertClass = 'isAlertRed';
	else if (value < redBelow) valueAlertClass = 'isAlertRed';
	else if (value < yellowBelow) valueAlertClass = 'isAlertYellow';
	return {
		valueAlertClass,
		labelAlertClass: value < 50 ? 'isAlertRed' : '',
		showZeroBarGlow: value === 0
	};
}

function rateAlertsLowerBetter(value: number, yellowAbove: number, redAbove: number) {
	if (!Number.isFinite(value)) return {valueAlertClass: '', labelAlertClass: '', showZeroBarGlow: false};
	let valueAlertClass = '';
	if (value > 50) valueAlertClass = 'isAlertRed';
	else if (value > redAbove) valueAlertClass = 'isAlertRed';
	else if (value > yellowAbove) valueAlertClass = 'isAlertYellow';
	return {
		valueAlertClass,
		labelAlertClass: value > 50 ? 'isAlertRed' : '',
		showZeroBarGlow: false
	};
}

function ResultRateBar(props) {
	const value = Number.isFinite(props.value) ? props.value : 0;
	const barSource = Number.isFinite(props.barValue) ? props.barValue : value;
	const width = Math.max(0, Math.min(100, barSource));
	const isPercent = props.unit !== '' && props.displayValue == null && props.displayUnit == null;
	const zero = !props.noBar && value == 0 && !(props.score > 0) && !props.showZeroBarGlow;
	const showValue = props.displayValue == null || props.displayValue !== '';
	const unitLabel = props.displayUnit != null ? props.displayUnit : (isPercent ? '%' : null);
	const barFillStyle = width > 0 ? `width:${width}%;min-width:2px` : 'width:0;min-width:0';
	return (
		<div class={`resultRate ${zero ? ' isZero' : ''}${props.noBar ? ' noBar' : ''}${props.sectionGap ? ' hasSectionGap' : ''}`}>
			<div class="resultRateHeader">
				<span class={props.labelAlertClass || undefined}>{props.label}</span>
				<span class="resultRateValueGroup">
					{showValue && (
						<span class={`resultRateValue${props.valueAlertClass ? ` ${props.valueAlertClass}` : ''}`}>
							{props.displayValue != null
								? props.displayValue
								: (isPercent ? value.toFixed(1) : formatActivationCount(value))}
							{unitLabel && <small>{unitLabel}</small>}
						</span>
					)}
					{props.score != null && Number.isFinite(props.score) && (
						<span class="resultRateScore">{formatActivationScore(props.score)}</span>
					)}
				</span>
			</div>
			<div class={`resultRateTrack${props.noBar ? ' isSpacer' : ''}${props.showZeroBarGlow ? ' hasZeroGlow' : ''}`} aria-hidden="true">
				{!props.noBar && (
					<div class="resultRateFill" style={barFillStyle} />
				)}
			</div>
			{props.detail && <div class="resultRateDetail">{props.detail}</div>}
		</div>
	);
}

function statsAreEmpty(stats) {
	if (!stats) return false;
	return stats.count == 0 || stats.frequency == 0;
}

function DetailStatSummary({stats, unit = 'm'}) {
	if (!stats) return null;
	const empty = statsAreEmpty(stats);
	const columns = [
		['Min', stats.min],
		['Max', stats.max],
		['Mean', stats.mean],
		['Median', stats.median]
	];
	return (
		<div class={`detailStatSummary${empty ? ' isEmpty' : ''}`}>
			{columns.map(([label, value]) => (
				<span>
					<small>{label}</small>
					<strong>
						{empty || value == null ? '—' : (unit == 'm/s' ? value.toFixed(2) : value.toFixed(1))}
						{!empty && value != null && <em> {unit}</em>}
					</strong>
				</span>
			))}
		</div>
	);
}

function DetailResultRow(props) {
	const rate = props.bar && Number.isFinite(+props.value) ? Math.max(0, Math.min(100, +props.value)) : 0;
	const showValue = props.value != null && props.value !== '';
	const dimmed = ((props.bar && rate == 0) || statsAreEmpty(props.stats)) && !props.showZeroBarGlow;
	const barFillStyle = rate > 0 ? `width:${rate}%;min-width:2px` : 'width:0;min-width:0';
	return (
		<div class={`detailResultRow${props.indented ? ' indented' : ''}${props.bar ? ' hasBar' : ''}${props.stats ? ' hasStats' : ''}${dimmed ? ' isZero' : ''}`}>
			<div class="detailResultHeader">
				<span class={`detailResultLabel${props.labelAlertClass ? ` ${props.labelAlertClass}` : ''}`}>{props.label}</span>
				<DetailStatSummary stats={props.stats} unit={props.statsUnit} />
				{showValue && (
					<strong class={`detailResultValue${props.valueAlertClass ? ` ${props.valueAlertClass}` : ''}`}>
						<span>
							{props.bar ? rate.toFixed(1) : props.value}
							{props.unit && <small>{props.unit}</small>}
						</span>
					</strong>
				)}
			</div>
			{props.bar && (
				<div class={`resultRateTrack${props.showZeroBarGlow ? ' hasZeroGlow' : ''}`} aria-hidden="true">
					<div class="resultRateFill" style={barFillStyle} />
				</div>
			)}
		</div>
	);
}

const DISPLAY_MODE_HINT = Object.freeze({
	minrun: 'Min',
	maxrun: 'Max',
	meanrun: 'Mean',
	medianrun: 'Median'
});

function ResultsTable(props) {
	const {chartData, first, idx, runData, stamina, skillStats, displaying, courseDistance} = props;
	const [procDataTarget, setProcDataTarget] = useState(null);
	const canOpenProcData = runData != null && courseDistance != null;

	// Handle null chartData gracefully
	if (!chartData || !chartData.t || !chartData.t[idx] || !chartData.sdly || !chartData.v || !chartData.v[idx]) {
		return <div class="resultEmpty">No chart data available</div>;
	}

	const rushed = runData?.allruns?.rushed?.[idx];
	const spotStruggle = runData?.allruns?.leadCompetition?.[idx];
	const dueling = runData?.allruns?.competeFight?.[idx];
	const fullSpurtDeaths = stamina?.hpDiedPositionStatsFullSpurt;
	const nonFullSpurtDeaths = stamina?.hpDiedPositionStatsNonFullSpurt;
	const deathRate = stamina ? 100 - stamina.staminaSurvivalRate : null;
	const nonFullSpurtRate = stamina ? 100 - stamina.fullSpurtRate : null;
	const skillActivations = chartData.sk?.[idx]
		? Array.from(chartData.sk[idx].entries()).flatMap(([id, activations]) =>
			activations.map((position, activationIndex) => ({id, position, activationIndex})))
		: [];
	const skillRates = runData?.allruns?.skillRates?.[idx];
	const activationCounts = skillActivations.reduce((acc, {id}) => {
		const cls = classifyResultSkill(id);
		if (cls === 'rare') acc.rare++;
		else if (cls === 'regular') acc.regular++;
		else if (cls === 'unique') acc.unique++;
		return acc;
	}, {unique: 0, rare: 0, regular: 0});
	const uniquePts = skillStats?.unique?.score || uniqueResultSkillScore(1);
	const activationTotalPoints =
		activationCounts.unique * uniquePts +
		activationCounts.rare * RARE_RESULT_SKILL_SCORE +
		activationCounts.regular * REGULAR_RESULT_SKILL_SCORE;

	const umaLabel = props.umaLabel || (idx === 1 ? 'Uma 2' : 'Uma 1');
	const isUma2 = idx === 1;
	const modeKey = DISPLAY_MODE_HINT[displaying] ? displaying : 'meanrun';
	const modeHint = DISPLAY_MODE_HINT[modeKey];
	const deathRateAlerts = deathRate != null ? rateAlertsLowerBetter(deathRate, 10, 20) : null;
	const nonFullSpurtAlerts = nonFullSpurtRate != null ? rateAlertsLowerBetter(nonFullSpurtRate, 5, 10) : null;

	return (
		<div class="umaRunDetails">
			<section class="resultSection detailedResultsSection">
				<div class="resultSectionTitle detailedResultsTitle">
					{!isUma2 && <span class="detailedResultsUma">{umaLabel}</span>}
					<span class="detailedResultsHeading">Detailed Results</span>
					{isUma2 && <span class="detailedResultsUma">{umaLabel}</span>}
				</div>
				<div class="detailResultList">
					{first && <DetailResultRow bar label={props.rateLabel || 'In Lead @ Final Leg'} value={first.firstPlaceRate} unit="%" />}
					{rushed && <DetailResultRow bar label="Rushed Rate" value={rushed.frequency} unit="%" stats={rushed} />}
					{spotStruggle && <DetailResultRow bar label="Spot Struggle Rate" value={spotStruggle.frequency} unit="%" stats={spotStruggle} />}
					{dueling && <DetailResultRow bar label="Dueling Rate" value={dueling.frequency} unit="%" stats={dueling} />}
					{deathRateAlerts && (
						<DetailResultRow
							bar
							label="Stamina Death Rate"
							value={deathRate}
							unit="%"
							{...deathRateAlerts}
						/>
					)}
					{fullSpurtDeaths && <DetailResultRow indented label="Deaths with Full Spurts" value={fullSpurtDeaths.count || 0} unit="x" stats={fullSpurtDeaths} />}
					{nonFullSpurtDeaths && <DetailResultRow indented label="Deaths with Non-Full Spurts" value={nonFullSpurtDeaths.count || 0} unit="x" stats={nonFullSpurtDeaths} />}
					{nonFullSpurtAlerts && (
						<DetailResultRow
							bar
							label="Non-Full Spurt Rate"
							value={nonFullSpurtRate}
							unit="%"
							{...nonFullSpurtAlerts}
						/>
					)}
					{stamina?.nonFullSpurtDelayStats && <DetailResultRow indented label="Delay Distance" stats={stamina.nonFullSpurtDelayStats} />}
					{stamina?.nonFullSpurtVelocityStats && <DetailResultRow indented label="Velocity" stats={stamina.nonFullSpurtVelocityStats} statsUnit="m/s" />}
				</div>
			</section>
			{!props.hideSkillActivations && skillActivations.length > 0 && (
				<section class="resultSection resultSkillsSection">
					<div class="resultSectionTitle">
						<span>Skill Activations</span>
						<span class="resultSectionCounts">
							<small class={`detailResultMode ${modeKey}`}>{modeHint}</small>
							{activationCounts.unique > 0 && (
								<span class="resultSectionCount isUnique" title="Unique skills activated">{activationCounts.unique} unique</span>
							)}
							{activationCounts.rare > 0 && (
								<span class="resultSectionCount isRare" title="Rare skills activated">{activationCounts.rare} rare</span>
							)}
							{activationCounts.regular > 0 && (
								<span class="resultSectionCount isRegular" title="Regular skills activated">{activationCounts.regular} regular</span>
							)}
							{(activationCounts.unique > 0 || activationCounts.rare > 0 || activationCounts.regular > 0) && (
								<span class="resultSectionCount isTotal" title="Total points from activated skills">{formatActivationScore(activationTotalPoints)} pts</span>
							)}
						</span>
					</div>
					<div class="resultSkillList">
						{skillActivations.map(({id, position, activationIndex}) => {
							const rate = skillRates instanceof Map ? skillRates.get(id) : skillRates?.[id];
							return (
							<div
								class={`resultSkillRow${canOpenProcData ? ' is-clickable' : ''}${isUma2 ? ' is-uma2' : ''}${procDataTarget?.skillId === id ? ' is-selected' : ''}`}
								key={`${id}-${activationIndex}`}
								role={canOpenProcData ? 'button' : undefined}
								tabIndex={canOpenProcData ? 0 : undefined}
								title={canOpenProcData ? 'View proc data' : undefined}
								onClick={canOpenProcData ? (e) => {
									const row = e.currentTarget as HTMLElement;
									setProcDataTarget(prev =>
										prev?.skillId === id && prev?.anchor === row ? null : { skillId: id, anchor: row }
									);
								} : undefined}
								onKeyDown={canOpenProcData ? (e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										const row = e.currentTarget as HTMLElement;
										setProcDataTarget(prev =>
											prev?.skillId === id && prev?.anchor === row ? null : { skillId: id, anchor: row }
										);
									}
								} : undefined}
							>
								<img src={umaToolsAsset(`icons/${skillmeta[id]?.iconId}.png`)} alt="" loading="lazy" />
								<span class="resultSkillName">{skillnames[id]?.[0] || id}</span>
								<span class="resultSkillMeta">
									<span class="resultSkillDistance">
										{position[1] == -1
											? `${position[0].toFixed(0)} m`
											: `${position[0].toFixed(0)}–${position[1].toFixed(0)} m`}
									</span>
									{typeof rate === 'number' && (
										<span class="resultSkillRate">{rate.toFixed(1)}%</span>
									)}
								</span>
							</div>
							);
						})}
					</div>
				</section>
			)}
			{procDataTarget && canOpenProcData && (
				<SkillProcDataDialog
					skillId={procDataTarget.skillId}
					anchor={procDataTarget.anchor}
					compareRunData={runData}
					courseDistance={courseDistance}
					umaIndex={idx}
					displaying={displaying}
					onClose={() => setProcDataTarget(null)}
				/>
			)}
		</div>
	);
}

const SUMMARY_RUNS = Object.freeze([
	['minrun', 'Minimum', 'Set chart display to the run with minimum bashin difference'],
	['maxrun', 'Maximum', 'Set chart display to the run with maximum bashin difference'],
	['meanrun', 'Mean', 'Set chart display to a run representative of the mean bashin difference'],
	['medianrun', 'Median', 'Set chart display to a run representative of the median bashin difference']
]);

function ResultsSummaryTable(props) {
	const {displaying, onSelect, values} = props;
	const valueFor = {minrun: values.min, maxrun: values.max, meanrun: values.mean, medianrun: values.median};
	return (
		<table id="resultsSummary">
			<tfoot>
				<tr>
					{SUMMARY_RUNS.map(([k,label,help]) =>
						<th scope="col" class={`${k}${displaying == k ? ' selected' : ''}`} title={help} onClick={() => onSelect(k)}>{label}</th>
					)}
				</tr>
			</tfoot>
			<tbody>
				<tr>
					{SUMMARY_RUNS.map(([k]) =>
						<td class={`${k}${displaying == k ? ' selected' : ''}`} onClick={() => onSelect(k)}>{valueFor[k].toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'Lengths':'バ身'}</span></td>
					)}
				</tr>
			</tbody>
		</table>
	);
}

function UmaOutcomePanel(props) {
	const {cls, label, stamina, skillStats, displaying, chartData, idx} = props;
	const modeKey = DISPLAY_MODE_HINT[displaying] ? displaying : 'meanrun';
	const modeHint = DISPLAY_MODE_HINT[modeKey];
	const unique = props.hideSkillHighlights ? null : skillStats?.unique;
	const rare = props.hideSkillHighlights ? null : skillStats?.rare;
	const regular = props.hideSkillHighlights ? null : skillStats?.regular;
	const rareCount = statForDisplayMode(rare, displaying);
	const rareScore = statForDisplayMode(rare, displaying, true);
	const regularCount = statForDisplayMode(regular, displaying);
	const regularScore = statForDisplayMode(regular, displaying, true);
	const rareBar = rare?.equipped > 0 ? Math.min(100, (rareCount / rare.equipped) * 100) : 0;
	const regularBar = regular?.equipped > 0 ? Math.min(100, (regularCount / regular.equipped) * 100) : 0;
	const uniqueScore = unique?.equipped ? (unique.averageScore || 0) : 0;
	const showSkillScores = !!(unique?.equipped || rare?.equipped > 0 || regular?.equipped > 0);
	const totalSkillPoints = uniqueScore + (rare?.equipped > 0 ? rareScore : 0) + (regular?.equipped > 0 ? regularScore : 0);
	const hasRunMetrics = chartData && chartData.t?.[idx] && chartData.sdly && chartData.v?.[idx];
	const showRates = stamina || showSkillScores || hasRunMetrics;
	const finishTime = hasRunMetrics ? formatTime(chartData.t[idx][chartData.t[idx].length - 1] * 1.18) : null;
	const topSpeed = hasRunMetrics ? chartData.v[idx].reduce((a,b) => Math.max(a,b), 0) : null;
	const startDelayMs = hasRunMetrics ? chartData.sdly[idx] * 1000 : null;
	const fullSpurtAlerts = stamina ? rateAlertsHigherBetter(stamina.fullSpurtRate, 95, 90) : null;
	const survivalAlerts = stamina ? rateAlertsHigherBetter(stamina.staminaSurvivalRate, 90, 80) : null;
	return (
		<section class={`outcomeHighlight ${cls}`}>
			<div class="outcomeHighlightHeader">
				{cls === 'uma2' && <small class={`detailResultMode ${modeKey}`}>{modeHint}</small>}
				<h3>{label}</h3>
				{cls !== 'uma2' && <small class={`detailResultMode ${modeKey}`}>{modeHint}</small>}
			</div>
			{showRates && (
				<div class="resultRateList">
					{fullSpurtAlerts && (
						<ResultRateBar
							label="Full Spurt Rate"
							value={stamina.fullSpurtRate}
							{...fullSpurtAlerts}
						/>
					)}
					{survivalAlerts && (
						<ResultRateBar
							label="Stamina Survival Rate"
							value={stamina.staminaSurvivalRate}
							{...survivalAlerts}
						/>
					)}
					{unique?.equipped && (
						<ResultRateBar
							label="Unique Skill Activation Rate"
							value={unique.rate}
							score={unique.averageScore}
						/>
					)}
					{rare?.equipped > 0 && (
						<ResultRateBar
							label="Rare Skill Activations"
							value={rareCount}
							unit=""
							score={rareScore}
							barValue={rareBar}
						/>
					)}
					{regular?.equipped > 0 && (
						<ResultRateBar
							label="Regular Skill Activations"
							value={regularCount}
							unit=""
							score={regularScore}
							barValue={regularBar}
						/>
					)}
					{showSkillScores && (
						<ResultRateBar noBar sectionGap label="Total Points from Skills" displayValue={formatActivationScore(totalSkillPoints)} displayUnit="pts" />
					)}
					{hasRunMetrics && (
						<>
							<ResultRateBar noBar label="Top Speed" displayValue={topSpeed.toFixed(2)} displayUnit="m/s" />
							<ResultRateBar noBar label="Start Delay" displayValue={startDelayMs.toFixed(1)} displayUnit="ms" />
							<ResultRateBar noBar label="Finish Time" displayValue={finishTime} />
						</>
					)}
				</div>
			)}
		</section>
	);
}

type GlobalSkillHighlightComparisonProps = {
	staminaStats: any,
	chartData: any
};

function GlobalSkillHighlightComparison(props: GlobalSkillHighlightComparisonProps) {
	const {staminaStats, chartData} = props;
	const runMetrics = (idx: number) => {
		const hasRunMetrics = chartData && chartData.t?.[idx] && chartData.sdly && chartData.v?.[idx];
		if (!hasRunMetrics) {
			return {topSpeed: null, startDelay: null, finishTime: null};
		}
		return {
			topSpeed: chartData.v[idx].reduce((a: number, b: number) => Math.max(a, b), 0),
			startDelay: chartData.sdly[idx] * 1000,
			finishTime: chartData.t[idx][chartData.t[idx].length - 1] * 1.18
		};
	};
	const baselineRun = runMetrics(0);
	const selectedRun = runMetrics(1);
	const formatMetric = (value: number | null | undefined, digits: number, unit: string) =>
		typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—';
	const rows = [
		{
			label: 'Full Spurt',
			baseline: formatMetric(staminaStats?.uma1?.fullSpurtRate, 1, '%'),
			selected: formatMetric(staminaStats?.uma2?.fullSpurtRate, 1, '%')
		},
		{
			label: 'Stamina Survival',
			baseline: formatMetric(staminaStats?.uma1?.staminaSurvivalRate, 1, '%'),
			selected: formatMetric(staminaStats?.uma2?.staminaSurvivalRate, 1, '%')
		},
		{
			label: 'Top Speed',
			baseline: formatMetric(baselineRun.topSpeed, 2, ' m/s'),
			selected: formatMetric(selectedRun.topSpeed, 2, ' m/s')
		},
		{
			label: 'Start Delay',
			baseline: formatMetric(baselineRun.startDelay, 1, ' ms'),
			selected: formatMetric(selectedRun.startDelay, 1, ' ms')
		},
		{
			label: 'Finish Time',
			baseline: baselineRun.finishTime == null ? '—' : formatTime(baselineRun.finishTime),
			selected: selectedRun.finishTime == null ? '—' : formatTime(selectedRun.finishTime)
		}
	];
	return (
		<section class="globalSkillHighlightComparison">
			<div class="globalSkillHighlightColumns">
				<strong>Baseline</strong>
				<span>Metric</span>
				<strong>With Selected Skill</strong>
			</div>
			<div class="globalSkillHighlightRows">
				{rows.map(row => (
					<div class="globalSkillHighlightRow">
						<strong>{row.baseline}</strong>
						<span>{row.label}</span>
						<strong>{row.selected}</strong>
					</div>
				))}
			</div>
		</section>
	);
}

function UmaResultCard(props) {
	const {cls, label} = props;
	return (
		<div class={`resultsCard umaResultCard ${cls}`}>
			<div class="umaCompareTitle">{label}</div>
			{props.children}
		</div>
	);
}

const NO_SHOW = Object.freeze([
	'10011', '10012', '10016', '10021', '10022', '10026', '10031', '10032', '10036',
	'10041', '10042', '10046', '10051', '10052', '10056', '10061', '10062', '10066',
	'40011',
	'20061', '20062', '20066'
]);

const ORDER_RANGE_FOR_STRATEGY = Object.freeze({
	'Nige': [1,1],
	'Senkou': [2,4],
	'Sasi': [5,9],
	'Oikomi': [5,9],
	'Oonige': [1,1]
});

// Interleaved rather than contiguous: neighboring skill IDs tend to survive the same number of chart rounds,
// so contiguous slices leave some workers with far more refinement work than others.
function splitSkillsAcrossWorkers(skills: string[], workerCount: number): string[][] {
	const chunks: string[][] = Array.from({length: workerCount}, () => []);
	skills.forEach((id, i) => chunks[i % workerCount].push(id));
	return chunks;
}

function racedefToParams({mood, ground, weather, season, time, grade}: RaceParams, includeOrder?: string): RaceParameters {
	return {
		mood, groundCondition: ground, weather, season, time, grade,
		popularity: 1,
		skillId: '',
		orderRange: includeOrder != null ? ORDER_RANGE_FOR_STRATEGY[includeOrder] : null,
		numUmas: 9
	};
}

async function serialize(courseId: number, nsamples: number, seed: number, posKeepMode: PosKeepMode, racedef: RaceParams, uma1: HorseState, uma2: HorseState, pacer: HorseState, showVirtualPacemakerOnGraph: boolean, pacemakerCount: number, selectedPacemakers: boolean[], showLanes: boolean, witVarianceSettings: {
	syncRng: boolean,
	skillWisdomCheck: boolean,
	rushedKakari: boolean
}, competeFight: boolean, leadCompetition: boolean, duelingRates: {
	runaway: number,
	frontRunner: number,
	paceChaser: number,
	lateSurger: number,
	endCloser: number
}, forceIdenticalMood: boolean) {
	const json = JSON.stringify({
		courseId,
		nsamples,
		seed,
		posKeepMode,
		racedef: racedef.toJS(),
		uma1: uma1.set('skills', Array.from(uma1.skills.values()) as any).toJS(),
		uma2: uma2.set('skills', Array.from(uma2.skills.values()) as any).toJS(),
		pacer: pacer.set('skills', Array.from(pacer.skills.values()) as any).toJS(),
		witVarianceSettings,
		showVirtualPacemakerOnGraph,
		pacemakerCount,
		selectedPacemakers,
		showLanes,
		competeFight,
		leadCompetition,
		duelingRates,
		forceIdenticalMood
	});
	const enc = new TextEncoder();
	const stringStream = new ReadableStream({
		start(controller) {
			controller.enqueue(enc.encode(json));
			controller.close();
		}
	});
	const zipped = stringStream.pipeThrough(new CompressionStream('gzip'));
	const reader = zipped.getReader();
	let buf = new Uint8Array();
	let result;
	while ((result = await reader.read())) {
		if (result.done) {
			return encodeURIComponent(btoa(String.fromCharCode(...buf)));
		} else {
			buf = new Uint8Array([...buf, ...result.value]);
		}
	}
}

async function deserialize(hash) {
	const zipped = atob(decodeURIComponent(hash));
	const buf = new Uint8Array(zipped.split('').map(c => c.charCodeAt(0)));
	const stringStream = new ReadableStream({
		start(controller) {
			controller.enqueue(buf);
			controller.close();
		}
	});
	const unzipped = stringStream.pipeThrough(new DecompressionStream('gzip'));
	const reader = unzipped.getReader();
	const decoder = new TextDecoder();
	let json = '';
	let result;
	while ((result = await reader.read())) {
		if (result.done) {
			try {
				const o = JSON.parse(json);
				return {
					courseId: o.courseId,
					nsamples: o.nsamples,
					seed: o.seed || DEFAULT_SEED,  // field added later, could be undefined when loading state from existing links
					posKeepMode: o.posKeepMode != null ? o.posKeepMode : (o.usePosKeep ? PosKeepMode.Approximate : PosKeepMode.None),  // backward compatibility
					racedef: new RaceParams(o.racedef),
					uma1: new HorseState(o.uma1)
						.set('skills', SkillSet(o.uma1.skills))
						.set('forcedSkillPositions', ImmMap(o.uma1.forcedSkillPositions || {})),
					uma2: new HorseState(o.uma2)
						.set('skills', SkillSet(o.uma2.skills))
						.set('forcedSkillPositions', ImmMap(o.uma2.forcedSkillPositions || {})),
					pacer: o.pacer ? new HorseState(o.pacer)
						.set('skills', SkillSet(o.pacer.skills || []))
						.set('forcedSkillPositions', ImmMap(o.pacer.forcedSkillPositions || {})) : new HorseState({strategy: 'Nige'}),
					witVarianceSettings: o.witVarianceSettings || {
						syncRng: false,
						skillWisdomCheck: true,
						rushedKakari: true
					},
					showVirtualPacemakerOnGraph: o.showVirtualPacemakerOnGraph != null ? o.showVirtualPacemakerOnGraph : false,
					pacemakerCount: o.pacemakerCount != null ? o.pacemakerCount : 1,
					selectedPacemakers: o.selectedPacemakers != null ? o.selectedPacemakers : [false, false, false],
					showLanes: o.showLanes != null ? o.showLanes : false,
					competeFight: o.competeFight != null ? o.competeFight : true,
					leadCompetition: o.leadCompetition != null ? o.leadCompetition : true,
					duelingRates: o.duelingRates || {
						runaway: 10,
						frontRunner: 20,
						paceChaser: 30,
						lateSurger: 35,
						endCloser: 35
					},
					forceIdenticalMood: o.forceIdenticalMood != null ? o.forceIdenticalMood : false
				};
			} catch (_) {
				return {
					courseId: DEFAULT_COURSE_ID,
					nsamples: DEFAULT_SAMPLES,
					seed: DEFAULT_SEED,
					posKeepMode: PosKeepMode.Approximate,
					racedef: new RaceParams(),
					uma1: new HorseState(),
					uma2: new HorseState(),
					pacer: new HorseState({strategy: 'Nige'}),
					witVarianceSettings: {
						syncRng: false,
						skillWisdomCheck: true,
						rushedKakari: true
					},
					showVirtualPacemakerOnGraph: false,
					pacemakerCount: 1,
					selectedPacemakers: [false, false, false],
					showLanes: false,
					competeFight: true,
					leadCompetition: true,
					duelingRates: {
						runaway: 10,
						frontRunner: 20,
						paceChaser: 30,
						lateSurger: 35,
						endCloser: 35
					},
					forceIdenticalMood: false
				};
			}
		} else {
			json += decoder.decode(result.value);
		}
	}
}

async function saveToLocalStorage(courseId: number, nsamples: number, seed: number, posKeepMode: PosKeepMode, racedef: RaceParams, uma1: HorseState, uma2: HorseState, pacer: HorseState, showVirtualPacemakerOnGraph: boolean, pacemakerCount: number, selectedPacemakers: boolean[], showLanes: boolean, witVarianceSettings: {
	syncRng: boolean,
	skillWisdomCheck: boolean,
	rushedKakari: boolean
}, competeFight: boolean, leadCompetition: boolean, duelingRates: {
	runaway: number,
	frontRunner: number,
	paceChaser: number,
	lateSurger: number,
	endCloser: number
}, forceIdenticalMood: boolean) {
	try {
		const hash = await serialize(courseId, nsamples, seed, posKeepMode, racedef, uma1, uma2, pacer, showVirtualPacemakerOnGraph, pacemakerCount, selectedPacemakers, showLanes, witVarianceSettings, competeFight, leadCompetition, duelingRates, forceIdenticalMood);
		localStorage.setItem('umalator-settings', hash);
	} catch (error) {
		console.warn('Failed to save settings to localStorage:', error);
	}
}

function mergeSkillMaps(map1, map2) {
	const toObj = (m) => {
		if (m instanceof Map) {
			const o = {};
			m.forEach((v,k) => { o[k] = v; });
			return o;
		}
		return m || {};
	};
	const obj1 = toObj(map1);
	const obj2 = toObj(map2);
	const merged = { ...obj1 };
	Object.entries(obj2).forEach(([skillId, values]: [string, any]) => {
		merged[skillId] = [...(merged[skillId] || []), ...(values || [])];
	});
	return merged;
}

function mergeResults(results1, results2) {
	console.assert(results1.id == results2.id, `mergeResults: ${results1.id} != ${results2.id}`);
	const n1 = results1.results.length, n2 = results2.results.length;
	const combinedResults = results1.results.concat(results2.results).sort((a,b) => a - b);
	const combinedMean = (results1.mean * n1 + results2.mean * n2) / (n1 + n2);
	const mid = Math.floor(combinedResults.length / 2);
	const newMedian = combinedResults.length % 2 == 0 ? (combinedResults[mid-1] + combinedResults[mid]) / 2 : combinedResults[mid];
	
	const allruns1 = results1.runData?.allruns || {};
	const allruns2 = results2.runData?.allruns || {};
	const {skBasinn: skBasinn1, sk: sk1, totalRuns: totalRuns1, ...rest1} = allruns1;
	const {skBasinn: skBasinn2, sk: sk2, totalRuns: totalRuns2, ...rest2} = allruns2;
	
	const mergedAllRuns: any = {
		...rest1,
		...rest2,
		totalRuns: (totalRuns1 || 0) + (totalRuns2 || 0)
	};
	
	if (skBasinn1 && skBasinn2) {
		mergedAllRuns.skBasinn = [
			mergeSkillMaps(skBasinn1[0] || {}, skBasinn2[0] || {}),
			mergeSkillMaps(skBasinn1[1] || {}, skBasinn2[1] || {})
		];
	} else if (skBasinn1 || skBasinn2) {
		mergedAllRuns.skBasinn = skBasinn1 || skBasinn2;
	}
	
	if (sk1 && sk2) {
		mergedAllRuns.sk = [
			mergeSkillMaps(sk1[0] || {}, sk2[0] || {}),
			mergeSkillMaps(sk1[1] || {}, sk2[1] || {})
		];
	} else if (sk1 || sk2) {
		mergedAllRuns.sk = sk1 || sk2;
	}
	
	return {
		id: results1.id,
		results: combinedResults,
		min: Math.min(results1.min, results2.min),
		max: Math.max(results1.max, results2.max),
		mean: combinedMean,
		median: newMedian,
		runData: {
			...(n2 > n1 ? results2.runData : results1.runData),
			allruns: mergedAllRuns,
			minrun: results1.min < results2.min ? results1.runData.minrun : results2.runData.minrun,
			maxrun: results1.max > results2.max ? results1.runData.maxrun : results2.runData.maxrun,
		}
	};
}

async function loadFromLocalStorage() {
	try {
		const hash = localStorage.getItem('umalator-settings');
		if (hash) {
			return await deserialize(hash);
		}
	} catch (error) {
		console.warn('Failed to load settings from localStorage:', error);
	}
	return null;
}

// Uma Profile Management Functions
interface SavedUmaProfile {
	id: string;
	name: string;
	timestamp: number;
	data: any; // Serialized HorseState
}

function isSavedUmaProfile(value: any): value is SavedUmaProfile {
	return value != null
		&& typeof value.id === 'string'
		&& typeof value.name === 'string'
		&& typeof value.timestamp === 'number'
		&& Number.isFinite(value.timestamp);
}

function normalizeSavedProfiles(value: any): SavedUmaProfile[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter(isSavedUmaProfile);
}

function mergeProfilesByNewestTimestamp(primaryProfiles: SavedUmaProfile[], secondaryProfiles: SavedUmaProfile[]): SavedUmaProfile[] {
	const merged = new Map<string, SavedUmaProfile>();
	const maybeSet = (profile: SavedUmaProfile) => {
		const current = merged.get(profile.id);
		if (!current || profile.timestamp >= current.timestamp) {
			merged.set(profile.id, profile);
		}
	};
	for (const profile of secondaryProfiles) {
		maybeSet(profile);
	}
	for (const profile of primaryProfiles) {
		maybeSet(profile);
	}
	return Array.from(merged.values());
}

async function readProfilesFromHandle(fileHandle: FileSystemFileHandle): Promise<SavedUmaProfile[]> {
	try {
		const file = await fileHandle.getFile();
		const text = await file.text();
		if (text.trim() === '') {
			return [];
		}
		return normalizeSavedProfiles(JSON.parse(text));
	} catch (error) {
		console.warn('Failed to read profiles from selected database file:', error);
		return [];
	}
}

function serializeHorseState(state: HorseState): any {
	return state.set('skills', Array.from(state.skills.values()) as any).toJS();
}

function deserializeHorseState(data: any): HorseState {
	return new HorseState(data)
		.set('skills', SkillSet(data.skills || []))
		.set('forcedSkillPositions', ImmMap(data.forcedSkillPositions || {}));
}

// File handle for the profiles file (stored in memory, lost on page refresh)
let profilesFileHandle: FileSystemFileHandle | null = null;

// Try to get or create the profiles file
async function getProfilesFileHandle(): Promise<FileSystemFileHandle | null> {
	// Check if File System Access API is available
	if (!('showSaveFilePicker' in window)) {
		return null; // API not available (older browsers)
	}

	// If we already have a handle, return it
	if (profilesFileHandle) {
		return profilesFileHandle;
	}

	// Try to get existing file handle from sessionStorage (we can't serialize handles, so we'll prompt again)
	// On first use, prompt user to select/create the file
	try {
		const handle = await (window as any).showSaveFilePicker({
			suggestedName: 'Uma_Database.json',
			types: [{
				description: 'JSON files',
				accept: { 'application/json': ['.json'] }
			}]
		});
		profilesFileHandle = handle;
		return handle;
	} catch (error: any) {
		if (error.name === 'AbortError') {
			// User cancelled - return null, will fall back to localStorage
			return null;
		}
		throw error;
	}
}

// Save profiles to file (and localStorage as backup)
async function saveProfilesToStorage(
	profiles: SavedUmaProfile[],
	options: { mergeWithOnDisk?: boolean } = {}
): Promise<void> {
	const { mergeWithOnDisk = true } = options;
	let profilesToPersist = profiles;
	
	// Try to save to file first
	try {
		const handle = await getProfilesFileHandle();
		if (handle) {
			// Merge with on-disk profiles so selecting an existing DB never wipes newer entries.
			if (mergeWithOnDisk) {
				const fileProfiles = await readProfilesFromHandle(handle);
				if (fileProfiles.length > 0) {
					profilesToPersist = mergeProfilesByNewestTimestamp(profiles, fileProfiles);
				}
			}

			const json = JSON.stringify(profilesToPersist, null, 2);
			const writable = await handle.createWritable();
			await writable.write(json);
			await writable.close();
			// Also save to localStorage as backup
			try {
				localStorage.setItem('umalator-saved-profiles', json);
			} catch (e) {
				// localStorage might be full, but file save succeeded
			}
			return;
		}
	} catch (error) {
		console.warn('Failed to save profiles to file:', error);
	}

	// Fallback to localStorage if file save fails or File System API not available
	try {
		const json = JSON.stringify(profilesToPersist, null, 2);
		localStorage.setItem('umalator-saved-profiles', json);
	} catch (error) {
		console.warn('Failed to save profiles to localStorage:', error);
		throw error;
	}
}

// Load profiles from file (or localStorage as fallback)
async function getAllSavedProfiles(options: { allowFilePrompt?: boolean } = {}): Promise<SavedUmaProfile[]> {
	const { allowFilePrompt = true } = options;
	// Try to load from file first if we have a handle
	if (profilesFileHandle) {
		try {
			const file = await profilesFileHandle.getFile();
			const text = await file.text();
			const profiles = normalizeSavedProfiles(JSON.parse(text));
			// Update localStorage cache
			try {
				localStorage.setItem('umalator-saved-profiles', JSON.stringify(profiles));
			} catch (e) {
				// localStorage might be full, ignore
			}
			return profiles;
		} catch (error) {
			console.warn('Failed to load profiles from file:', error);
			// Fall through to localStorage
		}
	}

	// Check localStorage first (as cache)
	let hasLocalStorageData = false;
	try {
		const stored = localStorage.getItem('umalator-saved-profiles');
		if (stored && stored !== '[]') {
			hasLocalStorageData = true;
		}
	} catch (e) {
		// Ignore
	}

	// Try to load from file if File System API is available
	// Only prompt if localStorage is empty (first time) or if user explicitly wants to reload
	if (allowFilePrompt && 'showOpenFilePicker' in window && !hasLocalStorageData) {
		try {
			const [fileHandle] = await (window as any).showOpenFilePicker({
				types: [{
					description: 'JSON files',
					accept: { 'application/json': ['.json'] }
				}],
				multiple: false
			});
			profilesFileHandle = fileHandle;
			const file = await fileHandle.getFile();
			const text = await file.text();
			const profiles = normalizeSavedProfiles(JSON.parse(text));
			// Update localStorage cache
			try {
				localStorage.setItem('umalator-saved-profiles', JSON.stringify(profiles));
			} catch (e) {
				// localStorage might be full, ignore
			}
			return profiles;
		} catch (error: any) {
			if (error.name === 'AbortError') {
				// User cancelled file selection, fall through to localStorage
			} else {
				console.warn('Failed to load profiles from file:', error);
			}
		}
	}

	// Fallback to localStorage
	try {
		const stored = localStorage.getItem('umalator-saved-profiles');
		if (stored) {
			return normalizeSavedProfiles(JSON.parse(stored));
		}
	} catch (error) {
		console.warn('Failed to load saved profiles from localStorage:', error);
	}
	return [];
}

// Synchronous version for immediate access (uses localStorage cache)
function getAllSavedProfilesSync(): SavedUmaProfile[] {
	try {
		const stored = localStorage.getItem('umalator-saved-profiles');
		if (stored) {
			return JSON.parse(stored);
		}
	} catch (error) {
		console.warn('Failed to load saved profiles from localStorage:', error);
	}
	return [];
}

function getNextProfileName(): string {
	const profiles = getAllSavedProfilesSync();
	if (profiles.length === 0) {
		return '1';
	}
	// Find the highest numerical name
	let maxNum = 0;
	for (const profile of profiles) {
		const num = parseInt(profile.name, 10);
		if (!isNaN(num) && num > maxNum) {
			maxNum = num;
		}
	}
	return (maxNum + 1).toString();
}

export async function saveUmaProfile(horseState: HorseState, profileName?: string): Promise<string> {
	// Prompt for a save target first (while still in the user gesture) on first save this session.
	if (!profilesFileHandle && 'showSaveFilePicker' in window) {
		try {
			await getProfilesFileHandle();
		} catch (error) {
			console.warn('Failed to select profiles database before save:', error);
		}
	}

	// Saving should not trigger an "open database" prompt.
	const profiles = await getAllSavedProfiles({ allowFilePrompt: false });
	const name = profileName || getNextProfileName();
	const id = Date.now().toString();
	const profile: SavedUmaProfile = {
		id,
		name,
		timestamp: Date.now(),
		data: serializeHorseState(horseState)
	};
	profiles.push(profile);
	await saveProfilesToStorage(profiles);
	return id;
}

export async function loadUmaProfile(profileId: string): Promise<HorseState | null> {
	const profiles = await getAllSavedProfiles();
	const profile = profiles.find(p => p.id === profileId);
	if (!profile) {
		return null;
	}
	try {
		return deserializeHorseState(profile.data);
	} catch (error) {
		console.warn('Failed to deserialize profile:', error);
		return null;
	}
}

export async function deleteUmaProfile(profileId: string): Promise<boolean> {
	const profiles = await getAllSavedProfiles();
	const index = profiles.findIndex(p => p.id === profileId);
	if (index === -1) {
		return false;
	}
	profiles.splice(index, 1);
	// Deletion must persist exact new state; do not merge deleted entries back from disk.
	await saveProfilesToStorage(profiles, { mergeWithOnDisk: false });
	return true;
}

export async function renameUmaProfile(profileId: string, newName: string): Promise<boolean> {
	const profiles = await getAllSavedProfiles();
	const profile = profiles.find(p => p.id === profileId);
	if (!profile) {
		return false;
	}
	profile.name = newName;
	await saveProfilesToStorage(profiles);
	return true;
}

export async function selectAnotherProfilesDatabase(): Promise<SavedUmaProfile[] | null> {
	if (!('showOpenFilePicker' in window)) {
		throw new Error('File picker is not available in this browser.');
	}

	try {
		const [fileHandle] = await (window as any).showOpenFilePicker({
			types: [{
				description: 'JSON files',
				accept: { 'application/json': ['.json'] }
			}],
			multiple: false
		});
		profilesFileHandle = fileHandle;
		const file = await fileHandle.getFile();
		const text = await file.text();
		const profiles = normalizeSavedProfiles(JSON.parse(text));
		try {
			localStorage.setItem('umalator-saved-profiles', JSON.stringify(profiles));
		} catch (e) {
			// localStorage might be full, ignore
		}
		return profiles;
	} catch (error: any) {
		if (error.name === 'AbortError') {
			return null;
		}
		throw error;
	}
}

export async function createNewProfilesDatabase(): Promise<SavedUmaProfile[] | null> {
	if (!('showSaveFilePicker' in window)) {
		throw new Error('File picker is not available in this browser.');
	}

	try {
		const fileHandle = await (window as any).showSaveFilePicker({
			suggestedName: 'Uma_Database.json',
			types: [{
				description: 'JSON files',
				accept: { 'application/json': ['.json'] }
			}]
		});
		profilesFileHandle = fileHandle;
		const profiles: SavedUmaProfile[] = [];
		const json = JSON.stringify(profiles, null, 2);
		const writable = await fileHandle.createWritable();
		await writable.write(json);
		await writable.close();
		try {
			localStorage.setItem('umalator-saved-profiles', json);
		} catch (e) {
			// localStorage might be full, ignore
		}
		return profiles;
	} catch (error: any) {
		if (error.name === 'AbortError') {
			return null;
		}
		throw error;
	}
}

export { getAllSavedProfiles };

const EMPTY_RESULTS_STATE = {courseId: DEFAULT_COURSE_ID, results: [], runData: null, chartData: null, displaying: '', spurtInfo: null, staminaStats: null, firstUmaStats: null, skillActivationStats: null, raceParams: null};
function updateResultsState(state: typeof EMPTY_RESULTS_STATE, o: number | string | {results: any, runData: any, displaying?: string, spurtInfo?: any, staminaStats?: any, firstUmaStats?: any, skillActivationStats?: any, raceParams?: any}) {
	if (typeof o == 'number') {
		return {
			courseId: o,
			results: [],
			runData: null,
			chartData: null,
			displaying: '',
			spurtInfo: null,
			staminaStats: null,
			firstUmaStats: null,
			skillActivationStats: null,
			raceParams: null
		};
		} else if (typeof o == 'string') {
		postEvent('setChartData', {display: o});
		return {
			courseId: state.courseId,
			results: state.results,
			runData: state.runData,
			chartData: state.runData != null ? state.runData[o] : null,
			displaying: o,
			spurtInfo: state.spurtInfo,
			staminaStats: state.staminaStats,
			firstUmaStats: state.firstUmaStats,
			skillActivationStats: state.skillActivationStats,
			raceParams: state.raceParams
		};
		} else {
			// Ensure we have a valid chartData - try meanrun, then medianrun, then minrun, then maxrun
			const displayKey = o.displaying || state.displaying || 'meanrun';
			let chartData = o.runData?.[displayKey];
			if (!chartData && o.runData) {
				chartData = o.runData.medianrun || o.runData.minrun || o.runData.maxrun || null;
			}
			return {
				courseId: state.courseId,
				results: o.results,
				runData: o.runData,
				chartData: chartData,
				displaying: displayKey,
				spurtInfo: o.spurtInfo || null,
				staminaStats: o.staminaStats || null,
				firstUmaStats: o.firstUmaStats || null,
				skillActivationStats: o.skillActivationStats || null,
				raceParams: o.raceParams || null
			};
		}
}

function RacePresets(props) {
	const id = useId();
	const selectedIdx = presets.findIndex(p => p.courseId == props.courseId && p.racedef.equals(props.racedef));
	const presetLabel = p => {
		const hasName = typeof p.name == 'string' && p.name.trim().length > 0;
		const hasId = typeof p.id == 'number';
		if (p.rawType == 'CM' || p.rawType == 'LOH') {
			if (hasId && hasName) return `${p.rawType} ${p.id} - ${p.name}`;
			if (hasName) return `${p.rawType} - ${p.name}`;
			if (hasId) return `${p.rawType} ${p.id}`;
		}
		const course = courses[p.courseId];
		if (course == null) {
			return (p.name ?? 'Preset') + ' - Unknown course';
		}
		const raceTrack = TRACKNAMES_en[course.raceTrackId] ?? String(course.raceTrackId);
		const trackType = course.surface == Surface.Turf ? 'Turf' : 'Dirt';
		const direction = course.turn == 1 ? 'Right' : course.turn == 2 ? 'Left' : 'Straight';
		const distance = typeof course.distance == 'number' ? `${course.distance}m` : '';
		const laneType = course.course == 2 ? ' / Outer' : course.course == 3 ? ' / Inner' : '';
		return `${p.name ?? 'Preset'} - ${raceTrack} ${trackType} ${distance} ${direction}${laneType}`;
	};
	return (
		<Fragment>
			<label for={id}>Preset:</label>
			<select id={id} onChange={e => { const i = +e.currentTarget.value; i > -1 && props.set(presets[i].courseId, presets[i].racedef); }}>
				<option value="-1"></option>
				{presets.map((p,i) => <option value={i} selected={i == selectedIdx}>{presetLabel(p)}</option>)}
			</select>
		</Fragment>
	);
}

const baseSkillsToTest = Object.keys(skilldata).filter(id => isGeneralSkill(id));
const CHART_RUN_NAMES = ['', 'Preliminary Run', 'Coarse Run', 'Refinement Run'];

function GlobalSkillSelectionGrid(props: {
	skillIds: string[];
	previewMode: boolean;
	onRemove: (skillId: string) => void;
	onAdd: () => void;
}) {
	const measureRef = useRef<HTMLDivElement>(null);
	const [firstRowCount, setFirstRowCount] = useState(0);

	useLayoutEffect(() => {
		if (!props.previewMode || props.skillIds.length === 0) {
			return;
		}
		const measure = () => {
			const grid = measureRef.current;
			if (!grid) return;
			const items = grid.querySelectorAll('.globalSkillSelectionItem');
			if (items.length === 0) return;
			const firstTop = (items[0] as HTMLElement).offsetTop;
			let count = 0;
			items.forEach(item => {
				if ((item as HTMLElement).offsetTop === firstTop) count++;
			});
			setFirstRowCount(count);
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (measureRef.current) observer.observe(measureRef.current);
		return () => observer.disconnect();
	}, [props.skillIds, props.previewMode]);

	if (props.skillIds.length === 0 && props.previewMode) {
		return null;
	}

	const needsOverflow = props.previewMode && props.skillIds.length > firstRowCount;
	const displayCount = props.previewMode
		? (needsOverflow ? Math.max(0, firstRowCount - 1) : firstRowCount)
		: props.skillIds.length;
	const displayIds = props.skillIds.slice(0, displayCount);
	const hiddenCount = props.skillIds.length - displayIds.length;

	return (
		<>
			{props.previewMode && props.skillIds.length > 0 && (
				<div class="globalSkillSelectionMeasure" aria-hidden="true" ref={measureRef}>
					<div class="globalSkillSelectionGrid">
						{props.skillIds.map(skillId => (
							<div key={skillId} class="globalSkillSelectionItem">
								<Skill id={skillId} />
							</div>
						))}
					</div>
				</div>
			)}
			{props.previewMode ? (
				<div class="globalSkillSelectionGrid globalSkillSelectionGrid--preview">
					{displayIds.map(skillId => (
						<div key={skillId} class="globalSkillSelectionItem">
							<Skill id={skillId} />
						</div>
					))}
					{needsOverflow && (
						<div class="globalSkillSelectionItem globalSkillSelectionOverflow">
							+{hiddenCount} more skill{hiddenCount === 1 ? '' : 's'}
						</div>
					)}
				</div>
			) : (
				<div class="globalSkillSelectionGrid">
					{displayIds.map(skillId => (
						<div
							key={skillId}
							class="globalSkillSelectionItem"
							onClick={(e) => {
								if ((e.target as HTMLElement).classList.contains('skillDismiss')) {
									e.stopPropagation();
									props.onRemove(skillId);
								}
							}}
						>
							<Skill id={skillId} dismissable={true} />
						</div>
					))}
					<div
						class="skill addSkillButton globalSkillSelectionItem"
						onClick={props.onAdd}
						title="Add specific skill"
					>
						<span>+</span>Add Skill
					</div>
				</div>
			)}
		</>
	);
}

const enum Mode { Compare, Chart, UniquesChart, GlobalCompare, GlobalSkillChart, RaceOptimizer }
const enum UiStateMsg { SetModeCompare, SetModeChart, SetModeUniquesChart, SetModeGlobalCompare, SetModeGlobalSkillChart, SetModeRaceOptimizer, SetCurrentIdx0, SetCurrentIdx1, SetCurrentIdx2, ToggleExpand }

const DEFAULT_UI_STATE = {mode: Mode.Compare, currentIdx: 0, expanded: false};

const MODE_ROUTES: ReadonlyArray<{mode: Mode, path: string, label: string, msg: UiStateMsg}> = [
	{mode: Mode.Compare, path: 'compare', label: 'Race Compare', msg: UiStateMsg.SetModeCompare},
	{mode: Mode.GlobalCompare, path: 'global-compare', label: 'Global Compare', msg: UiStateMsg.SetModeGlobalCompare},
	{mode: Mode.Chart, path: 'skill-chart', label: 'Skill Chart', msg: UiStateMsg.SetModeChart},
	{mode: Mode.GlobalSkillChart, path: 'global-skill-chart', label: 'Global Skill Chart', msg: UiStateMsg.SetModeGlobalSkillChart},
	{mode: Mode.UniquesChart, path: 'uma-chart', label: 'Uma Chart', msg: UiStateMsg.SetModeUniquesChart},
	{mode: Mode.RaceOptimizer, path: 'optimizer', label: 'Race Optimizer', msg: UiStateMsg.SetModeRaceOptimizer}
];
const SETTINGS_ROUTE_PATH = 'settings';
const LAST_MODE_ROUTE_STORAGE_KEY = 'umalator-last-mode-route';
const BASE_DOCUMENT_TITLE = document.title;
// Keep in sync with umalator-global/routes.json, which tells the servers and the Pages build which URLs are app pages.
const ROUTE_URL_PATTERN = new RegExp(`^(.*/)(${[...MODE_ROUTES.map(r => r.path), SETTINGS_ROUTE_PATH].join('|')})/?$`);

function detectAppRootPath() {
	const match = window.location.pathname.match(ROUTE_URL_PATTERN);
	if (match) return match[1];
	const pathname = window.location.pathname.replace(/index\.html$/, '');
	return pathname.endsWith('/') ? pathname : pathname + '/';
}

const APP_ROOT_PATH = detectAppRootPath();

type AppRoute = {settings: true} | {settings: false, mode: Mode};

function routeUrl(path: string) {
	return APP_ROOT_PATH + path;
}

function modeRouteUrl(mode: Mode) {
	return routeUrl(MODE_ROUTES.find(r => r.mode == mode)!.path);
}

function parseRouteUrl(pathname: string): AppRoute | null {
	const match = pathname.match(ROUTE_URL_PATTERN);
	if (!match || match[1] != APP_ROOT_PATH) return null;
	if (match[2] == SETTINGS_ROUTE_PATH) return {settings: true};
	const route = MODE_ROUTES.find(r => r.path == match[2]);
	return route ? {settings: false, mode: route.mode} : null;
}

function loadLastModeRouteUrl() {
	try {
		const path = localStorage.getItem(LAST_MODE_ROUTE_STORAGE_KEY);
		const route = MODE_ROUTES.find(r => r.path == path);
		if (route) return routeUrl(route.path);
	} catch (_) {}
	return modeRouteUrl(Mode.Compare);
}

function isPlainLeftClick(e: MouseEvent) {
	return !e.defaultPrevented && e.button == 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

const PREFERENCES_STORAGE_KEY = 'umalator-preferences';

function loadPreferences(): {[key: string]: any} {
	try {
		const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || '{}');
		return stored != null && typeof stored == 'object' ? stored : {};
	} catch (_) {
		return {};
	}
}

function savePreferences(preferences: {[key: string]: any}) {
	try {
		localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
	} catch (error) {
		console.warn('Failed to save preferences to localStorage:', error);
	}
}

// Saved values only win when they have the same shape as the default, so stale or hand-edited storage can't break the UI.
function preferenceOr<T>(preferences: {[key: string]: any}, key: string, fallback: T): T {
	const value = preferences[key];
	if (value == null || typeof value != typeof fallback || Array.isArray(value) != Array.isArray(fallback)) return fallback;
	if (typeof fallback == 'number' && !Number.isFinite(value)) return fallback;
	if (typeof fallback == 'object' && !Array.isArray(fallback)) return {...fallback, ...value};
	return value;
}

function nextUiState(state: typeof DEFAULT_UI_STATE, msg: UiStateMsg) {
	switch (msg) {
		case UiStateMsg.SetModeCompare:
			return {...state, mode: Mode.Compare};
		case UiStateMsg.SetModeChart:
			return {...state, mode: Mode.Chart, currentIdx: 0, expanded: false};
		case UiStateMsg.SetModeUniquesChart:
			return {...state, mode: Mode.UniquesChart, currentIdx: 0, expanded: false};
		case UiStateMsg.SetModeGlobalCompare:
			return {...state, mode: Mode.GlobalCompare, currentIdx: 0, expanded: false};
		case UiStateMsg.SetModeGlobalSkillChart:
			return {...state, mode: Mode.GlobalSkillChart, currentIdx: 0, expanded: false};
		case UiStateMsg.SetModeRaceOptimizer:
			return {...state, mode: Mode.RaceOptimizer, currentIdx: 0, expanded: false};
		case UiStateMsg.SetCurrentIdx0:
			return {...state, currentIdx: 0};
		case UiStateMsg.SetCurrentIdx1:
			return {...state, currentIdx: 1};
		case UiStateMsg.SetCurrentIdx2:
			return {...state, currentIdx: 2};
		case UiStateMsg.ToggleExpand:
			return {...state, expanded: !state.expanded};
	}
}

type StatsTableProps = {
	caption: string,
	captionColor?: string,
	rows: any[],
	enableSorting?: boolean,
	fixedWidth?: string
};

function StatsTable({ caption, captionColor, rows, enableSorting = false, fixedWidth }: StatsTableProps) {
	const [sortColumn, setSortColumn] = useState<string | null>(null);
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	
	const formatValue = (value, rowLabel) => {
		if (value == null) return 'N/A';
		if (typeof value === 'string') {
			return value;
		}
		// For race parameter statistics (separate tables), Min/Max/Mean/Median are basinn differences
		if (caption && (caption.includes('Racetrack') || caption.includes('Terrain') || caption.includes('Weather') || caption.includes('Season'))) {
			return value.toFixed(2);
		}
		// For other stats tables
		if (rowLabel === 'Velocity') {
			return value.toFixed(3) + ' m/s';
		}
		if (rowLabel && (rowLabel.includes('Length') || rowLabel.includes('m'))) {
			return value.toFixed(0) + ' m';
		}
		return value.toFixed(2) + ' m';
	};

	const handleSort = (column: string) => {
		if (!enableSorting) return;
		if (sortColumn === column) {
			setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
		} else {
			setSortColumn(column);
			setSortDirection('asc');
		}
	};

	let sortedRows = rows;
	if (enableSorting && sortColumn) {
		sortedRows = [...rows].sort((a, b) => {
			let aVal, bVal;
			if (sortColumn === 'label') {
				aVal = a.label;
				bVal = b.label;
				const result = String(aVal).localeCompare(String(bVal));
				return sortDirection === 'asc' ? result : -result;
			} else {
				aVal = a.stats[sortColumn];
				bVal = b.stats[sortColumn];
				if (aVal == null && bVal == null) return 0;
				if (aVal == null) return 1;
				if (bVal == null) return -1;
				const result = aVal - bVal;
				return sortDirection === 'asc' ? result : -result;
			}
		});
	}

	const getSortIndicator = (column: string) => {
		if (!enableSorting || sortColumn !== column) return '';
		return sortDirection === 'asc' ? ' ▲' : ' ▼';
	};

	const getFirstColumnHeader = () => {
		if (enableSorting) {
			if (caption.includes('Location')) return 'Location';
			if (caption.includes('Length')) return 'Length';
			if (caption.includes('Terrain')) return 'Terrain';
			if (caption.includes('Weather')) return 'Weather';
			if (caption.includes('Season')) return 'Season';
			return 'Location/Condition';
		}
		return '';
	};

	const wrapStyle = fixedWidth ? {overflowWrap: 'anywhere', wordBreak: 'break-word'} : {};

	const tableStyle = fixedWidth
		? {width: fixedWidth, minWidth: fixedWidth, maxWidth: fixedWidth}
		: undefined;

	return (
		<table class={`statsTable${enableSorting ? ' statsTableSortable' : ''}`} style={tableStyle}>
			<caption style={captionColor ? {color: captionColor} : undefined}>{caption}</caption>
			<thead>
				<tr>
					<th class="statsTableLabel" style={wrapStyle} onClick={() => handleSort('label')}>
						{getFirstColumnHeader()}{getSortIndicator('label')}
					</th>
					<th style={wrapStyle} onClick={() => handleSort('count')}>
						Count{getSortIndicator('count')}
					</th>
					<th style={wrapStyle} onClick={() => handleSort('min')}>
						Min{getSortIndicator('min')}
					</th>
					<th style={wrapStyle} onClick={() => handleSort('max')}>
						Max{getSortIndicator('max')}
					</th>
					<th style={wrapStyle} onClick={() => handleSort('mean')}>
						Mean{getSortIndicator('mean')}
					</th>
					<th style={wrapStyle} onClick={() => handleSort('median')}>
						Median{getSortIndicator('median')}
					</th>
				</tr>
			</thead>
			<tbody>
				{sortedRows.map(({ label, stats }, idx) => (
					<tr key={`${caption}-${label}-${idx}`}>
						<th scope="row" style={wrapStyle}>{label}</th>
						<td style={wrapStyle}>{stats.count != null ? stats.count : 0}</td>
						<td style={wrapStyle}>{formatValue(stats.min, label)}</td>
						<td style={wrapStyle}>{formatValue(stats.max, label)}</td>
						<td style={wrapStyle}>{formatValue(stats.mean, label)}</td>
						<td style={wrapStyle}>{formatValue(stats.median, label)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

type RaceContextStats = {
	count: number,
	min: number,
	max: number,
	mean: number,
	median: number,
	q1: number,
	q3: number
};

type RaceContextRow = {
	label: string,
	stats: RaceContextStats,
	results: number[]
};

function raceContextPercentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	if (sorted.length === 1) return sorted[0];
	const index = (sorted.length - 1) * p;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower];
	const weight = index - lower;
	return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function raceContextPlotScale(values: number[]): number {
	if (values.length === 0) return 0.01;
	if (values.length === 1) return Math.max(Math.abs(values[0]), 0.01);
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
	const std = Math.sqrt(variance);
	if (std === 0) return Math.max(...values.map(Math.abs), 0.01);
	const lower = mean - 3 * std;
	const upper = mean + 3 * std;
	return Math.max(Math.abs(lower), Math.abs(upper), 0.01);
}

type RaceContextData = {
	locations?: Array<{value: string, result: number}>,
	lengths?: Array<{value: number, result: number}>,
	terrains?: Array<{value: number, result: number}>,
	weathers?: Array<{value: number, result: number}>,
	seasons?: Array<{value: number, result: number}>
};

function groupRaceContextValues<T>(
	data: Array<{value: T, result: number}>,
	getLabel: (value: T) => string,
	sortFn?: (a: T, b: T) => number
): RaceContextRow[] {
	const grouped = new Map<string, {value: T, results: number[]}>();
	data.forEach(({value, result}) => {
		const label = getLabel(value);
		if (!grouped.has(label)) grouped.set(label, {value, results: []});
		grouped.get(label)!.results.push(result);
	});

	const rows = Array.from(grouped.entries()).map(([label, {value, results}]) => {
		const sorted = [...results].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		const median = sorted.length % 2 === 0
			? (sorted[mid - 1] + sorted[mid]) / 2
			: sorted[mid];
		return {
			label,
			value,
			results,
			stats: {
				count: results.length,
				min: sorted[0],
				max: sorted[sorted.length - 1],
				mean: results.reduce((sum, result) => sum + result, 0) / results.length,
				median,
				q1: raceContextPercentile(sorted, 0.25),
				q3: raceContextPercentile(sorted, 0.75)
			}
		};
	});

	rows.sort((a, b) => sortFn
		? sortFn(a.value, b.value)
		: a.label.localeCompare(b.label));
	return rows.map(({label, stats, results}) => ({label, stats, results}));
}

type RaceContextSortColumn = 'label' | keyof RaceContextStats;

function RaceContextGroup({title, rows}: {title: string, rows: RaceContextRow[]}) {
	const [sortColumn, setSortColumn] = useState<RaceContextSortColumn | null>(null);
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	if (rows.length === 0) return null;
	const sortRows = (column: RaceContextSortColumn) => {
		if (sortColumn === column) {
			setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
		} else {
			setSortColumn(column);
			setSortDirection('asc');
		}
	};
	const sortIndicator = (column: RaceContextSortColumn) =>
		sortColumn === column ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';
	const displayedRows = sortColumn
		? [...rows].sort((a, b) => {
			if (sortColumn === 'label') {
				const difference = a.label.localeCompare(b.label, undefined, {numeric: true, sensitivity: 'base'});
				return sortDirection === 'asc' ? difference : -difference;
			}
			const difference = a.stats[sortColumn] - b.stats[sortColumn];
			return sortDirection === 'asc' ? difference : -difference;
		})
		: rows;
	const maxAbs = raceContextPlotScale(rows.flatMap(row => row.results));
	const position = (value: number) => Math.max(0, Math.min(100, 50 + (value / maxAbs) * 50));

	return (
		<section class="raceContextGroup">
			<div class="raceContextColumns">
				<button type="button" class="raceContextGroupTitle" onClick={() => sortRows('label')}>{title}{sortIndicator('label')}</button>
				<button type="button" onClick={() => sortRows('count')}>Samples{sortIndicator('count')}</button>
				<span>Finish Margin</span>
				<div>
					<button type="button" onClick={() => sortRows('min')}>Min{sortIndicator('min')}</button>
					<button type="button" onClick={() => sortRows('max')}>Max{sortIndicator('max')}</button>
					<button type="button" onClick={() => sortRows('mean')}>Mean{sortIndicator('mean')}</button>
					<button type="button" onClick={() => sortRows('median')}>Median{sortIndicator('median')}</button>
				</div>
			</div>
			<div class="raceContextRows">
				{displayedRows.map(({label, stats}) => {
					const meanWidth = Math.min(50, Math.abs(stats.mean) / maxAbs * 50);
					const meanLeft = stats.mean < 0 ? 50 - meanWidth : 50;
					const meanClass = stats.mean < 0 ? 'favorsUma1' : stats.mean > 0 ? 'favorsUma2' : 'isEven';
					return (
						<div class="raceContextRow" key={`${title}-${label}`}>
							<div class="raceContextRowHeader">
								<strong>{label}</strong>
							</div>
							<strong class="raceContextSamples">{stats.count.toLocaleString()}</strong>
							<div class="raceContextPlot" aria-label={`${label}: mean ${stats.mean.toFixed(2)}, median ${stats.median.toFixed(2)}, IQR ${stats.q1.toFixed(2)} to ${stats.q3.toFixed(2)}`}>
								<div
									class="raceContextRange"
									style={`left:${position(stats.min)}%;width:${Math.max(1, position(stats.max) - position(stats.min))}%`}
								/>
								<div
									class={`raceContextMean ${meanClass}`}
									style={`left:${meanLeft}%;width:${meanWidth > 0 ? Math.max(meanWidth, 0.5) : 0}%`}
								/>
								<div class="raceContextCenter" />
								<div class="raceContextQuartile" style={`left:${position(stats.q1)}%`} />
								<div class="raceContextQuartile" style={`left:${position(stats.q3)}%`} />
								<div class="raceContextMedian" style={`left:${position(stats.median)}%`} />
							</div>
							<div class="raceContextMetrics">
								<strong>{stats.min.toFixed(2)}</strong>
								<strong>{stats.max.toFixed(2)}</strong>
								<strong>{stats.mean.toFixed(2)}</strong>
								<strong>{stats.median.toFixed(2)}</strong>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function RaceContextResults({raceParams}: {raceParams: RaceContextData | null}) {
	if (!raceParams) return null;
	const terrainLabels = ['', 'Firm', 'Good', 'Soft', 'Heavy'];
	const weatherLabels = ['', 'Sunny', 'Cloudy', 'Rainy', 'Snowy'];
	const seasonLabels = ['', 'Spring', 'Summer', 'Autumn', 'Winter', 'Sakura'];
	const trackNames = TRACKNAMES_en as {[key: string]: string};
	const lengthGroup = {
		title: 'Length',
		rows: groupRaceContextValues<number>(
			raceParams.lengths || [],
			value => `${value} m`,
			(a, b) => a - b
		)
	};
	const locationGroup = {
		title: 'Racetrack',
		rows: groupRaceContextValues<string>(
			raceParams.locations || [],
			value => trackNames[value] || value
		)
	};
	const terrainGroup = {
		title: 'Condition',
		rows: groupRaceContextValues<number>(
			raceParams.terrains || [],
			value => terrainLabels[value] || value.toString(),
			(a, b) => a - b
		)
	};
	const weatherGroup = {
		title: 'Weather',
		rows: groupRaceContextValues<number>(
			raceParams.weathers || [],
			value => weatherLabels[value] || value.toString(),
			(a, b) => a - b
		)
	};
	const seasonGroup = {
		title: 'Season',
		rows: groupRaceContextValues<number>(
			raceParams.seasons || [],
			value => seasonLabels[value] || value.toString(),
			(a, b) => a - b
		)
	};
	const groups = [lengthGroup, locationGroup, terrainGroup, weatherGroup, seasonGroup]
		.filter(group => group.rows.length > 0);

	if (groups.length === 0) return null;
	return (
		<section class="raceContextResults">
			<div class="raceContextHeading">
				<div>
					<h3>Performance by Racetrack Context</h3>
				</div>
				<p class="raceContextHint">Mean (colored bar) is overlaid onto a standard box-and-whisker plot clipped at 3 sigma.</p>
			</div>
			<div class="raceContextGrid">
				<div class="raceContextLeftColumn">
					<RaceContextGroup title={lengthGroup.title} rows={lengthGroup.rows} />
					{terrainGroup.rows.length > 0 && (
						<div class="raceContextTerrainSlot">
							<RaceContextGroup title={terrainGroup.title} rows={terrainGroup.rows} />
						</div>
					)}
					<RaceContextGroup title={weatherGroup.title} rows={weatherGroup.rows} />
				</div>
				<div class="raceContextLocationColumn">
					<RaceContextGroup title={locationGroup.title} rows={locationGroup.rows} />
				</div>
				<div class="raceContextSeasonSlot">
					<RaceContextGroup title={seasonGroup.title} rows={seasonGroup.rows} />
				</div>
			</div>
		</section>
	);
}

function App(props) {
	//const [language, setLanguage] = useLanguageSelect(); 
	const trackWidth = trackWidthFor(useUiViewport());
	const [darkMode, toggleDarkMode] = useReducer(b=>!b, false);
	const [savedPreferences] = useState(loadPreferences);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const [globalSkillChartSimulateAll, setGlobalSkillChartSimulateAll] = useState(() => preferenceOr(savedPreferences, 'globalSkillChartSimulateAll', true));
	const [globalSkillChartSelectedSkills, setGlobalSkillChartSelectedSkills] = useState(() => SkillSet(preferenceOr<string[]>(savedPreferences, 'globalSkillChartSelectedSkills', [])));
	const [hasGlobalSkillChartRun, setHasGlobalSkillChartRun] = useState(false);
	const [chartSkillIconFilters, setChartSkillIconFilters] = useState<SkillIconTypeFilterState>(() => preferenceOr(savedPreferences, 'chartSkillIconFilters', createInitialIconTypeFilterState({
		deselectPurple: true,
		deselectIcons: ['2009', '3007']
	})));
	const [chartSkillRarityFilters, setChartSkillRarityFilters] = useState<SkillRarityFilterState>(() => preferenceOr(savedPreferences, 'chartSkillRarityFilters', createInitialRarityFilterState()));
	const [chartNoMatchingSkills, setChartNoMatchingSkills] = useState(false);
	const chartSkillIconFilterDefault = useMemo(() => createInitialIconTypeFilterState({
		deselectPurple: true,
		deselectIcons: ['2009', '3007']
	}), []);
	const chartSkillRarityFilterDefault = useMemo(() => createInitialRarityFilterState(), []);
	const [racedef, setRaceDef] = useState(() => DEFAULT_PRESET.racedef);
	const [nsamples, setSamples] = useState(DEFAULT_SAMPLES);
	const [workerCount, setWorkerCount] = useState(() => preferenceOr(savedPreferences, 'workerCount', 8));
	const [chartRun1Samples, setChartRun1Samples] = useState(() => preferenceOr(savedPreferences, 'chartRun1Samples', 5));
	const [chartRun2Samples, setChartRun2Samples] = useState(() => preferenceOr(savedPreferences, 'chartRun2Samples', 25));
	const [chartRun3Samples, setChartRun3Samples] = useState(() => preferenceOr(savedPreferences, 'chartRun3Samples', 100));
	const [globalChartRun1SamplesPerLength, setGlobalChartRun1SamplesPerLength] = useState(() => preferenceOr(savedPreferences, 'globalChartRun1SamplesPerLength', 5));
	const [globalChartRun2Samples, setGlobalChartRun2Samples] = useState(() => preferenceOr(savedPreferences, 'globalChartRun2Samples', 50));
	const [globalChartRun3Samples, setGlobalChartRun3Samples] = useState(() => preferenceOr(savedPreferences, 'globalChartRun3Samples', 100));
	const [seed, setSeed] = useState(DEFAULT_SEED);
	const [runOnceCounter, setRunOnceCounter] = useState(0);
	const [isSimulationRunning, setIsSimulationRunning] = useState(false);
	const [simulationProgress, setSimulationProgress] = useState<{round: number, total: number, completed?: number, totalSkills?: number} | null>(null);
	const [workerVersion, setWorkerVersion] = useState(0);
	const chartWorkersCompletedRef = useRef(0);
	const chartWorkersProgressRef = useRef<Map<number, {round: number, completed: number, totalSkills: number}>>(new Map());
	const chartWorkersInitialSkillsRef = useRef<Map<number, number>>(new Map());
	const chartWorkersCompletedSetRef = useRef<Set<number>>(new Set());
	const chartProgressRenderTimerRef = useRef<number | null>(null);
	const chartWorkerCountRef = useRef(8);
	const activeWorkersRef = useRef<Set<number>>(new Set());
	const [posKeepMode, setPosKeepModeRaw] = useState(PosKeepMode.Approximate);
	const [showHp, toggleShowHp] = useReducer((b,_) => !b, true);
	const [hpConsumption, toggleHpConsumption] = useReducer((b,_) => !b, true);
	const [showLanes, toggleShowLanes] = useReducer((b,_) => !b, false);
	
	useEffect(() => { document.documentElement.classList.toggle('dark', darkMode);}, [darkMode]);
	//fuck dark mode
	
	// Wrapper to handle mode changes and reset tab if needed
	function setPosKeepMode(mode: PosKeepMode) {
		setPosKeepModeRaw(mode);
		// If switching away from Virtual mode while on the pacemaker tab (index 2), switch back to uma1
		if (mode !== PosKeepMode.Virtual && currentIdx === 2) {
			updateUiState(UiStateMsg.SetCurrentIdx0);
		}
	}

	const [syncRng, toggleSyncRng] = useReducer((b,_) => !b, true);
	const [skillWisdomCheck, toggleSkillWisdomCheck] = useReducer((b,_) => !b, true);
	const [rushedKakari, toggleRushedKakari] = useReducer((b,_) => !b, true);
	const [competeFight, setCompeteFight] = useState(true);
	const [leadCompetition, setLeadCompetition] = useState(true);
	const [forceIdenticalMood, setForceIdenticalMood] = useState(false);
	const [duelingConfigOpen, setDuelingConfigOpen] = useState(false);
	const [duelingRates, setDuelingRates] = useState({
		runaway: 10,
		frontRunner: 20,
		paceChaser: 30,
		lateSurger: 35,
		endCloser: 35
	});
	const [showVirtualPacemakerOnGraph, toggleShowVirtualPacemakerOnGraph] = useReducer((b,_) => !b, false);
	const [pacemakerCount, setPacemakerCount] = useState(1);
	const [selectedPacemakerIndices, setSelectedPacemakerIndices] = useState([]); // Array of selected pacemaker indices (0, 1, 2), empty means none selected
	const [isPacemakerDropdownOpen, setIsPacemakerDropdownOpen] = useState(false);
	const [globalCompareDistance, setGlobalCompareDistance] = useState<DistanceType>(() => preferenceOr(savedPreferences, 'globalCompareDistance', DistanceType.Mile));
	const [globalCompareTerrain, setGlobalCompareTerrain] = useState<Surface>(() => preferenceOr(savedPreferences, 'globalCompareTerrain', Surface.Turf));
	const globalSpecificSkillIds = useMemo(() => {
		return Array.from(globalSkillChartSelectedSkills.values()).sort((a, b) => {
			const indexA = baseSkillsToTest.indexOf(a);
			const indexB = baseSkillsToTest.indexOf(b);
			return (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA)
				- (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB)
				|| a.localeCompare(b);
		});
	}, [globalSkillChartSelectedSkills]);
	useEffect(() => {
		if (globalSpecificSkillIds.length > 0) {
			setGlobalSkillChartSimulateAll(false);
		}
	}, [globalSpecificSkillIds]);
	function removeGlobalSpecificSkill(skillId: string) {
		setGlobalSkillChartSelectedSkills(prev => {
			const key = prev.findKey(id => id == skillId);
			return key == null ? prev : prev.delete(key);
		});
	}
	function clearGlobalSpecificSkills() {
		setGlobalSkillChartSelectedSkills(SkillSet([]));
	}
	function resetChartSkillFilters() {
		setChartSkillIconFilters({ ...chartSkillIconFilterDefault });
		setChartSkillRarityFilters({ ...chartSkillRarityFilterDefault });
	}
	const [maxCareerRating, setMaxCareerRating] = useState(() => preferenceOr(savedPreferences, 'maxCareerRating', 14500));
	const [optimizerResult, setOptimizerResult] = useState<any>(null);
	const [optimizerProgress, setOptimizerProgress] = useState<any>(null);
	const [optimizerIterations, setOptimizerIterations] = useState<any[]>([]);
	const [optimizerMaxIterations, setOptimizerMaxIterations] = useState(() => preferenceOr(savedPreferences, 'optimizerMaxIterations', 100));
const [optimizerEvaluationMethod, setOptimizerEvaluationMethod] = useState<'mean' | 'median' | 'aggregate'>(() => preferenceOr(savedPreferences, 'optimizerEvaluationMethod', 'median'));
	const [optimizerMinStat, setOptimizerMinStat] = useState(() => preferenceOr(savedPreferences, 'optimizerMinStat', 400));
	const [optimizerMaxStatPreset, setOptimizerMaxStatPreset] = useState<OptimizerMaxStatPreset>(() => {
		const preset = preferenceOr<string>(savedPreferences, 'optimizerMaxStatPreset', 'concert');
		return preset in OPTIMIZER_MAX_STAT_PRESETS ? preset as OptimizerMaxStatPreset : 'concert';
	});
	const [optimizerMaxStats, setOptimizerMaxStats] = useState<OptimizerMaxStats>(() => preferenceOr(savedPreferences, 'optimizerMaxStats', {...OPTIMIZER_MAX_STAT_PRESETS.concert}));
	const [optimizerChartData, setOptimizerChartData] = useState<any>(null);
	const [optimizerRunData, setOptimizerRunData] = useState<any>(null);
	const [optimizerDisplaying, setOptimizerDisplaying] = useState<'minrun' | 'maxrun' | 'meanrun' | 'medianrun'>('medianrun');
const [optimizerInitCount, setOptimizerInitCount] = useState(() => preferenceOr(savedPreferences, 'optimizerInitCount', 100));
const [optimizerUseReferenceInit, setOptimizerUseReferenceInit] = useState(() => preferenceOr(savedPreferences, 'optimizerUseReferenceInit', false));
	const [optimizerInitSamples, setOptimizerInitSamples] = useState(() => preferenceOr(savedPreferences, 'optimizerInitSamples', 10));
	const [optimizerIterSamples, setOptimizerIterSamples] = useState(() => preferenceOr(savedPreferences, 'optimizerIterSamples', 20));
	const [optimizerFinalRunSamples, setOptimizerFinalRunSamples] = useState(() => preferenceOr(savedPreferences, 'optimizerFinalRunSamples', 500));
	const [optimizerPhase, setOptimizerPhase] = useState<'init' | 'iter' | 'final' | null>(null);
	const [optimizerInitProgress, setOptimizerInitProgress] = useState<{completed: number; total: number} | null>(null);
	const [optimizerFinalProgress, setOptimizerFinalProgress] = useState<{completed: number; total: number} | null>(null);
const [optimizerFinalCumulative, setOptimizerFinalCumulative] = useState<{diffs: number[]; marginStats: {min: number; max: number; mean: number; median: number}; runData: any; chartData: any} | null>(null);
	
	function handlePacemakerCountChange(newCount: number) {
		setPacemakerCount(newCount);
		const newSelection = selectedPacemakerIndices.filter(index => index < newCount);
		setSelectedPacemakerIndices(newSelection);
	}
	
	function handlePacemakerSelectionChange(selectedIndices: number[]) {
		setSelectedPacemakerIndices(selectedIndices);
	}
	
	function togglePacemakerSelection(index: number) {
		const newSelection = [...selectedPacemakerIndices];
		const existingIndex = newSelection.indexOf(index);
		if (existingIndex > -1) {
			newSelection.splice(existingIndex, 1);
		} else {
			newSelection.push(index);
		}

		setSelectedPacemakerIndices(newSelection);
	}
	
	function getSelectedPacemakers(): boolean[] {
		const result = [false, false, false];

		selectedPacemakerIndices.forEach(index => {
			if (index >= 0 && index < 3) {
				result[index] = true;
			}
		});

		return result;
	}
	
	function handleSyncRngToggle() {
		toggleSyncRng(null);
	}
	
	function handleSkillWisdomCheckToggle() {
		toggleSkillWisdomCheck(null);
	}
	
	function handleRushedKakariToggle() {
		toggleRushedKakari(null);
	}
	
	function autoSaveSettings() {
		saveToLocalStorage(courseId, nsamples, seed, posKeepMode, racedef, uma1, uma2, pacer, showVirtualPacemakerOnGraph, pacemakerCount, getSelectedPacemakers(), showLanes, {
			syncRng,
			skillWisdomCheck,
			rushedKakari
		}, competeFight, leadCompetition, duelingRates, forceIdenticalMood);
	}

	function resetUmas() {
		setUma1(new HorseState());
		setUma2(new HorseState());
		if (posKeepMode === PosKeepMode.Virtual) {
			setPacer(new HorseState({strategy: 'Nige'}));
		}
	}
	
	function resetAllUmas() {
		setUma1(new HorseState());
		setUma2(new HorseState());
		setPacer(new HorseState({strategy: 'Nige'}));
	}
	
	const [{mode, currentIdx}, updateUiState] = useReducer(nextUiState, DEFAULT_UI_STATE);
	const [courseId, setCourseIdValue] = useState(DEFAULT_COURSE_ID);
	const [chartDetailState, setChartDetailState] = useReducer(updateResultsState, EMPTY_RESULTS_STATE);
	const [raceCompareState, setRaceCompareState] = useReducer(updateResultsState, EMPTY_RESULTS_STATE);
	const [globalCompareState, setGlobalCompareState] = useReducer(updateResultsState, EMPTY_RESULTS_STATE);
	const activeResultsState = mode == Mode.GlobalCompare
		? globalCompareState
		: mode == Mode.Compare
			? raceCompareState
			: chartDetailState;
	const {results, runData, chartData, displaying, spurtInfo, staminaStats, firstUmaStats, skillActivationStats, raceParams} = activeResultsState;
	const setResults = setChartDetailState;
	const setCourseId = (id: number) => {
		setCourseIdValue(id);
		setChartDetailState(id);
		setRaceCompareState(id);
	};
	const setChartData = (display: string) => {
		if (mode == Mode.GlobalCompare) {
			setGlobalCompareState(display);
		} else if (mode == Mode.Compare) {
			setRaceCompareState(display);
		} else {
			setChartDetailState(display);
		}
	};

	const mergeTableData = (data, newData) => {
		const merged = new Map();
		if (newData == 'reset') {
			return merged;
		}
		data.forEach((v,k) => merged.set(k,v));
		(newData as any).forEach((v,k) => merged.set(k,v));
		return merged;
	};
	const [skillTableData, updateSkillTableData] = useReducer(mergeTableData, new Map());
	const [uniquesTableData, updateUniquesTableData] = useReducer(mergeTableData, new Map());
	const [globalTableData, updateGlobalTableData] = useReducer(mergeTableData, new Map());
	const skillTableDataRef = useRef(skillTableData);
	const uniquesTableDataRef = useRef(uniquesTableData);
	const globalTableDataRef = useRef(globalTableData);
	const selectedSkillIdRef = useRef('');
	const selectedUniquesSkillIdRef = useRef('');
	const selectedGlobalSkillIdRef = useRef('');
	const chartRunModeRef = useRef<Mode>(Mode.Chart);
	const compareRunModeRef = useRef<Mode>(Mode.Compare);
	const additionalSamplesTargetsRef = useRef(new Map<string, Mode>());
	useEffect(() => {
		skillTableDataRef.current = skillTableData;
	}, [skillTableData]);
	useEffect(() => {
		uniquesTableDataRef.current = uniquesTableData;
	}, [uniquesTableData]);
	useEffect(() => {
		globalTableDataRef.current = globalTableData;
	}, [globalTableData]);

	const [popoverSkill, setPopoverSkill] = useState('');

	function racesetter(prop) {
		return (value) => setRaceDef(racedef.set(prop, value));
	}

	const course = useMemo(() => CourseHelpers.getCourse(courseId), [courseId]);

	const [uma1, setUma1] = useState(() => new HorseState());
	const [uma2, setUma2] = useState(() => new HorseState());
	const [pacer, setPacer] = useState(() => new HorseState({strategy: 'Nige'}));

	const [lastRunChartUma, setLastRunChartUma] = useState(uma1);

	const [settingsOpen, setSettingsOpen] = useState(false);
	const modeRef = useRef(mode);
	modeRef.current = mode;
	const currentRouteUrlRef = useRef('');
	currentRouteUrlRef.current = settingsOpen ? routeUrl(SETTINGS_ROUTE_PATH) : modeRouteUrl(mode);

	const [loadingAdditionalSamples, setLoadingAdditionalSamples] = useState<Set<string>>(new Set());
	const [additionalSamplesRunCount, setAdditionalSamplesRunCount] = useState<Map<string, number>>(new Map());
	const [additionalSamplesProgress, setAdditionalSamplesProgress] = useState<{skillId: string; completed: number; total: number} | null>(null);
	const additionalSamplesBaseResultsRef = useRef<Map<string, any>>(new Map());

	// Create dynamic workers array (max 16 workers)
	const workers = useMemo(() => {
		return Array.from({length: 16}, (_, i) => i + 1).map((workerIndex) => {
			const w = new Worker('./simulator.worker.js');
			w.addEventListener('message', function (e) {
			const {type, results, round, total, skillId, result, completed, totalSkills, iteration, data, error, partialResult} = e.data;
			const rawProgressSkillId = skillId ?? data?.skillId;
			const progressSkillId = rawProgressSkillId != null ? String(rawProgressSkillId) : undefined;
			const progressCompleted = completed ?? data?.completed;
			const progressTotal = total ?? data?.total;
			switch (type) {
				case 'compare':
					if (compareRunModeRef.current === Mode.GlobalCompare) {
						setGlobalCompareState(results);
					} else {
						setRaceCompareState(results);
					}
					break;
				case 'chart':
					if (chartRunModeRef.current === Mode.GlobalSkillChart) {
						updateGlobalTableData(results);
					} else if (chartRunModeRef.current === Mode.UniquesChart) {
						updateUniquesTableData(results);
					} else {
						updateSkillTableData(results);
					}
					break;
				case 'optimizer':
					setOptimizerPhase(null);
					setOptimizerFinalProgress(null);
					setOptimizerResult(result);
					if (result.iterations && result.iterations.length > 0) {
						const lastIteration = result.iterations[result.iterations.length - 1];
						if (result.finalChartData) {
							setOptimizerChartData(result.finalChartData);
							if (result.finalRunData) {
								const diffs = result.finalRunData.__diffs || [];
								const marginStats = result.finalRunData.__marginStats || {min: 0, max: 0, mean: 0, median: 0};
								setOptimizerFinalCumulative({
									diffs,
									marginStats,
									runData: result.finalRunData,
									chartData: result.finalChartData
								});
							}
						} else if (lastIteration.chartData) {
							setOptimizerChartData(lastIteration.chartData);
						}
						if (result.finalRunData) {
							setOptimizerRunData(result.finalRunData);
						} else if (lastIteration.runData) {
							setOptimizerRunData(lastIteration.runData);
						}
					}
					break;
				case 'optimizer-init-progress':
					setOptimizerPhase('init');
					setOptimizerInitProgress({completed: data.completed, total: data.total});
					break;
				case 'optimizer-final-progress':
					setOptimizerPhase('final');
					setOptimizerFinalProgress({completed: data.completed, total: data.total});
					if (data.cumulativeResults) {
						const diffs = data.cumulativeResults.results || [];
						const sorted = [...diffs].sort((a,b) => a - b);
						const mid = Math.floor(sorted.length / 2);
						const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
						const mean = diffs.length > 0 ? diffs.reduce((a,b) => a + b, 0) / diffs.length : 0;
						const marginStats = {
							min: sorted.length ? sorted[0] : 0,
							max: sorted.length ? sorted[sorted.length - 1] : 0,
							mean,
							median
						};
						const runData = data.cumulativeResults.runData
							? {
								...data.cumulativeResults.runData,
								__staminaStats: data.cumulativeResults.staminaStats || null,
								__firstUmaStats: data.cumulativeResults.firstUmaStats || null
							}
							: null;
						const chartData = runData?.meanrun || runData?.medianrun || runData?.minrun || null;
						setOptimizerFinalCumulative({diffs, marginStats, runData, chartData});
						if (runData) {
							setOptimizerRunData(runData);
						}
						if (chartData) {
							setOptimizerChartData(chartData);
						}
						setOptimizerIterations(prev => {
							if (!prev.length) return prev;
							const last = prev[prev.length - 1];
							const updated = {...last, diffs, marginStats, runData, chartData};
							return [...prev.slice(0, -1), updated];
						});
					}
					break;
				case 'optimizer-progress':
					setOptimizerPhase('iter');
					setOptimizerProgress(iteration);
					setOptimizerIterations(prev => [...prev, iteration]);
					if (iteration.chartData) {
						setOptimizerChartData(iteration.chartData);
					}
					if (iteration.runData) {
						setOptimizerRunData(iteration.runData);
					}
					break;
				case 'optimizer-complete':
					activeWorkersRef.current.delete(workerIndex);
					setIsSimulationRunning(false);
					setOptimizerProgress(null);
					break;
				case 'chart-progress':
					// Store progress for this specific worker
					if (round !== undefined && completed !== undefined && totalSkills !== undefined) {
						// Track initial skill count for this worker (on round 1, completed 0)
						if (round === 1 && completed === 0) {
							chartWorkersInitialSkillsRef.current.set(workerIndex, totalSkills);
						}
						
						chartWorkersProgressRef.current.set(workerIndex, {round, completed, totalSkills});
						// Trigger re-render by setting a dummy progress (we'll display per-worker progress from the ref).
						// Workers report after every skill; coalesce so re-renders can't queue up faster than the main thread draws them.
						if (chartProgressRenderTimerRef.current == null) {
							chartProgressRenderTimerRef.current = window.setTimeout(() => {
								chartProgressRenderTimerRef.current = null;
								setSimulationProgress({round: 0, total: 0});
							}, CHART_PROGRESS_RENDER_INTERVAL_MS);
						}
					}
					break;
				case 'chart-skill-start':
					// Debug aid: identifies exactly which skill a worker started before a potential stall.
					console.info(
						`[ChartDebug] Worker ${workerIndex} run ${e.data.round ?? '?'} starting skill ${e.data.skillIndex ?? '?'} / ${e.data.totalSkills ?? '?'}: ${e.data.skillId ?? 'unknown'}`
					);
					break;
				case 'chart-skill-error':
					console.error(
						`[ChartDebug] Worker ${workerIndex} run ${e.data.round ?? '?'} failed on skill ${e.data.skillIndex ?? '?'} / ${e.data.totalSkills ?? '?'}: ${e.data.skillId ?? 'unknown'}`,
						e.data.error
					);
					break;
				case 'compare-progress':
					setSimulationProgress({round: completed, total});
					// Update UI with cumulative results if provided
					if (results) {
						if (compareRunModeRef.current === Mode.GlobalCompare) {
							setGlobalCompareState(results);
						} else {
							setRaceCompareState(results);
						}
					}
					break;
				case 'compare-complete':
					activeWorkersRef.current.delete(workerIndex);
					setIsSimulationRunning(false);
					setSimulationProgress(null);
					break;
				case 'chart-complete':
					// Mark worker as completed (don't delete progress)
					activeWorkersRef.current.delete(workerIndex);
					chartWorkersCompletedSetRef.current.add(workerIndex);
					chartWorkersCompletedRef.current += 1;
					if (chartWorkersCompletedRef.current >= chartWorkerCountRef.current) {
						if (chartProgressRenderTimerRef.current != null) {
							clearTimeout(chartProgressRenderTimerRef.current);
							chartProgressRenderTimerRef.current = null;
						}
						setIsSimulationRunning(false);
						setSimulationProgress(null);
						chartWorkersCompletedRef.current = 0;
						chartWorkersProgressRef.current.clear();
						chartWorkersInitialSkillsRef.current.clear();
						chartWorkersCompletedSetRef.current.clear();
						activeWorkersRef.current.clear();
					}
					break;
				case 'additional-samples':
					if (progressSkillId && result) {
						const sampleTargetMode = additionalSamplesTargetsRef.current.get(progressSkillId) ?? Mode.Chart;
						const baseResult = additionalSamplesBaseResultsRef.current.get(progressSkillId);
						const merged = baseResult ? mergeResults(baseResult, result) : result;
						const updatedMap = new Map(
							sampleTargetMode === Mode.GlobalSkillChart
								? globalTableDataRef.current
								: sampleTargetMode === Mode.UniquesChart
									? uniquesTableDataRef.current
									: skillTableDataRef.current
						);
						updatedMap.set(progressSkillId, merged);
						if (sampleTargetMode === Mode.GlobalSkillChart) {
							updateGlobalTableData(updatedMap);
						} else if (sampleTargetMode === Mode.UniquesChart) {
							updateUniquesTableData(updatedMap);
						} else {
							updateSkillTableData(updatedMap);
						}
						const selectedSkillRef = sampleTargetMode === Mode.GlobalSkillChart
							? selectedGlobalSkillIdRef
							: sampleTargetMode === Mode.UniquesChart
								? selectedUniquesSkillIdRef
								: selectedSkillIdRef;
						if (selectedSkillRef.current === progressSkillId) {
							setResults(merged);
						}
						additionalSamplesBaseResultsRef.current.delete(progressSkillId);
						additionalSamplesTargetsRef.current.delete(progressSkillId);
					}
					setLoadingAdditionalSamples(prev => {
						const next = new Set(prev);
						if (progressSkillId) next.delete(progressSkillId);
						return next;
					});
					setAdditionalSamplesProgress(null);
					break;
				case 'additional-samples-progress':
					if (progressSkillId && progressCompleted !== undefined && progressTotal !== undefined) {
						setAdditionalSamplesProgress({
							skillId: progressSkillId,
							completed: progressCompleted,
							total: progressTotal
						});
					}
					if (progressSkillId && partialResult) {
						const sampleTargetMode = additionalSamplesTargetsRef.current.get(progressSkillId) ?? Mode.Chart;
						const baseResult = additionalSamplesBaseResultsRef.current.get(progressSkillId);
						const merged = baseResult ? mergeResults(baseResult, partialResult) : partialResult;
						const updatedMap = new Map(
							sampleTargetMode === Mode.GlobalSkillChart
								? globalTableDataRef.current
								: sampleTargetMode === Mode.UniquesChart
									? uniquesTableDataRef.current
									: skillTableDataRef.current
						);
						updatedMap.set(progressSkillId, merged);
						if (sampleTargetMode === Mode.GlobalSkillChart) {
							updateGlobalTableData(updatedMap);
						} else if (sampleTargetMode === Mode.UniquesChart) {
							updateUniquesTableData(updatedMap);
						} else {
							updateSkillTableData(updatedMap);
						}
						const selectedSkillRef = sampleTargetMode === Mode.GlobalSkillChart
							? selectedGlobalSkillIdRef
							: sampleTargetMode === Mode.UniquesChart
								? selectedUniquesSkillIdRef
								: selectedSkillIdRef;
						if (selectedSkillRef.current === progressSkillId) {
							setResults(merged);
						}
					}
					break;
				case 'additional-samples-error':
					setLoadingAdditionalSamples(prev => {
						const next = new Set(prev);
						if (progressSkillId) next.delete(progressSkillId);
						return next;
					});
					setAdditionalSamplesProgress(null);
					if (progressSkillId) {
						additionalSamplesBaseResultsRef.current.delete(progressSkillId);
						additionalSamplesTargetsRef.current.delete(progressSkillId);
					}
					console.error('additional-samples-error', error);
					break;
			}
			});
			return w;
		});
	}, [workerVersion]);

	function applyLoadedSettings(o) {
		setCourseId(o.courseId);
		setSamples(o.nsamples);
		setSeed(o.seed);
		setPosKeepModeRaw(o.posKeepMode);
		setRaceDef(o.racedef);
		setUma1(o.uma1);
		setUma2(o.uma2);
		setPacer(o.pacer);
		setPacemakerCount(o.pacemakerCount);
		setSelectedPacemakerIndices(o.selectedPacemakers ? 
			o.selectedPacemakers.map((selected, index) => selected ? index : -1).filter(index => index !== -1) : 
			[]);
		
		if (o.showVirtualPacemakerOnGraph !== undefined && o.showVirtualPacemakerOnGraph !== showVirtualPacemakerOnGraph) {
			toggleShowVirtualPacemakerOnGraph(null);
		}

		if (o.showLanes !== undefined && o.showLanes !== showLanes) {
			toggleShowLanes(null);
		}

		if (o.witVarianceSettings) {
			const settings = o.witVarianceSettings;
			if (settings.syncRng !== undefined && settings.syncRng !== syncRng) toggleSyncRng(null);
			if (settings.skillWisdomCheck !== undefined && settings.skillWisdomCheck !== skillWisdomCheck) toggleSkillWisdomCheck(null);
			if (settings.rushedKakari !== undefined && settings.rushedKakari !== rushedKakari) toggleRushedKakari(null);
		}
		
		if (o.competeFight !== undefined) {
			setCompeteFight(o.competeFight);
		}
		if (o.leadCompetition !== undefined) {
			setLeadCompetition(o.leadCompetition);
		}
		if (o.duelingRates) {
			setDuelingRates(o.duelingRates);
		}
		if (o.forceIdenticalMood !== undefined) {
			setForceIdenticalMood(!!o.forceIdenticalMood);
		}
	}

	function loadLegacyStateHash(hash: string) {
		deserialize(hash).then(applyLoadedSettings, error => console.warn('Failed to load settings from link:', error));
	}

	function applyRoute(route: AppRoute) {
		setSettingsOpen(route.settings);
		if (route.settings) return;
		if (route.mode != modeRef.current) {
			modeRef.current = route.mode;
			updateUiState(MODE_ROUTES.find(r => r.mode == route.mode)!.msg);
		}
		try {
			localStorage.setItem(LAST_MODE_ROUTE_STORAGE_KEY, MODE_ROUTES.find(r => r.mode == route.mode)!.path);
		} catch (_) {}
	}

	function onRouteLinkClick(e: MouseEvent, url: string) {
		if (!isPlainLeftClick(e)) return;
		e.preventDefault();
		if (url != window.location.pathname) {
			window.history.pushState(null, '', url);
		}
		applyRoute(parseRouteUrl(url)!);
	}

	useEffect(function () {
		const initialRoute = parseRouteUrl(window.location.pathname);
		// Old share links put the serialized settings directly in the hash.
		const legacyStateHash = window.location.hash.slice(1);
		if (legacyStateHash) {
			loadLegacyStateHash(legacyStateHash);
		} else {
			loadFromLocalStorage().then(o => o && applyLoadedSettings(o));
		}
		const url = initialRoute == null
			? loadLastModeRouteUrl()
			: initialRoute.settings ? routeUrl(SETTINGS_ROUTE_PATH) : modeRouteUrl(initialRoute.mode);
		if (url != window.location.pathname || legacyStateHash) {
			window.history.replaceState(null, '', url);
		}
		applyRoute(parseRouteUrl(url)!);

		function onPopState() {
			const route = parseRouteUrl(window.location.pathname);
			if (route) {
				applyRoute(route);
			}
		}
		function onHashChange() {
			if (window.location.hash.length > 1) {
				loadLegacyStateHash(window.location.hash.slice(1));
			}
			window.history.replaceState(null, '', currentRouteUrlRef.current);
		}
		window.addEventListener('popstate', onPopState);
		window.addEventListener('hashchange', onHashChange);
		return () => {
			window.removeEventListener('popstate', onPopState);
			window.removeEventListener('hashchange', onHashChange);
		};
	}, []);

	useEffect(() => {
		const label = settingsOpen ? 'Settings' : MODE_ROUTES.find(r => r.mode == mode)!.label;
		document.title = `${label} | ${BASE_DOCUMENT_TITLE}`;
	}, [mode, settingsOpen]);

	useEffect(() => {
		savePreferences({
			workerCount,
			chartRun1Samples,
			chartRun2Samples,
			chartRun3Samples,
			globalChartRun1SamplesPerLength,
			globalChartRun2Samples,
			globalChartRun3Samples,
			globalCompareDistance,
			globalCompareTerrain,
			globalSkillChartSimulateAll,
			globalSkillChartSelectedSkills: Array.from(globalSkillChartSelectedSkills.values()),
			chartSkillIconFilters,
			chartSkillRarityFilters,
			maxCareerRating,
			optimizerMaxIterations,
			optimizerEvaluationMethod,
			optimizerMinStat,
			optimizerMaxStatPreset,
			optimizerMaxStats,
			optimizerInitCount,
			optimizerUseReferenceInit,
			optimizerInitSamples,
			optimizerIterSamples,
			optimizerFinalRunSamples
		});
	}, [workerCount, chartRun1Samples, chartRun2Samples, chartRun3Samples, globalChartRun1SamplesPerLength, globalChartRun2Samples, globalChartRun3Samples, globalCompareDistance, globalCompareTerrain, globalSkillChartSimulateAll, globalSkillChartSelectedSkills, chartSkillIconFilters, chartSkillRarityFilters, maxCareerRating, optimizerMaxIterations, optimizerEvaluationMethod, optimizerMinStat, optimizerMaxStatPreset, optimizerMaxStats, optimizerInitCount, optimizerUseReferenceInit, optimizerInitSamples, optimizerIterSamples, optimizerFinalRunSamples]);

	// Auto-save settings whenever they change
	useEffect(() => {
		autoSaveSettings();
	}, [courseId, nsamples, seed, posKeepMode, racedef, uma1, uma2, pacer, syncRng, skillWisdomCheck, rushedKakari, showVirtualPacemakerOnGraph, pacemakerCount, selectedPacemakerIndices, competeFight, leadCompetition, duelingRates, forceIdenticalMood]);

	useEffect(() => {
		const shouldShow = posKeepMode === PosKeepMode.Virtual && selectedPacemakerIndices.length > 0;
		if (shouldShow !== showVirtualPacemakerOnGraph) {
			if (shouldShow && !showVirtualPacemakerOnGraph) {
				toggleShowVirtualPacemakerOnGraph(null);
			} else if (!shouldShow && showVirtualPacemakerOnGraph) {
				toggleShowVirtualPacemakerOnGraph(null);
			}
		}
	}, [posKeepMode, selectedPacemakerIndices.length]);

	function generatePresetEntry(e) {
		e.preventDefault();
		const today = new Date();
		const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		const preset = {
			name: 'UNTITLED',
			date,
			courseId,
			season: PRESET_SEASON_LABEL[racedef.season],
			ground: PRESET_GROUND_LABEL[racedef.ground],
			weather: PRESET_WEATHER_LABEL[racedef.weather],
			time: PRESET_TIME_LABEL[racedef.time]
		};
		window.navigator.clipboard.writeText(JSON.stringify(preset, null, 2));
	}

	function copyUmaToRight() {
		postEvent('copyUma', {direction: 'to-right'});
		setUma2(uma1);
	}

	function copyUmaToLeft() {
		postEvent('copyUma', {direction: 'to-left'});
		setUma1(uma2);
	}

	function swapUmas() {
		postEvent('copyUma', {direction: 'swap'});
		setUma1(uma2);
		setUma2(uma1);
	}

	const strings = {skillnames: {}, tracknames: TRACKNAMES_en, ui: CC_GLOBAL ? UI_global : UI_en};
	const langid = +(props.lang == 'en');
	Object.keys(skillnames).forEach(id => strings.skillnames[id] = skillnames[id][langid]);

	function abortSimulation() {
		postEvent('abortSimulation', {});
		// Terminate all active workers
		activeWorkersRef.current.forEach(workerIndex => {
			if (workers[workerIndex]) {
				workers[workerIndex].terminate();
			}
		});
		// Clear active workers and reset state
		activeWorkersRef.current.clear();
		setIsSimulationRunning(false);
		setSimulationProgress(null);
		chartWorkersCompletedRef.current = 0;
		chartWorkersProgressRef.current.clear();
		chartWorkersInitialSkillsRef.current.clear();
		chartWorkersCompletedSetRef.current.clear();
		// Force worker recreation by incrementing version
		setWorkerVersion(prev => prev + 1);
	}

	function doComparison() {
		postEvent('doComparison', {});
		compareRunModeRef.current = Mode.Compare;
		setIsSimulationRunning(true);
		setSimulationProgress(null);
		activeWorkersRef.current.clear();
		activeWorkersRef.current.add(0);
		workers[0].postMessage({
			msg: 'compare',
			data: {
				nsamples,
				course,
				racedef: racedefToParams(racedef),
				uma1: uma1.toJS(),
				uma2: uma2.toJS(),
				pacer: pacer.toJS(),
				options: {
					seed, 
					posKeepMode, 
					pacemakerCount: posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
					hpConsumption,
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates,
					forceIdenticalMood: forceIdenticalMood
				}
			}
		});
	}

	function doGlobalComparison() {
		postEvent('doGlobalComparison', {});
		compareRunModeRef.current = Mode.GlobalCompare;
		setIsSimulationRunning(true);
		setSimulationProgress(null);
		activeWorkersRef.current.clear();
		activeWorkersRef.current.add(0);
		workers[0].postMessage({
			msg: 'global-compare',
			data: {
				nsamples,
				distanceType: globalCompareDistance,
				surface: globalCompareTerrain,
				uma1: uma1.toJS(),
				uma2: uma2.toJS(),
				pacer: pacer.toJS(),
				options: {
					seed, 
					posKeepMode, 
					pacemakerCount: posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
					hpConsumption,
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates,
					time: racedef.time,
					grade: racedef.grade,
					forceIdenticalMood: forceIdenticalMood
				}
			}
		});
	}

	function doGlobalSkillChart() {
		postEvent('doGlobalSkillChart', {});
		chartRunModeRef.current = Mode.GlobalSkillChart;
		setHasGlobalSkillChartRun(true);
		setLastRunChartUma(uma1);
		chartWorkersCompletedRef.current = 0;
		chartWorkersProgressRef.current.clear();
		chartWorkersInitialSkillsRef.current.clear();
		chartWorkersCompletedSetRef.current.clear();
		chartWorkerCountRef.current = workerCount;
		setIsSimulationRunning(true);
		setSimulationProgress(null);

		let skills = baseSkillsToTest.filter(id => {
			const skillsAny: any = uma1.skills as any;
			return !(id[0] == '9' && skillsAny.includes && skillsAny.includes('1' + id.slice(1))
				|| id == '92111091' && skillsAny.includes && skillsAny.includes('111091')
			) && skillPassesIconTypeFilters(id, chartSkillIconFilters)
				&& skillPassesRarityFilters(id, chartSkillRarityFilters);
		});
		if (!globalSkillChartSimulateAll) {
			const selectedSkills = Array.from(globalSkillChartSelectedSkills.values());
			if (selectedSkills.length === 0) {
				setIsSimulationRunning(false);
				return;
			}
			skills = selectedSkills;
		}
		
		const filler = new Map();
		skills.forEach(id => filler.set(id, getNullRow(id)));
		const skillChunks = splitSkillsAcrossWorkers(skills, workerCount);

		updateGlobalTableData('reset');
		updateGlobalTableData(filler);
		setAdditionalSamplesRunCount(new Map());

		const chartOptions = {
			seed,
			posKeepMode,
			pacemakerCount: posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
			hpConsumption,
			syncRng,
			skillWisdomCheck,
			rushedKakari,
			competeFight,
			leadCompetition,
			duelingRates,
			globalChartRun1SamplesPerLength,
			globalChartRun2Samples,
			globalChartRun3Samples,
			simulateAllSkills: globalSkillChartSimulateAll,
			debugSkillLogging: true,
			time: racedef.time,
			grade: racedef.grade
		};

		activeWorkersRef.current.clear();
		for (let i = 0; i < workerCount; i++) {
			activeWorkersRef.current.add(i);
			workers[i].postMessage({
				msg: 'global-chart',
				data: {
					skills: skillChunks[i],
					distanceType: globalCompareDistance,
					surface: globalCompareTerrain,
					uma: uma1.toJS(),
					pacer: pacer.toJS(),
					options: chartOptions
				}
			});
		}
	}

	function doRunOnce() {
		postEvent('doRunOnce', {});
		compareRunModeRef.current = Mode.Compare;
		setIsSimulationRunning(true);
		const effectiveSeed = seed + runOnceCounter;
		setRunOnceCounter(prev => prev + 1);
		activeWorkersRef.current.clear();
		activeWorkersRef.current.add(0);
		workers[0].postMessage({
			msg: 'compare',
			data: {
				nsamples: 1,
				course,
				racedef: racedefToParams(racedef),
				uma1: uma1.toJS(),
				uma2: uma2.toJS(),
				pacer: pacer.toJS(),
				options: {
					seed: effectiveSeed, 
					posKeepMode, 
					pacemakerCount: posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
					hpConsumption,
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates,
					forceIdenticalMood: forceIdenticalMood
				}
			}
		});
	}

	function getUniqueSkillId(outfitId: string): string {
		const i = +outfitId.slice(1, -2), v = +outfitId.slice(-2);
		return (100000 + 10000 * (v - 1) + i * 10 + 1).toString();
	}

	function doOptimizer() {
		postEvent('doOptimizer', {});
		setIsSimulationRunning(true);
		setOptimizerProgress(null);
		setOptimizerResult(null);
		setOptimizerIterations([]);
		setOptimizerChartData(null);
		setOptimizerRunData(null);
		setOptimizerDisplaying('medianrun');
		setOptimizerPhase('init');
		setOptimizerInitProgress({
			completed: 0,
			total: Math.max(1, optimizerInitCount) * Math.max(1, optimizerInitSamples)
		});
		setOptimizerFinalProgress(null);
		setOptimizerFinalCumulative(null);
		activeWorkersRef.current.clear();
		activeWorkersRef.current.add(0);
		workers[0].postMessage({
			msg: 'optimizer',
			data: {
				course,
				racedef: racedefToParams(racedef),
				uma: uma1.toJS(),
				uniqueSkillId: getUniqueSkillId(uma1.outfitId),
				maxCareerRating,
				options: {
					seed,
					posKeepMode,
					pacemakerCount: posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
					hpConsumption,
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates
				},
				evaluationMethod: optimizerEvaluationMethod,
				useReferenceInit: optimizerUseReferenceInit,
				initCandidates: optimizerInitCount,
				initSamples: optimizerInitSamples,
				iterSamples: optimizerIterSamples,
				finalRunSamples: optimizerFinalRunSamples,
				maxIterations: optimizerMaxIterations,
				minStat: optimizerMinStat,
				maxStat: optimizerMaxStats
			}
		});
	}

	function loadOptimizedIntoUma1() {
		if (!optimizerIterations.length) return;
		const last = optimizerIterations[optimizerIterations.length - 1];
		const best = last.bestSoFarStats || (optimizerResult?.bestStats);
		if (!best) return;
		setUma1(uma1.merge({
			speed: Math.round(best.speed),
			stamina: Math.round(best.stamina),
			power: Math.round(best.power),
			guts: Math.round(best.guts),
			wisdom: Math.round(best.wisdom)
		}));
	}

	function getUniqueSkills() {
		return Object.keys(skilldata).filter(id => {
			const skill = skilldata[id];
			return skill.rarity >= 4 && id.startsWith('1');
		});
	}
	
	function removeUniqueSkills(uma) {
		const uniqueSkills = getUniqueSkills();
		const filteredSkills = uma.skills.filter(skillId => !uniqueSkills.includes(skillId));
		return uma.set('skills', filteredSkills);
	}

	function doBasinnChart() {
		postEvent('doBasinnChart', {});
		const currentChartMode = mode === Mode.UniquesChart ? Mode.UniquesChart : Mode.Chart;
		chartRunModeRef.current = currentChartMode;
		setLastRunChartUma(uma1);
		chartWorkersCompletedRef.current = 0;
		chartWorkersProgressRef.current.clear();
		chartWorkersInitialSkillsRef.current.clear();
		chartWorkersCompletedSetRef.current.clear();
		chartWorkerCountRef.current = workerCount;
		setIsSimulationRunning(true);
		setSimulationProgress(null);
		const params = racedefToParams(racedef, uma1.strategy);

		let skills, uma;
		if (mode === Mode.UniquesChart) {
			const uniqueSkills = getUniqueSkills();
			skills = getActivateableSkills(uniqueSkills, uma1, course, params);
			const umaWithoutUniques = removeUniqueSkills(uma1);
			uma = umaWithoutUniques.toJS();
		} else {
			skills = getActivateableSkills(baseSkillsToTest.filter(id => {
				const skillsAny: any = uma1.skills as any;
				return !(id[0] == '9' && skillsAny.includes && skillsAny.includes('1' + id.slice(1))  // reject inherited uniques if we already have the regular version
					|| id == '92111091' && skillsAny.includes && skillsAny.includes('111091')  // reject rhein kraft pink inherited unique on her (not covered by the above check since the ID is different)
				) && skillPassesIconTypeFilters(id, chartSkillIconFilters)
					&& skillPassesRarityFilters(id, chartSkillRarityFilters);
			}), uma1, course, params);

			uma = uma1.toJS();
		}

		if (skills.length === 0) {
			setIsSimulationRunning(false);
			setSimulationProgress(null);
			setChartNoMatchingSkills(true);
			setLastRunChartUma(uma1);
			if (currentChartMode === Mode.UniquesChart) {
				updateUniquesTableData('reset');
			} else {
				updateSkillTableData('reset');
			}
			setAdditionalSamplesRunCount(new Map());
			return;
		}
		setChartNoMatchingSkills(false);
		
		const filler = new Map();
		skills.forEach(id => filler.set(id, getNullRow(id)));
		
		const skillChunks = splitSkillsAcrossWorkers(skills, workerCount);
		
		if (currentChartMode === Mode.UniquesChart) {
			updateUniquesTableData('reset');
			updateUniquesTableData(filler);
		} else {
			updateSkillTableData('reset');
			updateSkillTableData(filler);
		}
		setAdditionalSamplesRunCount(new Map());
		const chartOptions = {
			seed, 
			posKeepMode, 
			pacemakerCount: posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
			chartRunSamples: [
				Math.max(1, Math.floor(chartRun1Samples || 1)),
				Math.max(1, Math.floor(chartRun2Samples || 1)),
				Math.max(1, Math.floor(chartRun3Samples || 1))
			],
			hpConsumption,
			syncRng,
			skillWisdomCheck,
			rushedKakari,
			competeFight,
			leadCompetition,
			duelingRates
		};
		
		// Send work to all active workers simultaneously
		// All postMessage calls happen synchronously, so messages are queued in each worker's message queue immediately
		activeWorkersRef.current.clear();
		for (let i = 0; i < workerCount; i++) {
			activeWorkersRef.current.add(i);
			workers[i].postMessage({
				msg: 'chart', 
				data: {
					skills: skillChunks[i], course, racedef: params, uma, pacer: pacer.toJS(), options: chartOptions
				}
			});
		}
	}

	const activeTableData =
		mode == Mode.GlobalSkillChart
			? globalTableData
			: mode == Mode.UniquesChart
				? uniquesTableData
				: skillTableData;
	const activeTableRows = useMemo(() => Array.from(activeTableData.values()), [activeTableData]);
	const showOwnedChartSkills = mode == Mode.Chart || mode == Mode.GlobalSkillChart;
	const chartOwnedSkills = useMemo(
		() => showOwnedChartSkills ? new Set(Array.from(uma1.skills.values())) : new Set(),
		[showOwnedChartSkills, uma1.skills]
	);
	const [selectedSkillId, setSelectedSkillId] = useState('');
	const [selectedUniquesSkillId, setSelectedUniquesSkillId] = useState('');
	const [selectedGlobalSkillId, setSelectedGlobalSkillId] = useState('');
	const activeSelectedSkillId =
		mode == Mode.GlobalSkillChart
			? selectedGlobalSkillId
			: mode == Mode.UniquesChart
				? selectedUniquesSkillId
				: selectedSkillId;
	useEffect(() => {
		selectedSkillIdRef.current = selectedSkillId;
	}, [selectedSkillId]);
	useEffect(() => {
		selectedUniquesSkillIdRef.current = selectedUniquesSkillId;
	}, [selectedUniquesSkillId]);
	useEffect(() => {
		selectedGlobalSkillIdRef.current = selectedGlobalSkillId;
	}, [selectedGlobalSkillId]);

	function basinnChartSelection(skillId, selectedDisplay?: string) {
		const r = activeTableData.get(skillId);
		if (r) {
			if (r.runData != null) {
				setResults(selectedDisplay ? {...r, displaying: selectedDisplay} : r);
			}
			if (mode == Mode.GlobalSkillChart) {
				setSelectedGlobalSkillId(skillId);
			} else if (mode == Mode.UniquesChart) {
				setSelectedUniquesSkillId(skillId);
			} else {
				setSelectedSkillId(skillId);
			}
		} else {
			if (mode == Mode.GlobalSkillChart) {
				setSelectedGlobalSkillId('');
			} else if (mode == Mode.UniquesChart) {
				setSelectedUniquesSkillId('');
			} else {
				setSelectedSkillId('');
			}
		}
		// Let the inspector selection commit before removing an open icon tooltip.
		setTimeout(() => setPopoverSkill(''), 0);
	}

	function runAdditionalSamplesForSkill(skillId: string) {
		const normalizedSkillId = String(skillId);
		if (loadingAdditionalSamples.has(normalizedSkillId) || isSimulationRunning) return;
		const targetMode = mode == Mode.GlobalSkillChart
			? Mode.GlobalSkillChart
			: mode == Mode.UniquesChart
				? Mode.UniquesChart
				: Mode.Chart;
		
		setLoadingAdditionalSamples(prev => new Set(prev).add(normalizedSkillId));
		setAdditionalSamplesProgress({skillId: normalizedSkillId, completed: 0, total: 500});
		const existingResult = targetMode == Mode.GlobalSkillChart
			? globalTableDataRef.current.get(normalizedSkillId)
			: targetMode == Mode.UniquesChart
				? uniquesTableDataRef.current.get(normalizedSkillId)
				: skillTableDataRef.current.get(normalizedSkillId);
		if (existingResult) {
			additionalSamplesBaseResultsRef.current.set(normalizedSkillId, existingResult);
		}
		additionalSamplesTargetsRef.current.set(normalizedSkillId, targetMode);
		
		const currentRunCount = additionalSamplesRunCount.get(skillId) || 0;
		const effectiveSeed = seed + currentRunCount + 1;
		setAdditionalSamplesRunCount(prev => {
			const next = new Map(prev);
			next.set(skillId, currentRunCount + 1);
			return next;
		});
		
		const params = racedefToParams(racedef, uma1.strategy);
		let uma;
		if (mode === Mode.UniquesChart) {
			const umaWithoutUniques = removeUniqueSkills(uma1);
			uma = umaWithoutUniques.toJS();
		} else {
			uma = uma1.toJS();
		}
		
		workers[0].postMessage({
			msg: 'additional-samples',
			data: {
				skillId: normalizedSkillId,
				nsamples: 500,
				course,
				racedef: params,
				uma,
				pacer: pacer.toJS(),
				options: {
					seed: effectiveSeed,
					posKeepMode,
					pacemakerCount: posKeepMode === PosKeepMode.Virtual ? pacemakerCount : 1,
					hpConsumption,
					syncRng,
					skillWisdomCheck,
					rushedKakari,
					competeFight,
					leadCompetition,
					duelingRates
				}
			}
		});
	}

	function addSkillFromTable(skillId) {
		postEvent('addSkillFromTable', {skillId});
		setUma1(uma1.set('skills', uma1.skills.set(skillmeta[skillId].groupId, skillId)));
	}

	function showPopover(skillId) {
		postEvent('showPopover', {skillId});
		// Body click listener clears popovers; defer so icon click isn't wiped.
		setTimeout(() => setPopoverSkill(skillId), 0);
	}

	useEffect(function () {
		document.body.addEventListener('click', function () {
			setPopoverSkill('');
		});
	}, []);
	
	useEffect(function () {
		function handleClickOutside(event) {
			if (isPacemakerDropdownOpen && !event.target.closest('.pacemaker-combobox')) {
				setIsPacemakerDropdownOpen(false);
			}
		}
		
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [isPacemakerDropdownOpen]);

	useEffect(function () {
		if (activeSelectedSkillId && activeTableData.has(activeSelectedSkillId)) {
			const r = activeTableData.get(activeSelectedSkillId);
			if (r && r.runData != null) {
				setResults(r);
			}
		}
	}, [activeTableData, activeSelectedSkillId]);

	function rtMouseMove(pos) {
		if (chartData == null) return;
		document.getElementById('rtMouseOverBox').style.display = 'block';
		const x = pos * course.distance;
		const i0 = binSearch(chartData.p[0], x), i1 = binSearch(chartData.p[1], x);

		
		// Ensure indices are within bounds
		const safeI0 = Math.max(0, Math.min(i0, chartData.v[0].length - 1));
		const safeI1 = Math.max(0, Math.min(i1, chartData.v[1].length - 1));
		
		const hp0 = chartData.hp && chartData.hp[0] && safeI0 < chartData.hp[0].length ? chartData.hp[0][safeI0].toFixed(0) : 'N/A';
		const hp1 = chartData.hp && chartData.hp[1] && safeI1 < chartData.hp[1].length ? chartData.hp[1][safeI1].toFixed(0) : 'N/A';
		
		document.getElementById('rtV1').textContent = `${chartData.v[0][safeI0].toFixed(2)} m/s  t=${chartData.t[0][safeI0].toFixed(2)} s  (${hp0} hp remaining)`;
		document.getElementById('rtV2').textContent = `${chartData.v[1][safeI1].toFixed(2)} m/s  t=${chartData.t[1][safeI1].toFixed(2)} s  (${hp1} hp remaining)`;
	}

	function rtMouseLeave() {
		document.getElementById('rtMouseOverBox').style.display = 'none';
	}

	function handleSkillDrag(skillId, umaIndex, newStart, newEnd){		
		// Update the forced skill position for the appropriate horse
		if (umaIndex === 0) {
			setUma1(uma1.set('forcedSkillPositions', uma1.forcedSkillPositions.set(skillId, newStart)));
		} else if (umaIndex === 1) {
			setUma2(uma2.set('forcedSkillPositions', uma2.forcedSkillPositions.set(skillId, newStart)));
		} else if (umaIndex === 2) {
			setPacer(pacer.set('forcedSkillPositions', pacer.forcedSkillPositions.set(skillId, newStart)));
		}
	}

	const mid = Math.floor(results.length / 2);
	const median = results.length % 2 == 0 ? (results[mid-1] + results[mid]) / 2 : results[mid];
	const mean = results.reduce((a,b) => a+b, 0) / results.length;

	const colors = [
		{stroke: 'rgb(42, 119, 197)', fill: 'rgba(42, 119, 197, 0.7)'},
		{stroke: 'rgb(197, 42, 42)', fill: 'rgba(197, 42, 42, 0.7)'}
	];
	const skillActivations = (() => {
		if (chartData == null) return [];
		const out: any[] = [];
		const skArr: any[] = (chartData.sk as any[]) || [];
		for (let i = 0; i < skArr.length; i++) {
			const a = skArr[i];
			if (!a) continue;
			const keys = Array.from(a.keys());
			for (let k = 0; k < keys.length; k++) {
				const id = keys[k] as any;
				if (NO_SHOW.indexOf((skillmeta as any)[id].iconId) > -1) continue;
				const ars = a.get(id) || [];
				for (let j = 0; j < ars.length; j++) {
					const ar = ars[j];
					out.push({
						type: RegionDisplayType.Textbox,
						color: colors[i],
						text: skillnames[id][0],
						skillId: id,
						umaIndex: i,
						regions: [{start: ar[0], end: ar[1] != -1 ? ar[1] : ar[0] + 100}]
					});
				}
			}
		}
		return out;
	})();
	
	const rushedColors = [
		{stroke: 'rgb(42, 119, 197)', fill: 'rgba(42, 119, 197, 0.8)'},  // Blue for Uma 1
		{stroke: 'rgb(197, 42, 42)', fill: 'rgba(197, 42, 42, 0.8)'}     // Red for Uma 2
	];
	const rushedIndicators = chartData == null ? [] : (chartData.rushed || [[], []]).flatMap((rushArray,i) => {
		return rushArray.map(ar => ({
			type: RegionDisplayType.Textbox,
			color: rushedColors[i],
			text: 'Rushed',
			regions: [{start: ar[0], end: ar[1]}]
		}));
	});

	const posKeepColors = [
		{stroke: 'rgb(42, 119, 197)', fill: 'rgba(42, 119, 197, 0.6)'},
		{stroke: 'rgb(197, 42, 42)', fill: 'rgba(197, 42, 42, 0.6)'}
	];
	
	const posKeepData = chartData == null ? [] : (chartData.posKeep || [[], []]).flatMap((posKeepArray,i) => {
		return posKeepArray.map(ar => {
			const stateName = ar[2] === 1 ? 'PU' : ar[2] === 2 ? 'PDM' : ar[2] === 3 ? 'SU' : ar[2] === 4 ? 'O' : 'Unknown';
			return {
				umaIndex: i,
				text: stateName,
				color: posKeepColors[i],
				start: ar[0],
				end: ar[1],
				duration: ar[1] - ar[0]
			};
		});
	});
	
	const virtualPacemakerPosKeepData = showVirtualPacemakerOnGraph && posKeepMode === PosKeepMode.Virtual && chartData && chartData.pacerPosKeep ? 
		(() => {
			const pacemakerPosKeepData = [];
			const pacemakerColors = [
				{stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.6)'},   // Green
				{stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.6)'},  // Purple  
				{stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.6)'}   // Pink
			];
			
			for (let pacemakerIndex = 0; pacemakerIndex < 3; pacemakerIndex++) {
				if (selectedPacemakerIndices.includes(pacemakerIndex) && 
					chartData.pacerPosKeep && chartData.pacerPosKeep[pacemakerIndex]) {
					const pacerPosKeepArray = chartData.pacerPosKeep[pacemakerIndex];
					pacerPosKeepArray.forEach(ar => {
						const stateName = ar[2] === 1 ? 'PU' : ar[2] === 2 ? 'PDM' : ar[2] === 3 ? 'SU' : ar[2] === 4 ? 'O' : 'Unknown';
						pacemakerPosKeepData.push({
							umaIndex: 2 + pacemakerIndex,
							text: stateName,
							color: pacemakerColors[pacemakerIndex],
							start: ar[0],
							end: ar[1],
							duration: ar[1] - ar[0]
						});
					});
				}
			}
			return pacemakerPosKeepData;
		})() : [];
	
	const competeFightData = chartData == null ? [] : (chartData.competeFight || [[], []]).flatMap((competeFightArray, i) => {
		if (!competeFightArray || competeFightArray.length === 0) return [];
		const start = competeFightArray[0];
		const end = competeFightArray[1];
		return [{
			umaIndex: i,
			text: 'Duel',
			color: posKeepColors[i],
			start: start,
			end: end,
			duration: end - start
		}];
	});
	
	const leadCompetitionData = chartData == null ? [] : (chartData.leadCompetition || [[], []]).flatMap((leadCompetitionArray, i) => {
		if (!leadCompetitionArray || leadCompetitionArray.length === 0) return [];
		const start = leadCompetitionArray[0];
		const end = leadCompetitionArray[1];
		return [{
			umaIndex: i,
			text: 'SS',
			color: posKeepColors[i],
			start: start,
			end: end,
			duration: end - start
		}];
	});
	
	const virtualPacemakerLeadCompetitionData = showVirtualPacemakerOnGraph && posKeepMode === PosKeepMode.Virtual && chartData && chartData.pacerLeadCompetition ? 
		(() => {
			const pacemakerLeadCompetitionData = [];
			const pacemakerColors = [
				{stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.6)'},
				{stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.6)'},
				{stroke: '#ec4899', fill: 'rgba(236, 72, 153, 0.6)'}
			];
			
			for (let pacemakerIndex = 0; pacemakerIndex < 3; pacemakerIndex++) {
				if (selectedPacemakerIndices.includes(pacemakerIndex) && 
					chartData.pacerLeadCompetition && chartData.pacerLeadCompetition[pacemakerIndex] && chartData.pacerLeadCompetition[pacemakerIndex].length > 0) {
					const leadCompetitionArray = chartData.pacerLeadCompetition[pacemakerIndex];
					const start = leadCompetitionArray[0];
					const end = leadCompetitionArray[1];
					pacemakerLeadCompetitionData.push({
						umaIndex: 2 + pacemakerIndex,
						text: 'SS',
						color: pacemakerColors[pacemakerIndex],
						start: start,
						end: end,
						duration: end - start
					});
				}
			}
			return pacemakerLeadCompetitionData;
		})() : [];
	
	const downhillData = chartData == null ? [] : (chartData.downhillActivations || [[], []]).flatMap((downhillArray,i) => {
		return downhillArray.map(ar => ({
			umaIndex: i,
			text: 'DH',
			color: posKeepColors[i],
			start: ar[0],
			end: ar[1],
			duration: ar[1] - ar[0]
		}));
	});
	
	const posKeepLabels = [];
	
	const courseDistanceForLabels = mode == Mode.GlobalCompare ? 1600 : course.distance;
	const raceConditionContext = useMemo(() => {
		if (mode == Mode.GlobalCompare || mode == Mode.GlobalSkillChart) {
			return {
				distanceType: globalCompareDistance,
				surface: globalCompareTerrain
			};
		}
		return {
			distance: course.distance,
			distanceType: course.distanceType,
			surface: course.surface,
			turn: course.turn,
			trackId: course.raceTrackId,
			weather: racedef.weather,
			season: racedef.season,
			time: racedef.time,
			groundCondition: racedef.ground,
			grade: racedef.grade,
			hasCorners: course.corners.length > 0,
			hasUphill: course.slopes.some(s => s.slope > 0),
			hasDownhill: course.slopes.some(s => s.slope < 0)
		};
	}, [mode, course, racedef, globalCompareDistance, globalCompareTerrain]);
	const tempLabels = [...posKeepData, ...virtualPacemakerPosKeepData, ...competeFightData, ...leadCompetitionData, ...virtualPacemakerLeadCompetitionData, ...downhillData].map(posKeep => ({
		...posKeep,
		x: posKeep.start / courseDistanceForLabels * trackWidth,
		width: posKeep.duration / courseDistanceForLabels * trackWidth,
		yOffset: 0
	}));
	
	tempLabels.sort((a, b) => a.x - b.x);
	
	for (let i = 0; i < tempLabels.length; i++) {
		const currentLabel = tempLabels[i];
		let maxYOffset = 40;
		
		for (let j = 0; j < i; j++) {
			const prevLabel = tempLabels[j];
			
			// Check if labels overlap horizontally
			const padding = 0; // Add padding to prevent labels from being too close
			const overlap = !(currentLabel.x + currentLabel.width + padding < prevLabel.x || 
							 currentLabel.x > prevLabel.x + prevLabel.width + padding);
			
			if (overlap) {
				// Labels overlap, need to offset vertically
				maxYOffset = Math.max(maxYOffset, prevLabel.yOffset + 15);
			}
		}
		
		currentLabel.yOffset = maxYOffset;
		posKeepLabels.push(currentLabel);
	}
	

	const umaTabs = (
		<Fragment>
			<div class={`umaTab umaTabStart ${currentIdx == 0 ? 'selected' : ''}`} onClick={() => updateUiState(UiStateMsg.SetCurrentIdx0)}>
				{mode == Mode.Compare || mode == Mode.GlobalCompare
					? 'Uma Musume 1'
					: mode == Mode.RaceOptimizer
					? 'Reference Uma'
					: 'Uma Musume'}
			</div>
			{(mode == Mode.Compare || mode == Mode.GlobalCompare) && (
				<div
					id="copyUmaButtons"
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<div id="copyUmaToRight" title="Copy Uma Musume 1 → 2" onClick={copyUmaToRight} />
					<div id="swapUmas" title="Swap umas" onClick={swapUmas}>⇄</div>
					<div id="copyUmaToLeft" title="Copy Uma Musume 2 → 1" onClick={copyUmaToLeft} />
				</div>
			)}
			{(mode == Mode.Compare || mode == Mode.GlobalCompare) && (
				<div class={`umaTab umaTabEnd ${currentIdx == 1 ? 'selected' : ''}`} onClick={() => updateUiState(UiStateMsg.SetCurrentIdx1)}>Uma Musume 2</div>
			)}
			{posKeepMode == PosKeepMode.Virtual && (mode == Mode.Compare || mode == Mode.GlobalCompare) && (
				<div class={`umaTab pacerTab ${currentIdx == 2 ? 'selected' : ''}`} onClick={() => updateUiState(UiStateMsg.SetCurrentIdx2)}>Virtual Pacemaker</div>
			)}
		</Fragment>
	);

	const createExpandedContent = useCallback((skillId: string, runData: any, courseDistance: number) => {
		const currentDisplaying = displaying || 'meanrun';
		let effectivenessRate = 0;
		const totalCount = runData?.allruns?.totalRuns || 0;
		let skillProcs = 0;
		if (runData?.allruns?.skBasinn && Array.isArray(runData.allruns.skBasinn)) {
			const allBasinnActivations: Array<[number, number]> = [];
			runData.allruns.skBasinn.forEach((skBasinnMap: any) => {
				if (!skBasinnMap) return;
				let activations = null;
				if (skBasinnMap instanceof Map || (typeof skBasinnMap.has === 'function' && typeof skBasinnMap.get === 'function')) {
					if (skBasinnMap.has(skillId)) {
						activations = skBasinnMap.get(skillId);
					}
				} else if (typeof skBasinnMap === 'object' && skillId in skBasinnMap) {
					activations = skBasinnMap[skillId];
				}
				if (activations && Array.isArray(activations)) {
					activations.forEach((activation: any) => {
						if (Array.isArray(activation) && activation.length === 2 && 
						    typeof activation[0] === 'number' && typeof activation[1] === 'number') {
							allBasinnActivations.push([activation[0], activation[1]]);
						}
					});
				}
			});
			skillProcs = allBasinnActivations.length;
			const positiveCount = allBasinnActivations.filter(([_, basinn]) => basinn > 0).length;
			effectivenessRate = totalCount > 0 ? (positiveCount / totalCount) * 100 : 0;
		}
		
		return (
			<div class="skillChartExpandedResult">
				<div class="skillChartExpandedSummary">
					<div class="skillChartExpandedSamples">
						<div class="skillChartExpandedSamplesText">
							<span class="skillDetailsLabel">Total samples</span>
							<span class="skillChartExpandedSampleValue">{totalCount} ({skillProcs} activations)</span>
						</div>
						<button 
							class="runAdditionalSamples"
							onClick={(e) => { e.stopPropagation(); runAdditionalSamplesForSkill(skillId); }}
							disabled={loadingAdditionalSamples.has(skillId) || isSimulationRunning}
						>
							{loadingAdditionalSamples.has(skillId) ? 'Running...' : isSimulationRunning ? 'Simulation Running...' : 'Run Additional Samples'}
						</button>
					</div>
					<div class="skillChartEffectivenessLabel">
						<span class="skillDetailsLabel">Effectiveness rate</span>
						<strong>{effectivenessRate.toFixed(1)}%</strong>
					</div>
					<div class="effectivenessBar">
						<div style={`width: ${effectivenessRate}%;`}></div>
						<div style={`width: ${100 - effectivenessRate}%;`}></div>
					</div>
				</div>
				<SkillChartSidePlots
					skillId={skillId}
					runData={runData}
					courseDistance={courseDistance}
					displaying={currentDisplaying}
				/>
			</div>
		);
	}, [displaying, loadingAdditionalSamples, isSimulationRunning, runAdditionalSamplesForSkill]);

	const createGlobalResultsContent = (
		uma1Label: string,
		uma2Label: string,
		helpText: ComponentChildren,
		selectedRaceParams: RaceContextData | null
	) => (
		<>
			<ResultsSummaryTable
				displaying={displaying}
				onSelect={setChartData}
				values={{min: results[0], max: results[results.length-1], mean, median}}
			/>
			<div id="resultsHelp">{helpText}</div>
			<div class="resultsFlow globalResultsFlow">
				<UmaOutcomePanel cls="uma1" label={uma1Label} stamina={staminaStats && staminaStats.uma1} skillStats={skillActivationStats && skillActivationStats.uma1} displaying={displaying} chartData={chartData} idx={0} />
				<HistogramResultCard part="chart" data={results} leftLabel={uma1Label} rightLabel={uma2Label} />
				<UmaOutcomePanel cls="uma2" label={uma2Label} stamina={staminaStats && staminaStats.uma2} skillStats={skillActivationStats && skillActivationStats.uma2} displaying={displaying} chartData={chartData} idx={1} />
				<RaceContextResults raceParams={selectedRaceParams} />
				<UmaResultCard cls="uma1" label={uma1Label} rateLabel="Final leg 1st place" first={firstUmaStats && firstUmaStats.uma1} stamina={staminaStats && staminaStats.uma1}>
					<ResultsTable chartData={chartData} idx={0} runData={runData} displaying={displaying} courseDistance={course.distance} rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma1} stamina={staminaStats && staminaStats.uma1} skillStats={skillActivationStats && skillActivationStats.uma1} />
				</UmaResultCard>
				<UmaResultCard cls="uma2" label={uma2Label} rateLabel="Final leg 1st place" first={firstUmaStats && firstUmaStats.uma2} stamina={staminaStats && staminaStats.uma2}>
					<ResultsTable chartData={chartData} idx={1} runData={runData} displaying={displaying} courseDistance={course.distance} rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma2} stamina={staminaStats && staminaStats.uma2} skillStats={skillActivationStats && skillActivationStats.uma2} />
				</UmaResultCard>
			</div>
		</>
	);

	let resultsPane;
	if ((mode == Mode.Compare || mode == Mode.GlobalCompare) && results.length > 0) {
		resultsPane = (
			mode == Mode.GlobalCompare ? (
				<div id="globalCompareWrapper">
					<div id="resultsPane" class="mode-compare global-compare-mode">
						{createGlobalResultsContent(
							'Uma Musume 1',
							'Uma Musume 2',
							<>Negative numbers mean <strong style="color:var(--uma1-color)">Uma Musume 1</strong> is faster, positive numbers mean <strong style="color:var(--uma2-color)">Uma Musume 2</strong> is faster.</>,
							raceParams
						)}
					</div>
				</div>
			) : (
				<div id="resultsPaneWrapper">
					<div id="resultsPane" class="mode-compare" key="compare-results">
						<ResultsSummaryTable
							displaying={displaying}
							onSelect={setChartData}
							values={{min: results[0], max: results[results.length-1], mean, median}}
						/>
						<div id="resultsHelp">Negative numbers mean <strong style="color:var(--uma1-color)">Uma Musume 1</strong> is faster, positive numbers mean <strong style="color:var(--uma2-color)">Uma Musume 2</strong> is faster.</div>
						<div class="resultsFlow">
							<UmaOutcomePanel cls="uma1" label="Uma Musume 1" stamina={staminaStats && staminaStats.uma1} skillStats={skillActivationStats && skillActivationStats.uma1} displaying={displaying} chartData={chartData} idx={0} />
							<HistogramResultCard part="chart" data={results} />
							<UmaOutcomePanel cls="uma2" label="Uma Musume 2" stamina={staminaStats && staminaStats.uma2} skillStats={skillActivationStats && skillActivationStats.uma2} displaying={displaying} chartData={chartData} idx={1} />
							<UmaResultCard cls="uma1" label="Uma Musume 1" rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma1} stamina={staminaStats && staminaStats.uma1}>
								<ResultsTable chartData={chartData} idx={0} runData={runData} displaying={displaying} courseDistance={course.distance} rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma1} stamina={staminaStats && staminaStats.uma1} skillStats={skillActivationStats && skillActivationStats.uma1} />
							</UmaResultCard>
							<UmaResultCard cls="uma2" label="Uma Musume 2" rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma2} stamina={staminaStats && staminaStats.uma2}>
								<ResultsTable chartData={chartData} idx={1} runData={runData} displaying={displaying} courseDistance={course.distance} rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma2} stamina={staminaStats && staminaStats.uma2} skillStats={skillActivationStats && skillActivationStats.uma2} />
							</UmaResultCard>
						</div>
					</div>
				</div>
		)
		);
	} else if (mode == Mode.RaceOptimizer && optimizerIterations.length > 0) {
		// Use latest iteration (includes best-so-far fields)
		const lastIter = optimizerIterations[optimizerIterations.length - 1];
		const finalOverride = optimizerFinalCumulative ? optimizerFinalCumulative : null;
		const diffs = finalOverride?.diffs || lastIter.diffs || [];
		const marginStats = finalOverride?.marginStats || lastIter.marginStats || {min: 0, max: 0, mean: 0, median: 0};
		const bestStats = lastIter.bestSoFarStats || lastIter.stats;
		const displayStats = optimizerPhase === 'iter'
			? lastIter.stats
			: !isSimulationRunning && optimizerResult?.finalStats
			? optimizerResult.finalStats
			: bestStats;
		const bestCareerRating = lastIter.bestSoFarCareerRating;
		const displayCareerRating = optimizerPhase === 'iter'
			? lastIter.careerRating
			: !isSimulationRunning && optimizerResult?.finalCareerRating != null
			? optimizerResult.finalCareerRating
			: bestCareerRating;

		// Clicking min/max/mean/median switches which representative run is displayed on the track.
		const setOptimizerChart = (which: 'minrun' | 'maxrun' | 'meanrun' | 'medianrun') => {
			setOptimizerDisplaying(which);
			if (optimizerRunData && optimizerRunData[which]) {
				setOptimizerChartData(optimizerRunData[which]);
			}
		};

		resultsPane = (
			<div id="resultsPaneWrapper" class="optimizerResultsWorkspace">
				<OptimizerStatsBar
					stats={displayStats}
					careerRating={displayCareerRating}
					isOptimal={!isSimulationRunning && !!optimizerResult?.finalStats}
					onLoadToUma1={loadOptimizedIntoUma1}
				/>
				<div id="resultsPane" class="mode-compare mode-optimizer" key="optimizer-results">
					<ResultsSummaryTable
						displaying={optimizerDisplaying}
						onSelect={setOptimizerChart}
						values={{min: marginStats.min, max: marginStats.max, mean: marginStats.mean, median: marginStats.median}}
					/>
					<div id="resultsHelp">
						Negative numbers mean <strong style="color:var(--uma1-color)">the Optimized Uma Musume</strong> is faster, positive numbers mean the <strong style="color:var(--uma2-color)">Reference Uma</strong> is faster.
					</div>
					<div class="resultsFlow optimizerResultsFlow">
						<UmaOutcomePanel
							cls="uma1"
							label="Optimized Uma Musume"
							stamina={optimizerRunData?.__staminaStats?.uma1}
							displaying={optimizerDisplaying}
							chartData={optimizerChartData}
							idx={0}
							hideSkillHighlights
						/>
						<HistogramResultCard part="chart" data={diffs} leftLabel="Optimized" rightLabel="Reference" />
						<UmaResultCard
							cls="uma1"
							label="Optimized Uma Musume"
							rateLabel="In Lead @ Final Leg"
							first={optimizerRunData?.__firstUmaStats?.uma1}
							stamina={optimizerRunData?.__staminaStats?.uma1}
						>
							<ResultsTable
								chartData={optimizerChartData}
								idx={0}
								runData={optimizerRunData}
								displaying={optimizerDisplaying}
								courseDistance={course.distance}
								rateLabel="In Lead @ Final Leg"
								first={optimizerRunData?.__firstUmaStats?.uma1}
								stamina={optimizerRunData?.__staminaStats?.uma1}
								umaLabel="Optimized Uma Musume"
								hideSkillActivations
							/>
						</UmaResultCard>
					</div>
				</div>
				<div class="optimizerGraphsWrapper">
					<OptimizerGraphs iterations={optimizerIterations} width={420} />
				</div>
			</div>
		);
	} else if (mode == Mode.RaceOptimizer) {
		resultsPane = null;
	} else if (
		mode == Mode.GlobalSkillChart ||
		((mode == Mode.Chart || mode == Mode.UniquesChart) && (activeTableData.size > 0 || chartNoMatchingSkills))
	) {
		const dirty = mode == Mode.GlobalSkillChart
			? (hasGlobalSkillChartRun && !uma1.equals(lastRunChartUma))
			: !uma1.equals(lastRunChartUma);
		resultsPane = (
			<div id="resultsPaneWrapper">
				<div
					id="resultsPane"
					class={`mode-chart${mode == Mode.GlobalSkillChart && selectedGlobalSkillId && results.length > 0 ? ' globalSkillChartHasInspection' : ''}`}
					style={mode == Mode.GlobalSkillChart ? {marginTop: '0'} : undefined}
				>
					{mode == Mode.GlobalSkillChart && (
						<div class="globalSkillControls">
							<div class={`globalSkillFilterRow${globalSkillChartSimulateAll ? '' : ' globalSkillFilterRow--inactive'}`}>
								<div
									class={`skill skill-unique globalSkillModeToggle${globalSkillChartSimulateAll ? '' : ' globalSkillModeToggle--inactive'}`}
									onClick={() => setGlobalSkillChartSimulateAll(true)}
									title="Simulate all skills matching the current filters"
								>
									<span class="skillName">Simulate All Filtered Skills</span>
								</div>
								<span class="skillChartIconFilterLabel">Filter</span>
								<div class="skillChartFilterIcons">
									<SkillIconTypeFilter
										value={chartSkillIconFilters}
										onChange={setChartSkillIconFilters}
										class="skillChartIconFilter"
										soloWhenMatches={chartSkillIconFilterDefault}
										emptyFallback={chartSkillIconFilterDefault}
									/>
								</div>
								<div class="skillChartFilterTrail">
									<button
										type="button"
										class="filterResetButton app-pill"
										onClick={resetChartSkillFilters}
										title="Reset skill filters to defaults"
									>
										Reset
									</button>
									<SkillRarityFilter
										value={chartSkillRarityFilters}
										onChange={setChartSkillRarityFilters}
										class="skillChartRarityFilter"
										filters={['inherit', 'gold', 'white']}
										soloWhenMatches={chartSkillRarityFilterDefault}
									/>
								</div>
							</div>
							<div class="globalSkillAlternateRow">
								<span class="globalSkillOr">or</span>
								<div
									class={`skill skill-gold globalSkillModeToggle${!globalSkillChartSimulateAll ? '' : ' globalSkillModeToggle--inactive'}`}
									onClick={() => setGlobalSkillChartSimulateAll(false)}
									title="Simulate specific selected skills"
								>
									<span class="skillName">Select Specific Skills</span>
								</div>
								{!globalSkillChartSimulateAll && globalSpecificSkillIds.length > 0 && (
									<button
										type="button"
										class="filterResetButton app-pill"
										onClick={clearGlobalSpecificSkills}
										title="Remove all selected skills"
									>
										Remove All
									</button>
								)}
							</div>
							{(globalSpecificSkillIds.length > 0 || !globalSkillChartSimulateAll) && (
								<GlobalSkillSelectionGrid
									skillIds={globalSpecificSkillIds}
									previewMode={globalSkillChartSimulateAll}
									onRemove={removeGlobalSpecificSkill}
									onAdd={() => setSkillsOpen(true)}
								/>
							)}
						</div>
					)}
					<div class="skillChartSplit">
						<div class="basinnChartWrapperWrapper">
							{chartNoMatchingSkills && mode == Mode.Chart ? (
								<div class="basinnChartEmptyFilter">
									<em>No skills apply with current filter.</em>
								</div>
							) : (
								<>
									<BasinnChart 
										data={activeTableRows}
										dirty={dirty}
										ownedSkills={chartOwnedSkills}
										selectedSkillId={activeSelectedSkillId || ''}
										onSelectionChange={basinnChartSelection}
										onRunTypeChange={setChartData}
										onDblClickRow={addSkillFromTable}
										onInfoClick={showPopover}
										showUmaIcons={mode == Mode.UniquesChart}
										courseDistance={course.distance}
										centerSelectionWhenHidden={mode == Mode.GlobalSkillChart}
										wideSkillColumn={mode == Mode.Chart || mode == Mode.GlobalSkillChart || mode == Mode.UniquesChart}
									/>
									<div class={`basinnChartRefreshNotice${dirty ? '' : ' hidden'}`}>
										<div class="basinnChartRefreshText">Uma characteristics have changed. Data may be outdated.</div>
										<button class="basinnChartRefresh" onClick={mode == Mode.GlobalSkillChart ? doGlobalSkillChart : doBasinnChart} disabled={isSimulationRunning || loadingAdditionalSamples.size > 0}>⟲</button>
									</div>
								</>
							)}
						</div>
						<aside class={`skillChartSidePanel${activeSelectedSkillId ? ' has-selection' : ''}`}>
							{!chartNoMatchingSkills && activeSelectedSkillId && activeTableData.has(activeSelectedSkillId) ? (
								<>
									<div class="skillChartSideHeader">
										<img src={umaToolsAsset(`icons/${(skillmeta as any)[activeSelectedSkillId].iconId}.png`)} />
										<strong><Text id={`skillnames.${activeSelectedSkillId}`} /></strong>
										<button type="button" title="Clear selection" onClick={() => basinnChartSelection('')}>✕</button>
									</div>
									<div class="skillChartSideContent">
										{mode == Mode.GlobalSkillChart
											? (
												<div class="globalSkillInspectorResults">
													<HistogramResultCard compact part="chart" data={results} leftLabel="Baseline" rightLabel="Selected Skill" />
													<GlobalSkillHighlightComparison staminaStats={staminaStats} chartData={chartData} />
												</div>
											)
											: createExpandedContent(
												activeSelectedSkillId,
												activeTableData.get(activeSelectedSkillId).runData,
												course.distance
											)}
									</div>
								</>
							) : (
								<div class="skillChartSideEmpty">
									<span>↖</span>
									<strong>Skill Inspector</strong>
									<p>Select a skill in the table</p>
								</div>
							)}
						</aside>
					</div>
					{mode == Mode.GlobalSkillChart && skillsOpen && (
						<>
							<div class={`horseSkillPickerOverlay open`} onClick={setSkillsOpen.bind(null, false)} />
							<div class={`horseSkillPickerWrapper open`}>
								<SkillList
									ids={baseSkillsToTest}
									selected={globalSkillChartSelectedSkills}
									setSelected={(skills) => {
										setGlobalSkillChartSelectedSkills(skills);
										setSkillsOpen(false);
									}}
									allowRelatedSkillCoexistence={true}
									showAddAllVisible={true}
									isOpen={skillsOpen}
								/>
							</div>
						</>
					)}
				</div>
				{mode == Mode.GlobalSkillChart && selectedGlobalSkillId && results.length > 0 && (
					<section class="globalSkillInspection">
						<div class="globalSkillInspectionResults mode-compare global-compare-mode">
							<div class="resultsFlow globalResultsFlow globalSkillResultsFlow">
								<RaceContextResults raceParams={globalTableData.get(selectedGlobalSkillId)?.raceParams || raceParams} />
								<UmaResultCard cls="uma1" label="Baseline">
									<ResultsTable chartData={chartData} idx={0} runData={runData} displaying={displaying} courseDistance={course.distance} rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma1} stamina={staminaStats && staminaStats.uma1} skillStats={skillActivationStats && skillActivationStats.uma1} umaLabel="Baseline" hideSkillActivations />
								</UmaResultCard>
								<UmaResultCard cls="uma2" label="With Selected Skill">
									<ResultsTable chartData={chartData} idx={1} runData={runData} displaying={displaying} courseDistance={course.distance} rateLabel="In Lead @ Final Leg" first={firstUmaStats && firstUmaStats.uma2} stamina={staminaStats && staminaStats.uma2} skillStats={skillActivationStats && skillActivationStats.uma2} umaLabel="With Selected Skill" hideSkillActivations />
								</UmaResultCard>
							</div>
						</div>
					</section>
				)}
			</div>
		);
	} else {
		resultsPane = null;
	}

	return (
		<Language.Provider value={props.lang}>
			<IntlProvider definition={strings}>
				<header id="appHeader">
					<div id="appBrand">
						<img id="appIcon" src={appIconUrl()} alt="" />
						<span id="appTitle">Umalator</span>
						{CC_GLOBAL && <span id="appBadge">Global v2.1.0</span>}
					</div>
					<nav id="modeNav" aria-label="Simulator mode">
						{MODE_ROUTES.map(route => {
							const active = !settingsOpen && mode == route.mode;
							const url = routeUrl(route.path);
							return (
								<a key={route.path} href={url} onClick={e => onRouteLinkClick(e, url)} class={`modePill ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>{route.label}</a>
							);
						})}
						<a href={routeUrl(SETTINGS_ROUTE_PATH)} onClick={e => onRouteLinkClick(e, routeUrl(SETTINGS_ROUTE_PATH))} class={`modePill ${settingsOpen ? 'active' : ''}`} aria-current={settingsOpen ? 'page' : undefined}>
							<Settings size={14} aria-hidden="true" />
							Settings
						</a>
					</nav>
				</header>
				{settingsOpen ? (
					<div id="settingsWorkspace">
						<div class="settingsWorkspaceHeader">
							<div>
								<h1>Settings</h1>
							</div>
						</div>
						<div class="settingsGrid">
							<section class="settingsCard settingsVolumeCard">
								<div class="settingsCardHeader">
									<div>
										<h2>Simulation Volume</h2>
									</div>
								</div>
								<div class="settingsFields">
									<h3 class="settingsGroupTitle">For Race Compare and Global Compare modes:</h3>
									<label class="settingsField" for="nsamples">
										<span>
											<strong>Total Samples</strong>
										</span>
										<input type="number" id="nsamples" min="1" max="10000" value={nsamples} onInput={(e) => setSamples(+e.currentTarget.value)} />
									</label>
									<h3 class="settingsGroupTitle">For Skill Chart and Uma Chart modes:</h3>
									<label class="settingsField" for="chartRun1Samples">
										<span>
											<strong class="settingsLabelWithInfo">
												Preliminary Run Samples
												<span class="settingsInfo" data-tooltip="Runs every skill, then keeps skills whose maximum result is greater than 0.1 lengths." aria-label="Runs every skill, then keeps skills whose maximum result is greater than 0.1 lengths." tabindex={0}>
													<Info size={13} />
												</span>
											</strong>
										</span>
										<input type="number" id="chartRun1Samples" min="1" max="10000" value={chartRun1Samples} onInput={(e) => setChartRun1Samples(Math.max(1, +e.currentTarget.value || 1))} />
									</label>
									<label class="settingsField" for="chartRun2Samples">
										<span>
											<strong class="settingsLabelWithInfo">
												Coarse Run Samples
												<span class="settingsInfo" data-tooltip="Runs skills that passed the Preliminary Run, then keeps skills whose observed range exceeds 0.1 lengths." aria-label="Runs skills that passed the Preliminary Run, then keeps skills whose observed range exceeds 0.1 lengths." tabindex={0}>
													<Info size={13} />
												</span>
											</strong>
										</span>
										<input type="number" id="chartRun2Samples" min="1" max="10000" value={chartRun2Samples} onInput={(e) => setChartRun2Samples(Math.max(1, +e.currentTarget.value || 1))} />
									</label>
									<label class="settingsField" for="chartRun3Samples">
										<span>
											<strong class="settingsLabelWithInfo">
												Refinement Run Samples
												<span class="settingsInfo" data-tooltip="Runs every skill that passed the Coarse Run to refine its final estimate. No further cutoff is applied." aria-label="Runs every skill that passed the Coarse Run to refine its final estimate. No further cutoff is applied." tabindex={0}>
													<Info size={13} />
												</span>
											</strong>
										</span>
										<input type="number" id="chartRun3Samples" min="1" max="10000" value={chartRun3Samples} onInput={(e) => setChartRun3Samples(Math.max(1, +e.currentTarget.value || 1))} />
									</label>
									<h3 class="settingsGroupTitle">For Global Skill Chart:</h3>
									<label class="settingsField" for="globalChartRun1SamplesPerLength">
										<span>
											<strong class="settingsLabelWithInfo">
												Preliminary Run Samples
												<span class="settingsInfo" data-tooltip="When simulating all skills, runs every skill at each eligible distance, then keeps skills whose maximum result is greater than 0.1 lengths." aria-label="When simulating all skills, runs every skill at each eligible distance, then keeps skills whose maximum result is greater than 0.1 lengths." tabindex={0}>
													<Info size={13} />
												</span>
											</strong>
										</span>
										<input type="number" id="globalChartRun1SamplesPerLength" min="1" max="10000" value={globalChartRun1SamplesPerLength} onInput={(e) => setGlobalChartRun1SamplesPerLength(Math.max(1, +e.currentTarget.value || 1))} />
									</label>
									<label class="settingsField" for="globalChartRun2Samples">
										<span>
											<strong class="settingsLabelWithInfo">
												Coarse Run Samples
												<span class="settingsInfo" data-tooltip="Runs skills that passed the Preliminary Run, then keeps skills whose observed range exceeds 0.1 lengths." aria-label="Runs skills that passed the Preliminary Run, then keeps skills whose observed range exceeds 0.1 lengths." tabindex={0}>
													<Info size={13} />
												</span>
											</strong>
										</span>
										<input type="number" id="globalChartRun2Samples" min="1" max="10000" value={globalChartRun2Samples} onInput={(e) => setGlobalChartRun2Samples(Math.max(1, +e.currentTarget.value || 1))} />
									</label>
									<label class="settingsField" for="globalChartRun3Samples">
										<span>
											<strong class="settingsLabelWithInfo">
												Refinement Run Samples
												<span class="settingsInfo" data-tooltip="Runs every skill that passed the Coarse Run to refine its final estimate. No further cutoff is applied." aria-label="Runs every skill that passed the Coarse Run to refine its final estimate. No further cutoff is applied." tabindex={0}>
													<Info size={13} />
												</span>
											</strong>
										</span>
										<input type="number" id="globalChartRun3Samples" min="1" max="10000" value={globalChartRun3Samples} onInput={(e) => setGlobalChartRun3Samples(Math.max(1, +e.currentTarget.value || 1))} />
									</label>
									<h3 class="settingsGroupTitle">For all chart modes:</h3>
									<label class="settingsField" for="workerCount">
										<span>
											<strong>Parallel Workers</strong>
										</span>
										<input type="number" id="workerCount" min="1" max="16" value={workerCount} onInput={(e) => setWorkerCount(Math.max(1, Math.min(16, +e.currentTarget.value)))} />
									</label>
								</div>
							</section>

							<section class="settingsCard settingsGeneralCard">
								<div class="settingsCardHeader">
									<div>
										<h2>General</h2>
										<p>These settings affect all modes.</p>
									</div>
								</div>
								<div class="settingsFields">
									<label class="settingsField settingsFieldStack" for="poskeepmode">
										<span>
											<strong class="settingsLabelWithInfo">
												Position Keeping
												{posKeepMode == PosKeepMode.Approximate && (
													<span class="settingsInfo" data-tooltip="Position Keep will use the default pacemaker." aria-label="Position Keep uses the default pacemaker." tabindex={0}>
														<Info size={13} />
													</span>
												)}
											</strong>
										</span>
										<select id="poskeepmode" value={posKeepMode} onInput={(e) => setPosKeepMode(+e.currentTarget.value)}>
											<option value={PosKeepMode.None}>None</option>
											<option value={PosKeepMode.Approximate}>Approximate</option>
											<option value={PosKeepMode.Virtual}>Virtual Pacemaker</option>
										</select>
									</label>
									{posKeepMode == PosKeepMode.Virtual && (
										<div class="settingsSubsection">
											<h3 class="settingsGroupTitle">Virtual Pacemaker Settings</h3>
											<div class="pacemakerSettings">
												<label class="settingsField">
													<span><strong>Show Pacemakers</strong></span>
													<div className="pacemaker-combobox settingsPacemakerControl">
														<button
															type="button"
															className="pacemaker-combobox-button"
															onClick={() => setIsPacemakerDropdownOpen(!isPacemakerDropdownOpen)}
														>
															{selectedPacemakerIndices.length === 0
																? 'None'
																: selectedPacemakerIndices.length === 1
																? `Pacemaker ${selectedPacemakerIndices[0] + 1}`
																: selectedPacemakerIndices.length === pacemakerCount
																? 'All Pacemakers'
																: `${selectedPacemakerIndices.length} Pacemakers`
															}
															<span className="pacemaker-combobox-arrow">▼</span>
														</button>
														{isPacemakerDropdownOpen && (
															<div className="pacemaker-combobox-dropdown">
																{[...Array(pacemakerCount)].map((_, index) => (
																	<label key={index} className="pacemaker-combobox-option">
																		<input type="checkbox" checked={selectedPacemakerIndices.includes(index)} onChange={() => togglePacemakerSelection(index)} />
																		<span style={{color: index === 0 ? '#22c55e' : index === 1 ? '#a855f7' : '#ec4899'}}>
																			Pacemaker {index + 1}
																		</span>
																	</label>
																))}
															</div>
														)}
													</div>
												</label>
												<label class="settingsField" for="pacemakercount">
													<span><strong>Number of Pacemakers: {pacemakerCount}</strong></span>
													<input class="settingsPacemakerControl" type="range" id="pacemakercount" min="1" max="3" value={pacemakerCount} onInput={(e) => handlePacemakerCountChange(+e.currentTarget.value)} />
												</label>
											</div>
										</div>
									)}
									<label class="settingsField" for="seed">
										<span>
											<strong>Seed</strong>
										</span>
										<div id="seedWrapper">
											<input type="number" id="seed" value={seed} onInput={(e) => { setSeed(+e.currentTarget.value); setRunOnceCounter(0); }} />
											<button type="button" title="Randomize seed" onClick={() => { setSeed(Math.floor(Math.random() * (-1 >>> 0)) >>> 0); setRunOnceCounter(0); }}>🎲</button>
										</div>
									</label>
									<div class="settingsToggleGrid">
										<label class="settingsToggle" for="hpconsumption">
											<span><strong>HP Consumption</strong></span>
											<input type="checkbox" id="hpconsumption" checked={hpConsumption} onClick={toggleHpConsumption} />
										</label>
										<label class="settingsToggle" for="showhp">
											<span><strong>Show HP</strong></span>
											<input type="checkbox" id="showhp" checked={showHp} onClick={toggleShowHp} />
										</label>
										<label class="settingsToggle" for="syncRng">
											<span><strong>Sync RNG</strong></span>
											<input type="checkbox" id="syncRng" checked={syncRng} onClick={handleSyncRngToggle} />
										</label>
										<label class="settingsToggle" for="skillWisdomCheck">
											<span><strong>Skill Wit Check</strong></span>
											<input type="checkbox" id="skillWisdomCheck" checked={skillWisdomCheck} onClick={handleSkillWisdomCheckToggle} />
										</label>
										<label class="settingsToggle" for="rushedKakari">
											<span><strong>Rushed</strong></span>
											<input type="checkbox" id="rushedKakari" checked={rushedKakari} onClick={handleRushedKakariToggle} />
										</label>
										<label class="settingsToggle" for="forceIdenticalMood">
											<span>
												<strong class="settingsLabelWithInfo">
													Force Identical Mood
													<span class="settingsInfo" data-tooltip="Only applicable when Mood is set to Random" aria-label="Only applicable when Mood is set to Random" tabindex={0}>
														<Info size={13} />
													</span>
												</strong>
											</span>
											<input type="checkbox" id="forceIdenticalMood" checked={forceIdenticalMood} onInput={(e) => setForceIdenticalMood(e.currentTarget.checked)} />
										</label>
										<label class="settingsToggle" for="leadCompetition">
											<span><strong>Spot Struggle</strong></span>
											<input type="checkbox" id="leadCompetition" checked={leadCompetition} onClick={() => setLeadCompetition(!leadCompetition)} />
										</label>
										<div class="settingsToggle">
											<label for="competeFight">
												<span><strong>Dueling</strong></span>
												<input type="checkbox" id="competeFight" checked={competeFight} onClick={() => setCompeteFight(!competeFight)} />
											</label>
											<button type="button" onClick={() => setDuelingConfigOpen(true)} class="app-btn iconBtn" title="Configure dueling rates">
												<Settings size={14} />
											</button>
										</div>
									</div>
								</div>
							</section>

							<section class="settingsCard settingsOptimizerCard">
								<div class="settingsCardHeader">
									<div>
										<h2>Optimizer Configuration</h2>
									</div>
								</div>
								<div class="settingsFields">
									{!optimizerUseReferenceInit && (
										<>
											<label class="settingsField">
												<span><strong>Initializations</strong></span>
												<input type="number" value={optimizerInitCount} onInput={(e) => setOptimizerInitCount(+e.currentTarget.value)} min="1" max="500" />
											</label>
											<label class="settingsField">
												<span><strong>Samples per Initialization</strong></span>
												<input type="number" value={optimizerInitSamples} onInput={(e) => setOptimizerInitSamples(+e.currentTarget.value)} min="1" max="500" />
											</label>
										</>
									)}
									{optimizerUseReferenceInit && <p class="settingsHint">Initialization controls are skipped while “Use Reference as Initial Condition” is enabled in Race Optimizer.</p>}
									<label class="settingsField">
										<span><strong>Number of Iterations</strong></span>
										<input type="number" value={optimizerMaxIterations} onInput={(e) => setOptimizerMaxIterations(+e.currentTarget.value)} min="1" max="200" />
									</label>
									<label class="settingsField">
										<span><strong>Samples per Iteration</strong></span>
										<input type="number" value={optimizerIterSamples} onInput={(e) => setOptimizerIterSamples(+e.currentTarget.value)} min="1" max="500" />
									</label>
									<label class="settingsField">
										<span><strong>Final Run Samples</strong></span>
										<input type="number" value={optimizerFinalRunSamples} onInput={(e) => setOptimizerFinalRunSamples(+e.currentTarget.value)} min="1" max="1000" />
									</label>
									<label class="settingsField">
										<span><strong>Evaluation Method</strong></span>
										<select value={optimizerEvaluationMethod} onInput={(e) => setOptimizerEvaluationMethod(e.currentTarget.value as 'mean' | 'median' | 'aggregate')}>
											<option value="median">Median</option>
											<option value="mean">Mean</option>
											<option value="aggregate">Aggregate</option>
										</select>
									</label>
								</div>
							</section>
						</div>
					</div>
				) : (
				<Fragment>
				<div id="mainColumn">
				<div id="topPane" class={chartData || optimizerChartData ? 'hasResults' : ''}>
					{mode != Mode.GlobalCompare && mode != Mode.GlobalSkillChart && (
						<RaceTrack courseid={courseId} width={trackWidth} height={240} xOffset={20} xExtra={30} yOffset={15} yExtra={20} mouseMove={rtMouseMove} mouseLeave={rtMouseLeave} onSkillDrag={handleSkillDrag} regions={mode == Mode.RaceOptimizer && optimizerChartData ? (() => {
							const optimizerSkillActivations = [];
							if (optimizerChartData.sk && optimizerChartData.sk[0]) {
								optimizerChartData.sk[0].forEach((ars, id) => {
									if (NO_SHOW.indexOf(skillmeta[id].iconId) > -1) return;
									ars.forEach(ar => {
										optimizerSkillActivations.push({
											type: RegionDisplayType.Textbox,
											color: {stroke: 'rgb(42, 119, 197)', fill: 'rgba(42, 119, 197, 0.7)'},
											text: skillnames[id][0],
											skillId: id,
											umaIndex: 0,
											regions: [{start: ar[0], end: ar[1] != -1 ? ar[1] : ar[0] + 100}]
										});
									});
								});
							}
							return optimizerSkillActivations;
						})() : [...skillActivations, ...rushedIndicators]} posKeepLabels={posKeepLabels} uma1={uma1} uma2={uma2} pacer={pacer}>
							<VelocityLines data={mode == Mode.RaceOptimizer ? optimizerChartData : chartData} courseDistance={course.distance} width={trackWidth} height={250} xOffset={20} showHp={showHp} showLanes={mode == Mode.Compare ? showLanes : false} horseLane={course.horseLane} showVirtualPacemaker={showVirtualPacemakerOnGraph && posKeepMode === PosKeepMode.Virtual} selectedPacemakers={getSelectedPacemakers()} />
						
						<g id="rtMouseOverBox" style="display:none">
							<text id="rtV1" x="25" y="10" fill="#6ea8fe" font-size="10px"></text>
							<text id="rtV2" x="25" y="20" fill="#ef5350" font-size="10px"></text>
							<text id="rtVp" x="25" y="30" fill="#34d27b" font-size="10px"></text>
							<text id="pd1" x="25" y="10" fill="#6ea8fe" font-size="10px"></text>
							<text id="pd2" x="25" y="20" fill="#ef5350" font-size="10px"></text>
						</g>
					</RaceTrack>
					)}
					{mode == Mode.GlobalCompare && results.length > 0 ? resultsPane : null}
					{mode == Mode.GlobalSkillChart ? resultsPane : null}
					{mode != Mode.GlobalCompare && mode != Mode.GlobalSkillChart && (
						<div id="buttonsRow">
							<TrackSelect key={courseId} courseid={courseId} setCourseid={setCourseId} tabindex={2} />
							<div id="buttonsRowSpace" />
							<div>
								<GroundSelect value={racedef.ground} set={racesetter('ground')} />
								<WeatherSelect value={racedef.weather} set={racesetter('weather')} />
							</div>
							<SeasonSelect value={racedef.season} set={racesetter('season')} />
							<TimeOfDaySelect value={racedef.time} set={racesetter('time')} />
							<div class="presetToolbar">
								<RacePresets courseId={courseId} racedef={racedef} set={(courseId, racedef) => { setCourseId(courseId); setRaceDef(racedef); }} />
								<a href="#" onClick={generatePresetEntry}>Generate and Copy Preset Entry</a>
							</div>
						</div>
					)}
					{mode == Mode.Chart && (
						<div class="skillChartIconFilterRow">
							<span class="skillChartIconFilterLabel">Filter</span>
							<div class="skillChartFilterIcons">
								<SkillIconTypeFilter
									value={chartSkillIconFilters}
									onChange={setChartSkillIconFilters}
									class="skillChartIconFilter"
									soloWhenMatches={chartSkillIconFilterDefault}
									emptyFallback={chartSkillIconFilterDefault}
								/>
							</div>
							<div class="skillChartFilterTrail">
								<button
									type="button"
									class="filterResetButton app-pill"
									onClick={resetChartSkillFilters}
									title="Reset skill filters to defaults"
								>
									Reset
								</button>
								<SkillRarityFilter
									value={chartSkillRarityFilters}
									onChange={setChartSkillRarityFilters}
									class="skillChartRarityFilter"
									filters={['inherit', 'gold', 'white']}
									soloWhenMatches={chartSkillRarityFilterDefault}
								/>
							</div>
						</div>
					)}
				</div>
				{mode != Mode.GlobalCompare && mode != Mode.GlobalSkillChart && mode != Mode.RaceOptimizer && resultsPane}
				{mode == Mode.RaceOptimizer && resultsPane}
				<footer id="appFooter">
					<div class="appFooterLinks">
						<a href="https://github.com/Andrew123Shi/Umalator/" target="_blank" rel="noopener noreferrer" class="appFooterLink">
							<span class="appFooterIcon" aria-hidden="true">
								<svg viewBox="0 0 16 16" fill="currentColor">
									<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
								</svg>
							</span>
							GitHub
						</a>
						<span class="appFooterDivider" aria-hidden="true">|</span>
						<a href="https://github.com/Andrew123Shi/Umalator/#disclaimer-and-caveats" target="_blank" rel="noopener noreferrer" class="appFooterLink">
							Disclaimer
						</a>
					</div>
					<p>This tool is not affiliated with Cygames, Inc.</p>
				</footer>
				</div>
				<div id="leftColumn">
				<div id="umaPane">
					<div class={currentIdx == 0 ? 'selected' : ''}>
						<HorseDef key={uma1.outfitId} state={uma1} setState={setUma1} courseDistance={mode == Mode.GlobalCompare ? 1600 : course.distance} raceContext={raceConditionContext} tabstart={() => 4} onResetAll={resetAllUmas} runData={(mode == Mode.Compare || mode == Mode.GlobalCompare) ? runData : null} umaIndex={(mode == Mode.Compare || mode == Mode.GlobalCompare) ? 0 : null} disableStats={false}>
							{umaTabs}
						</HorseDef>
					</div>
					{(mode == Mode.Compare || mode == Mode.GlobalCompare) && <div class={currentIdx == 1 ? 'selected' : ''}>
						<HorseDef key={uma2.outfitId} state={uma2} setState={setUma2} courseDistance={course.distance} raceContext={raceConditionContext} tabstart={() => 4 + horseDefTabs()} onResetAll={resetAllUmas} runData={runData} umaIndex={1}>
							{umaTabs}
						</HorseDef>
					</div>}
					{posKeepMode == PosKeepMode.Virtual && (mode == Mode.Compare || mode == Mode.GlobalCompare) && <div class={currentIdx == 2 ? 'selected' : ''}>
						<HorseDef key={pacer.outfitId} state={pacer} setState={setPacer} courseDistance={mode == Mode.GlobalCompare ? 1600 : course.distance} raceContext={raceConditionContext} tabstart={() => 4 + ((mode == Mode.Compare || mode == Mode.GlobalCompare) ? 2 : 1) * horseDefTabs()} onResetAll={resetAllUmas}>
							{umaTabs}
						</HorseDef>
					</div>}
				</div>
					<div id="runPane">
						{(mode == Mode.GlobalCompare || mode == Mode.GlobalSkillChart) && (
							<section class="runPaneSection runPaneFilters">
								<fieldset id="globalDistanceFieldset">
									<legend>Distance</legend>
									<GlobalFilterButtons
										id="global-distance"
										value={globalCompareDistance}
										tabindex={2}
										onChange={setGlobalCompareDistance}
										options={[
											{value: DistanceType.Short, label: 'Sprint', hint: '≤1400m', tone: 'short'},
											{value: DistanceType.Mile, label: 'Mile', hint: '1401–1800m', tone: 'mile'},
											{value: DistanceType.Mid, label: 'Medium', hint: '1801–2400m', tone: 'medium'},
											{value: DistanceType.Long, label: 'Long', hint: '≥2400m', tone: 'long'},
										]}
									/>
								</fieldset>
								<fieldset id="globalTerrainFieldset">
									<legend>Terrain</legend>
									<GlobalFilterButtons
										id="global-terrain"
										value={globalCompareTerrain}
										tabindex={3}
										onChange={setGlobalCompareTerrain}
										options={[
											{value: Surface.Turf, label: 'Turf', tone: 'turf'},
											{value: Surface.Dirt, label: 'Dirt', tone: 'dirt'},
										]}
									/>
								</fieldset>
							</section>
						)}

						{mode == Mode.RaceOptimizer && (
							<section class="runPaneSection runPaneModeConfig optimizerRunConfig">
								<fieldset id="optimizerFieldset">
									<legend>Optimization constraints</legend>
									<div class="runPaneParams optimizerConstraintGrid">
										<label class="runPaneField optimizerRatingField">
											<span>Max Career Rating</span>
											<input type="number" value={maxCareerRating} onInput={(e) => setMaxCareerRating(+e.currentTarget.value)} />
										</label>
										<label class="runPaneField runPaneFieldCheck">
											<span>Use Reference as Initial Condition</span>
											<input type="checkbox" checked={optimizerUseReferenceInit} onInput={(e) => setOptimizerUseReferenceInit(e.currentTarget.checked)} />
										</label>
										<label class="runPaneField optimizerBoundField">
											<span>Stat Lower Bound</span>
											<input type="number" value={optimizerMinStat} onInput={(e) => setOptimizerMinStat(+e.currentTarget.value)} min="0" max="2000" />
										</label>
										<label class="runPaneField optimizerBoundField optimizerMaxStatPresetField">
											<span>Stat Upper Bound</span>
											<select
												value={optimizerMaxStatPreset}
												onInput={(e) => {
													const preset = e.currentTarget.value as OptimizerMaxStatPreset;
													setOptimizerMaxStatPreset(preset);
													setOptimizerMaxStats({...OPTIMIZER_MAX_STAT_PRESETS[preset]});
												}}
											>
												<option value="ura">URA Finale</option>
												<option value="unity">Unity Cup</option>
												<option value="trackblazer">Trackblazer</option>
												<option value="concert">Grand Concert</option>
												<option value="custom">Custom</option>
											</select>
										</label>
										<div class="optimizerMaxStatGrid">
											{([
												['speed', 'Max Speed'],
												['stamina', 'Max Stamina'],
												['power', 'Max Power'],
												['guts', 'Max Guts'],
												['wisdom', CC_GLOBAL ? 'Max Wit' : 'Max Wisdom']
											] as Array<[OptimizerMaxStatKey, string]>).map(([key, label]) => (
												<label class="optimizerMaxStatCell" key={key}>
													<span>{label}</span>
													<input
														type="number"
														min="0"
														max="2000"
														value={optimizerMaxStats[key]}
														onInput={(e) => {
															const next = {...optimizerMaxStats, [key]: +e.currentTarget.value};
															setOptimizerMaxStats(next);
															setOptimizerMaxStatPreset(presetForOptimizerMaxStats(next));
														}}
													/>
												</label>
											))}
										</div>
									</div>
								</fieldset>
							</section>
						)}

						<section class="runPaneSection runPaneActions">
							{
								isSimulationRunning
								? <button id="run" class="abort-button" onClick={abortSimulation} tabindex={1}>ABORT</button>
								: mode == Mode.Compare
								? <button id="run" onClick={doComparison} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>COMPARE</button>
								: mode == Mode.GlobalCompare
								? <button id="run" onClick={doGlobalComparison} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>GLOBAL COMPARE</button>
								: mode == Mode.RaceOptimizer
								? <button id="run" onClick={doOptimizer} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>OPTIMIZE</button>
								: mode == Mode.GlobalSkillChart
								? <button id="run" onClick={doGlobalSkillChart} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>RUN</button>
								: <button id="run" onClick={doBasinnChart} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>RUN</button>
							}
							{
								mode == Mode.Compare && !isSimulationRunning
								? <button id="runOnce" onClick={doRunOnce} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>Run Once</button>
								: null
							}
						</section>

						{((mode == Mode.Compare || mode == Mode.GlobalCompare) && isSimulationRunning && simulationProgress
							|| additionalSamplesProgress
							|| (mode == Mode.RaceOptimizer && isSimulationRunning && (optimizerProgress || optimizerInitProgress || optimizerFinalProgress))
							|| ((mode == Mode.Chart || mode == Mode.UniquesChart || mode == Mode.GlobalSkillChart) && isSimulationRunning)
						) && (
							<section class="runPaneSection runPaneProgress">
								{(mode == Mode.Compare || mode == Mode.GlobalCompare) && isSimulationRunning && simulationProgress && (
									<div id="compareProgressBar">
										<div id="compareProgressBarFill" style={`width: ${(simulationProgress.round / simulationProgress.total) * 100}%`}></div>
										<span id="compareProgressText">{simulationProgress.round}/{simulationProgress.total} Samples</span>
									</div>
								)}
								{additionalSamplesProgress && (
									<div id="compareProgressBar">
										<div id="compareProgressBarFill" style={`width: ${(additionalSamplesProgress.completed / additionalSamplesProgress.total) * 100}%`}></div>
										<span id="compareProgressText" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Additional Samples ({additionalSamplesProgress.skillId}): {additionalSamplesProgress.completed} / {additionalSamplesProgress.total}</span>
									</div>
								)}
								{mode == Mode.RaceOptimizer && isSimulationRunning && (optimizerProgress || optimizerInitProgress || optimizerFinalProgress) && (
									<div id="compareProgressBar">
										<div
											id="compareProgressBarFill"
											style={{
												width: `${Math.max(0, Math.min(100,
													optimizerPhase === 'init' && optimizerInitProgress && optimizerInitProgress.total > 0
														? (optimizerInitProgress.completed / optimizerInitProgress.total) * 100
														: optimizerPhase === 'final' && optimizerFinalProgress && optimizerFinalProgress.total > 0
														? (optimizerFinalProgress.completed / optimizerFinalProgress.total) * 100
														: optimizerProgress
														? (optimizerProgress.iteration / optimizerMaxIterations) * 100
														: 0
												))}%`
											}}
										></div>
										<span id="compareProgressText" style="white-space: nowrap;">
											{optimizerPhase === 'init' && optimizerInitProgress && optimizerInitProgress.total > 0
												? `Initializing ${Math.round((optimizerInitProgress.completed / optimizerInitProgress.total) * 100)}% (${optimizerInitProgress.completed} / ${optimizerInitProgress.total})`
												: optimizerPhase === 'final' && optimizerFinalProgress
												? `Running Final Samples ${optimizerFinalProgress.completed} / ${optimizerFinalProgress.total}`
												: optimizerProgress
												? `Iteration ${optimizerProgress.iteration} / ${optimizerMaxIterations}`
												: ''}
										</span>
									</div>
								)}
								{(mode == Mode.Chart || mode == Mode.UniquesChart || mode == Mode.GlobalSkillChart) && isSimulationRunning && (
									<div id="chartProgressBarsContainer">
										{Array.from({length: workerCount}, (_, i) => {
											const workerIndex = i + 1;
											const progress = chartWorkersProgressRef.current.get(workerIndex);
											const isCompleted = chartWorkersCompletedSetRef.current.has(workerIndex);

											const roundColors: Record<number, string> = {
												1: 'linear-gradient(90deg, #3b82f6, #2563eb)',
												2: 'linear-gradient(90deg, #14b8a6, #0d9488)',
												3: 'linear-gradient(90deg, #f59e0b, #d97706)'
											};
											const color = isCompleted ? 'linear-gradient(90deg, #10b981, #059669)' : (progress ? roundColors[progress.round] : roundColors[1]);
											const progressPercent = isCompleted ? 100 : progress ? (progress.completed / progress.totalSkills) * 100 : 0;
											const progressText = isCompleted
												? 'Completed!'
												: progress
													? `${CHART_RUN_NAMES[progress.round] || 'Chart Run'}: ${progress.completed} / ${progress.totalSkills} Skills`
													: 'Initializing';

											return (
												<div key={workerIndex} id="compareProgressBar" style="position: relative;">
													<div id="compareProgressBarFill" style={`width: ${progressPercent}%; background: ${color};`}></div>
													<span id="compareProgressText">
														{progressText}
													</span>
												</div>
											);
										})}
									</div>
								)}
							</section>
						)}

					</div>

				</div>
				</Fragment>
				)}
				{popoverSkill && activeTableData.has(popoverSkill) && <BasinnChartPopover skillid={popoverSkill} courseDistance={course.distance} raceContext={raceConditionContext} />}
				{duelingConfigOpen && (
					<div 
						class="app-modal-overlay"
						onClick={(e) => { if (e.target === e.currentTarget) setDuelingConfigOpen(false); }}
					>
						<div class="app-modal duelingConfigModal" style="max-width: 500px; width: 90%;">
							<h2>Dueling Configuration</h2>
							<div class="duelingConfigFields">
								<div>
									<label>Runaway: {duelingRates.runaway}%</label>
									<input 
										type="range" 
										min="0" 
										max="100" 
										value={duelingRates.runaway} 
										onInput={(e) => setDuelingRates({...duelingRates, runaway: parseInt((e.currentTarget as HTMLInputElement).value)})}
										style="width: 100%;"
									/>
								</div>
								<div>
									<label>Front Runner: {duelingRates.frontRunner}%</label>
									<input 
										type="range" 
										min="0" 
										max="100" 
										value={duelingRates.frontRunner} 
										onInput={(e) => setDuelingRates({...duelingRates, frontRunner: parseInt((e.currentTarget as HTMLInputElement).value)})}
										style="width: 100%;"
									/>
								</div>
								<div>
									<label>Pace Chaser: {duelingRates.paceChaser}%</label>
									<input 
										type="range" 
										min="0" 
										max="100" 
										value={duelingRates.paceChaser} 
										onInput={(e) => setDuelingRates({...duelingRates, paceChaser: parseInt((e.currentTarget as HTMLInputElement).value)})}
										style="width: 100%;"
									/>
								</div>
								<div>
									<label>Late Surger: {duelingRates.lateSurger}%</label>
									<input 
										type="range" 
										min="0" 
										max="100" 
										value={duelingRates.lateSurger} 
										onInput={(e) => setDuelingRates({...duelingRates, lateSurger: parseInt((e.currentTarget as HTMLInputElement).value)})}
										style="width: 100%;"
									/>
								</div>
								<div>
									<label>End Closer: {duelingRates.endCloser}%</label>
									<input 
										type="range" 
										min="0" 
										max="100" 
										value={duelingRates.endCloser} 
										onInput={(e) => setDuelingRates({...duelingRates, endCloser: parseInt((e.currentTarget as HTMLInputElement).value)})}
										style="width: 100%;"
									/>
								</div>
								<div class="duelingConfigWarning">
									<p>
										These are estimate %'s extracted from in-game race data, your actual dueling rate will vary based CM-by-CM based on overall lobby compositions.
									</p>
								</div>
							</div>
							<div class="duelingConfigActions">
								<button 
									onClick={() => setDuelingConfigOpen(false)}
									class="app-btn"
								>
									Close
								</button>
							</div>
						</div>
					</div>
				)}
			</IntlProvider>
		</Language.Provider>
	);
}

initTelemetry();
applyAssetCssVars();
installUiScale();
render(<App lang="en-ja" />, document.getElementById('app'));



import { h, Fragment, render } from 'preact';
import { useState, useReducer, useMemo, useEffect, useRef, useId, useCallback } from 'preact/hooks';
import { Text, IntlProvider } from 'preact-i18n';
import { Settings } from 'lucide-preact';
import { Record, Set as ImmSet, Map as ImmMap } from 'immutable';
import * as d3 from 'd3';
import { computePosition, flip } from '@floating-ui/dom';

import { CourseHelpers, CourseData, DistanceType, Surface } from '../uma-skill-tools/CourseData';
import courses from '../uma-skill-tools/data/course_data.json';
import { RaceParameters, Mood, GroundCondition, Weather, Season, Time, Grade } from '../uma-skill-tools/RaceParameters';
import { PosKeepMode } from '../uma-skill-tools/RaceSolver';
import type { GameHpPolicy } from '../uma-skill-tools/HpPolicy';

import { Language, LanguageSelect, useLanguageSelect } from '../components/Language';
import { ExpandedSkillDetails, STRINGS_en as SKILL_STRINGS_en } from '../components/SkillList';
import { RaceTrack, TrackSelect, RegionDisplayType } from '../components/RaceTrack';
import { HorseState, SkillSet } from '../components/HorseDefTypes';
import { HorseDef, horseDefTabs, isGeneralSkill } from '../components/HorseDef';
import { TRACKNAMES_ja, TRACKNAMES_en } from '../strings/common';
import { RaceState } from '../uma-skill-tools/RaceSolver';

import { getActivateableSkills, isPurpleSkill, getNullRow, BasinnChart } from './BasinnChart';

import { initTelemetry, postEvent } from './telemetry';

import { IntroText } from './IntroText';

import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import skillmeta from '../skill_meta.json';
import nonGlobalPresetDefs from './presets.json';
import globalPresetDefs from '../umalator-global/presets.json';

// Global build flag injected at runtime
declare const CC_GLOBAL: boolean;

import './app.css';

const DEFAULT_SAMPLES = 500;
const DEFAULT_SEED = 2615953739;



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

function OptimizerStatsBar({stats, onLoadToUma1, careerRating}) {
	if (!stats) return null;
	const rounded = {
		speed: Math.round(stats.speed),
		stamina: Math.round(stats.stamina),
		power: Math.round(stats.power),
		guts: Math.round(stats.guts),
		wisdom: Math.round(stats.wisdom)
	};
	return (
		<div style="width: 960px; max-width: 960px; margin-top: 80px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
			<div style="font-weight: 600; font-size: 14px; margin-right: 12px; white-space: nowrap;">Career Rating: {careerRating != null ? Math.round(careerRating) : '—'}</div>
			<div class="horseParams" style="grid-template-columns: repeat(5, 1fr); margin: 0; width: 100%; flex: 1;">
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_00.png" /><span>Speed</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_01.png" /><span>Stamina</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_02.png" /><span>Power</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_03.png" /><span>Guts</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_04.png" /><span>{CC_GLOBAL?'Wit':'Wisdom'}</span></div>
				{(['speed','stamina','power','guts','wisdom'] as const).map((k) => (
					<div class="horseParam">
						<img src={`/uma-tools/icons/statusrank/ui_statusrank_${(100 + rankForStat(rounded[k])).toString().slice(1)}.png`} />
						<input type="number" value={rounded[k]} disabled style={{opacity: 0.9}} />
					</div>
				))}
			</div>
			<button type="button" class="resetUmaButton" onClick={onLoadToUma1} style="margin-left: 12px; white-space: nowrap;">
				Apply Stats
			</button>
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
				<img src={`/uma-tools/icons/utx_ico_timezone_0${i}.png`} title={SKILL_STRINGS_en.skilldetails.time[i+2]}
					class={i+2 == props.value ? 'selected' : ''} data-timeofday={i+2} />)}
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
				<img src={`/uma-tools/icons/utx_ico_weather_0${i}.png`} title={SKILL_STRINGS_en.skilldetails.weather[i+1]}
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
				<img src={`/uma-tools/icons${CC_GLOBAL?'/global':''}/utx_txt_season_0${i}.png`} title={SKILL_STRINGS_en.skilldetails.season[i+1]}
					class={i+1 == props.value ? 'selected' : ''} data-season={i+1} />)}
		</div>
	);
}

function Histogram(props) {
	const {data, width, height} = props;
	const axes = useRef(null);
	const xH = 20;
	const yW = 40;

	const x = d3.scaleLinear().domain(
		data[0] == 0 && data[data.length-1] == 0
			? [-1,1]
			: [Math.min(0,Math.floor(data[0])),Math.ceil(data[data.length-1])]
	).range([yW,width-yW]);
	const bucketize = d3.bin().value(id).domain(x.domain()).thresholds(x.ticks(30));
	const buckets = bucketize(data);
	const y = d3.scaleLinear().domain([0,d3.max(buckets, b => b.length)]).range([height-xH,xH]);

	useEffect(function () {
		const g = d3.select(axes.current);
		g.selectAll('*').remove();
		g.append('g').attr('transform', `translate(0,${height - xH})`).call(d3.axisBottom(x));
		g.append('g').attr('transform', `translate(${yW},0)`).call(d3.axisLeft(y));
	}, [data, width, height]);

	const rects = buckets.map((b,i) =>
		<rect key={i} fill="#2a77c5" stroke="black" x={x(b.x0)} y={y(b.length)} width={x(b.x1) - x(b.x0)} height={height - xH - y(b.length)} />
	);
	return (
		<svg id="histogram" width={width} height={height}>
			<g>{rects}</g>
			<g ref={axes}></g>
		</svg>
	);
}

function OptimizerGraphs({iterations, evaluationMethod, width: widthProp}) {
	if (!iterations || iterations.length === 0) return null;
	
	const width = widthProp || 420;
	const height = 200;
	const margin = { top: 20, right: 20, bottom: 40, left: 60 };
	const chartWidth = width - margin.left - margin.right;
	const chartHeight = height - margin.top - margin.bottom;
	
	// Cost function graph (margin of win over iterations)
	const costAxes = useRef(null);
	const costLine = useRef(null);
	const bestCostAxes = useRef(null);
	const bestCostLine = useRef(null);
	
	useEffect(() => {
		if (!costAxes.current || !costLine.current) return;
		
		const x = d3.scaleLinear()
			.domain([0, iterations.length - 1])
			.range([0, chartWidth]);
		
		const y = d3.scaleLinear()
			.domain(d3.extent(iterations, d => d.evaluationValue))
			.range([chartHeight, 0]);
		
		const line = d3.line()
			.x((d, i) => x(i))
			.y(d => y(d.evaluationValue))
			.curve(d3.curveMonotoneX);
		
		// Clear previous
		d3.select(costLine.current).selectAll('*').remove();
		d3.select(costAxes.current).selectAll('*').remove();
		
		// Draw line
		d3.select(costLine.current)
			.append('path')
			.datum(iterations)
			.attr('fill', 'none')
			.attr('stroke', '#2a77c5')
			.attr('stroke-width', 2)
			.attr('d', line);
		
		// Draw axes
		const xAxis = d3.axisBottom(x).ticks(Math.min(10, iterations.length));
		const yAxis = d3.axisLeft(y);
		
		const costAxesG = d3.select(costAxes.current);
		costAxesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		
		costAxesG
			.append('g')
			.call(yAxis);

		costAxesG.selectAll('.tick text').style('font-size', '11px');
	}, [iterations, chartWidth, chartHeight]);

	useEffect(() => {
		if (!bestCostAxes.current || !bestCostLine.current) return;
		
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
			.domain(d3.extent(bestSoFar))
			.range([chartHeight, 0]);
		
		const line = d3.line()
			.x((d, i) => x(i))
			.y(d => y(d))
			.curve(d3.curveMonotoneX);
		
		d3.select(bestCostLine.current).selectAll('*').remove();
		d3.select(bestCostAxes.current).selectAll('*').remove();
		
		d3.select(bestCostLine.current)
			.append('path')
			.datum(bestSoFar)
			.attr('fill', 'none')
			.attr('stroke', '#2a77c5')
			.attr('stroke-width', 2)
			.attr('d', line);
		
		const xAxis = d3.axisBottom(x).ticks(Math.min(10, iterations.length));
		const yAxis = d3.axisLeft(y);
		
		const bestAxesG = d3.select(bestCostAxes.current);
		bestAxesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		
		bestAxesG
			.append('g')
			.call(yAxis);
		
		bestAxesG.selectAll('.tick text').style('font-size', '11px');
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
			.attr('stroke', '#c52a2a')
			.attr('stroke-width', 2)
			.attr('d', line);
		
		// Draw axes
		const xAxis = d3.axisBottom(x).ticks(Math.min(10, iterations.length));
		const yAxis = d3.axisLeft(y).ticks(5, '.1g');
		
		const convAxesG = d3.select(convergenceAxes.current);
		convAxesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		
		convAxesG
			.append('g')
			.call(yAxis);

		convAxesG.selectAll('.tick text').style('font-size', '11px');
	}, [iterations, chartWidth, chartHeight]);
	
	// Stats evolution graph
	const statsAxes = useRef(null);
	const statsLines = useRef(null);
	
	useEffect(() => {
		if (!statsAxes.current || !statsLines.current || iterations.length === 0) return;
		
		const statKeys = ['speed', 'stamina', 'power', 'guts', 'wisdom'];
		const colors = ['#2a77c5', '#c52a2a', '#22c55e', '#a855f7', '#f59e0b'];
		
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
		const xAxis = d3.axisBottom(x).ticks(Math.min(10, iterations.length));
		const yAxis = d3.axisLeft(y);
		
		const statsAxesG = d3.select(statsAxes.current);
		statsAxesG
			.append('g')
			.attr('transform', `translate(0,${chartHeight})`)
			.call(xAxis);
		
		statsAxesG
			.append('g')
			.call(yAxis);

		statsAxesG.selectAll('.tick text').style('font-size', '11px');
	}, [iterations, chartWidth, chartHeight]);
	
	return (
		<div class="optimizerGraphs" style="display: flex; flex-direction: column; gap: 0px; transform: translate(20px, 20px);">
			<div style="display: grid; grid-template-columns: 1fr 1fr; column-gap: 30px; row-gap: 12px; align-items: flex-start;">
				<div>
					<h3 style="margin: 0 0 6px 0;">Optimal Cost Function ({evaluationMethod === 'mean' ? 'Mean' : evaluationMethod === 'median' ? 'Median' : 'Aggregate'} Margin)</h3>
					<svg width={width} height={height} style="border: 1px solid #ccc;">
						<g transform={`translate(${margin.left},${margin.top})`}>
							<g ref={bestCostLine}></g>
							<g ref={bestCostAxes}></g>
							<text x={chartWidth / 2 - 30} y={chartHeight + 30} textAnchor="middle" dominantBaseline="middle" style="font-size:12px;">Iteration</text>
							<text x={-chartHeight / 2 - 40} y={-42} textAnchor="middle" dominantBaseline="middle" transform="rotate(-90)" style="font-size:12px;">{CC_GLOBAL ? 'Margin (lengths)' : 'Margin (バ身)'}</text>
						</g>
					</svg>
				</div>
				<div>
					<h3 style="margin: 0 0 6px 0;">Current Cost Function ({evaluationMethod === 'mean' ? 'Mean' : evaluationMethod === 'median' ? 'Median' : 'Aggregate'} Margin)</h3>
					<svg width={width} height={height} style="border: 1px solid #ccc;">
						<g transform={`translate(${margin.left},${margin.top})`}>
							<g ref={costLine}></g>
							<g ref={costAxes}></g>
							<text x={chartWidth / 2 - 30} y={chartHeight+30} textAnchor="middle" dominantBaseline="middle" style="font-size:12px;">Iteration</text>
							<text x={-chartHeight / 2 - 40} y={-42} textAnchor="middle" dominantBaseline="middle" transform="rotate(-90)" style="font-size:12px;">{CC_GLOBAL ? 'Margin (lengths)' : 'Margin (バ身)'}</text>
						</g>
					</svg>
				</div>
				<div>
					<h3 style="margin: 0 0 6px 0;">Convergence</h3>
					<svg width={width} height={height} style="border: 1px solid #ccc;">
						<g transform={`translate(${margin.left},${margin.top})`}>
							<g ref={convergenceLine}></g>
							<g ref={convergenceAxes}></g>
							<text x={chartWidth / 2 - 30} y={chartHeight+30} textAnchor="middle" dominantBaseline="middle" style="font-size:12px;">Iteration</text>
							<text x={-chartHeight / 2 - 25} y={-42} textAnchor="middle" dominantBaseline="middle" transform="rotate(-90)" style="font-size:12px;">Change</text>
						</g>
					</svg>
				</div>
				<div>
					<h3 style="margin: 0 0 6px 0;">Stats Evolution</h3>
					<div style={`display: flex; align-items: flex-start; gap: 10px; width: ${width + 140}px; overflow: visible;`}>
						<svg width={width} height={height} style="border: 1px solid #ccc;">
							<g transform={`translate(${margin.left},${margin.top})`}>
								<g ref={statsLines}></g>
								<g ref={statsAxes}></g>
								<text x={chartWidth / 2	- 30} y={chartHeight+30} textAnchor="middle" dominantBaseline="middle" style="font-size:12px;">Iteration</text>
								<text x={-chartHeight / 2 - 30} y={-42} textAnchor="middle" dominantBaseline="middle" transform="rotate(-90)" style="font-size:12px;">Stat Value</text>
							</g>
						</svg>
						<div style="min-width: 120px; margin-left: 4px;">
							{['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom'].map((label, idx) => (
								<div key={label} style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
									<span style={`display:inline-block;width:20px;height:2px;background:${['#2a77c5', '#c52a2a', '#22c55e', '#a855f7', '#f59e0b'][idx]}`}></span>
									<span style="font-size: 12px;">{label}</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function BarChart(props) {
	const {width, height, bins, xScale, yScale, phaseBackgrounds, xAxisTicks, yAxisTicks, yTickValues, yAxisFormat, barColor} = props;
	const axes = useRef(null);
	const gridLines = useRef(null);
	const xH = 20;
	const yW = 40;
	const chartWidth = width - yW - 5;
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
		
		const gridG = d3.select(gridLines.current);
		gridG.selectAll('*').remove();
		
		xScale.ticks(xAxisTicks).forEach(tickValue => {
			gridG.append('line')
				.attr('class', 'grid-line')
				.attr('x1', xScale(tickValue))
				.attr('x2', xScale(tickValue))
				.attr('y1', 0)
				.attr('y2', chartHeight)
				.attr('stroke', 'rgba(128, 128, 128, 0.3)')
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
				.attr('stroke', 'rgba(128, 128, 128, 0.3)')
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
				fill={barColor || "#2a77c5"} 
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
	const width = 300;
	const height = 150;

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

	const x = d3.scaleLinear().domain([0, maxDistance]).range([0, width - 40 - 5]);
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
	const phase2End = CourseHelpers.phaseStart(courseDistance, 3);
	
	const phaseBackgrounds = [
		{start: 0, end: phase0End, color: 'rgba(173, 216, 230, 0.3)'},
		{start: phase0End, end: phase1End, color: 'rgba(144, 238, 144, 0.3)'},
		{start: phase1End, end: courseDistance, color: 'rgba(255, 182, 193, 0.3)'}
	];

	return (
		<BarChart
			width={width}
			height={height}
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
			barColor="#2a77c5"
		/>
	);
}

function getSkillPositionsFromRun(skillId: string, selectedRun: any): {positions: Array<[number, number]>, umaIndex: number} | null {
	if (!selectedRun?.sk) return null;
	
	for (let i = 0; i < selectedRun.sk.length; i++) {
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
		'rgba(173, 216, 230, 0.3)',
		'rgba(144, 238, 144, 0.3)',
		'rgba(255, 182, 193, 0.3)',
		'rgba(255, 182, 193, 0.3)'
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

export function VelocityChart(props) {
	const {skillId, runData, courseDistance, displaying} = props;
	const width = 400;
	const height = 200;
	const margin = {top: 5, right: 5, bottom: 20, left: 40};
	const chartWidth = width - margin.left - margin.right;
	const chartHeight = height - margin.top - margin.bottom;
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const axesRef = useRef(null);
	
	const TIME_WINDOW_PADDING = 10;
	const Y_MIN_VELOCITY = 18;
	const TICK_EPSILON = 0.01;
	const VELOCITY_CONVERGENCE_THRESHOLD = 0.02;

	if (!skillId || !runData || !displaying) {
		return null;
	}

	const selectedRun = runData[displaying];
	if (!selectedRun?.t || !selectedRun?.v || !selectedRun?.p || !selectedRun?.sk) {
		return null;
	}

	if (!selectedRun.t[0] || !selectedRun.v[0] || !selectedRun.p[0] ||
		!selectedRun.t[1] || !selectedRun.v[1] || !selectedRun.p[1]) {
		return null;
	}

	const skillData = getSkillPositionsFromRun(skillId, selectedRun);
	if (!skillData || skillData.positions.length === 0) {
		return null;
	}

	const uma1Times = selectedRun.t[0];
	const uma1Velocities = selectedRun.v[0];
	const uma1Positions = selectedRun.p[0];
	
	const uma2Times = selectedRun.t[1];
	const uma2Velocities = selectedRun.v[1];
	const uma2Positions = selectedRun.p[1];

	if (!uma1Times || !uma1Velocities || !uma1Positions || uma1Times.length === 0 ||
		!uma2Times || !uma2Velocities || !uma2Positions || uma2Times.length === 0) {
		return null;
	}

	const {positions: skillPositions} = skillData;
	const [startPos, endPos] = skillPositions[0];
	const startTime = interpolateValue(startPos, uma2Positions, uma2Times);
	const endTime = interpolateValue(endPos, uma2Positions, uma2Times);

	const timeWindowStart = Math.max(0, startTime - TIME_WINDOW_PADDING);
	const timeWindowEnd = endTime + TIME_WINDOW_PADDING;

	const uma1VelocityData: Array<[number, number]> = [];
	const uma2VelocityData: Array<[number, number]> = [];
	const positionData: Array<[number, number]> = [];
	
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

	if (uma1VelocityData.length === 0 || uma2VelocityData.length === 0) {
		return null;
	}

	const minTime = timeWindowStart;
	const maxTime = timeWindowEnd;
	
	const allVelocities = [...uma1VelocityData.map(d => d[1]), ...uma2VelocityData.map(d => d[1])];
	const minVelocity = Math.min(...allVelocities);
	const maxVelocity = Math.max(...allVelocities);

	const maxVelocityEntireRace = Math.max(
		Math.max(...uma1Velocities),
		Math.max(...uma2Velocities)
	);
	const maxVelocityRoundedUp = Math.ceil(maxVelocityEntireRace) + 1;
	
	const yMin = Math.min(Y_MIN_VELOCITY, minVelocity);
	const yMax = Math.max(Y_MIN_VELOCITY, maxVelocityRoundedUp);

	const x = d3.scaleLinear().domain([minTime, maxTime]).range([0, chartWidth]);
	const y = d3.scaleLinear().domain([yMin, yMax]).range([chartHeight, 0]);

	const phaseBackgrounds = calculatePhaseBackgrounds(
		courseDistance,
		positionData,
		minTime,
		maxTime
	);

	const line = d3.line<[number, number]>()
		.x(d => x(d[0]))
		.y(d => y(d[1]))
		.curve(d3.curveMonotoneX);

	const uma1PathData = line(uma1VelocityData);

	let convergenceTime = maxTime;
	for (let i = 0; i < uma2Times.length; i++) {
		const t = uma2Times[i];
		if (t >= endTime) {
			const uma2Vel = uma2Velocities[i];
			const uma1Vel = uma1Velocities[i];
			if (Math.abs(uma1Vel - uma2Vel) <= VELOCITY_CONVERGENCE_THRESHOLD) {
				convergenceTime = t;
				break;
			}
		}
	}

	const uma2VelocityDataFiltered: Array<[number, number]> = [];
	for (let i = 0; i < uma2VelocityData.length; i++) {
		const [t, v] = uma2VelocityData[i];
		if (t >= startTime && t <= Math.min(convergenceTime, timeWindowEnd)) {
			uma2VelocityDataFiltered.push([t, v]);
		}
	}

	const uma2PathData = uma2VelocityDataFiltered.length > 0 ? line(uma2VelocityDataFiltered) : null;

	useEffect(function() {
		if (!canvasRef.current) return;
		
		const canvas = canvasRef.current;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		
		ctx.clearRect(0, 0, width, height);
		
		ctx.save();
		ctx.translate(margin.left, margin.top);
		
		phaseBackgrounds.forEach(phase => {
			ctx.fillStyle = phase.color;
			ctx.fillRect(x(phase.start), 0, x(phase.end) - x(phase.start), chartHeight);
		});
		
		const suggestedTicks = y.ticks(5);
		const step = suggestedTicks.length > 1 ? suggestedTicks[1] - suggestedTicks[0] : 1;
		const startTick = Math.floor(yMin / step) * step;
		
		const yTickValues: number[] = [];
		for (let v = startTick; v <= maxVelocityRoundedUp; v += step) {
			if (v >= yMin) {
				yTickValues.push(v);
			}
		}
		
		if (!yTickValues.some(tick => Math.abs(tick - maxVelocityRoundedUp) < TICK_EPSILON)) {
			yTickValues.push(maxVelocityRoundedUp);
		}
		yTickValues.sort((a, b) => a - b);
		
		ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
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
		
		if (uma1PathData && uma1VelocityData.length > 0) {
			ctx.strokeStyle = '#2a77c5';
			ctx.lineWidth = 2;
			ctx.beginPath();
			uma1VelocityData.forEach((d, i) => {
				const roundedTime = Number(d[0].toFixed(2));
				const roundedVelocity = Number(d[1].toFixed(2));
				if (i === 0) {
					ctx.moveTo(x(roundedTime), y(roundedVelocity));
				} else {
					ctx.lineTo(x(roundedTime), y(roundedVelocity));
				}
			});
			ctx.stroke();
		}
		
		if (uma2PathData && uma2VelocityDataFiltered.length > 0) {
			ctx.strokeStyle = '#ff69b4';
			ctx.lineWidth = 2;
			ctx.beginPath();
			uma2VelocityDataFiltered.forEach((d, i) => {
				const roundedTime = Number(d[0].toFixed(2));
				const roundedVelocity = Number(d[1].toFixed(2));
				if (i === 0) {
					ctx.moveTo(x(roundedTime), y(roundedVelocity));
				} else {
					ctx.lineTo(x(roundedTime), y(roundedVelocity));
				}
			});
			ctx.stroke();
		}
		
		ctx.restore();
	}, [x, y, chartWidth, chartHeight, yMin, maxVelocityRoundedUp, phaseBackgrounds, uma1VelocityData, uma2VelocityDataFiltered, width, height, margin]);

	useEffect(function() {
		if (!axesRef.current) return;
		
		const axesG = d3.select(axesRef.current);
		axesG.selectAll('*').remove();
		
		const suggestedTicks = y.ticks(5);
		const step = suggestedTicks.length > 1 ? suggestedTicks[1] - suggestedTicks[0] : 1;
		const startTick = Math.floor(yMin / step) * step;
		
		const yTickValues: number[] = [];
		for (let v = startTick; v <= maxVelocityRoundedUp; v += step) {
			if (v >= yMin) {
				yTickValues.push(v);
			}
		}
		
		if (!yTickValues.some(tick => Math.abs(tick - maxVelocityRoundedUp) < TICK_EPSILON)) {
			yTickValues.push(maxVelocityRoundedUp);
		}
		yTickValues.sort((a, b) => a - b);
		
		const xAxis = d3.axisBottom(x).ticks(5).tickFormat(d => `${d}s`);
		const yAxis = d3.axisLeft(y).tickValues(yTickValues).tickFormat(d => `${Number(d).toFixed(1)}m/s`);
		
		axesG.append('g')
			.attr('transform', `translate(${margin.left},${height - margin.bottom})`)
			.call(xAxis);
		axesG.append('g')
			.attr('transform', `translate(${margin.left},${margin.top})`)
			.call(yAxis);
	}, [x, y, chartWidth, chartHeight, yMin, maxVelocityRoundedUp, width, height, margin]);

	return (
		<div class="velocityChart" style={`width: ${width}px; height: ${height}px; position: relative; overflow: visible;`}>
			<canvas ref={canvasRef} width={width} height={height} style="position: absolute; top: 0; left: 0;" />
			<svg width={width + margin.left} height={height} style="position: absolute; top: 0; left: 0; pointer-events: none; overflow: visible;">
				<g ref={axesRef}></g>
			</svg>
		</div>
	);
}

export function ActivationFrequencyChart(props) {
	const {skillId, runData, courseDistance} = props;
	const width = 300;
	const height = 50;
	const yW = 40;
	const chartWidth = width - yW - 5;
	const chartHeight = height - 20 - 5;

	if (!skillId || !runData) {
		return null;
	}

	const activations = [];
	if (!runData.allruns || !runData.allruns.sk || !Array.isArray(runData.allruns.sk)) {
		return null;
	}
	
	runData.allruns.sk.forEach((skMap: any) => {
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
			positions.forEach((pos: any) => {
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
	const phase2End = CourseHelpers.phaseStart(courseDistance, 3);
	
	const phaseBackgrounds = [
		{start: 0, end: phase0End, color: 'rgba(173, 216, 230, 0.3)'},
		{start: phase0End, end: phase1End, color: 'rgba(144, 238, 144, 0.3)'},
		{start: phase1End, end: courseDistance, color: 'rgba(255, 182, 193, 0.3)'}
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
				barColor="#2a77c5"
			/>
		</div>
	);
}

function BasinnChartPopover(props) {
	const popover = useRef(null);
	useEffect(function () {
		if (popover.current == null) return;
		// bit nasty
		const anchor = document.querySelector(`.basinnChart tr[data-skillid="${props.skillid}"] img`);
		computePosition(anchor, popover.current, {
			placement: 'bottom-start',
			middleware: [flip()]
		}).then(({x,y}) => {
			popover.current.style.transform = `translate(${x}px,${y}px)`;
			popover.current.style.visibility = 'visible';
		});
		popover.current.focus();
	}, [popover.current, props.skillid]);
		return (
			<div class="basinnChartPopover" tabindex={1000} style="visibility:hidden" ref={popover}>
			<ExpandedSkillDetails id={props.skillid} distanceFactor={props.courseDistance} dismissable={false} />
			<Histogram width={500} height={333} data={props.results} />
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

function ResultsTable(props) {
	const {caption, color, chartData, idx, runData} = props;

	// Handle null chartData gracefully
	if (!chartData || !chartData.t || !chartData.t[idx] || !chartData.sdly || !chartData.v || !chartData.v[idx]) {
		return (
			<table>
				<caption style={`color:${color}`}>{caption}</caption>
				<tbody>
					<tr><td colSpan={2}>No chart data available</td></tr>
				</tbody>
			</table>
		);
	}

	return (
		<table>
			<caption style={`color:${color}`}>{caption}</caption>
			<tbody>
				<tr><th>Time to finish</th><td>{formatTime(chartData.t[idx][chartData.t[idx].length-1] * 1.18)}</td></tr>
				<tr><th>Start delay</th><td>{chartData.sdly[idx].toFixed(4) + ' s'}</td></tr>
				<tr><th>Top speed</th><td>{chartData.v[idx].reduce((a,b) => Math.max(a,b), 0).toFixed(2) + ' m/s'}</td></tr>
				{runData?.allruns?.rushed && (
					<tr><th>Rushed frequency</th><td>{runData.allruns.rushed[idx].frequency > 0 ? `${runData.allruns.rushed[idx].frequency.toFixed(1)}% (${runData.allruns.rushed[idx].mean.toFixed(1)}m)` : '0%'}</td></tr>
				)}
				{runData?.allruns?.leadCompetition && (
					<tr><th>Spot Struggle frequency</th><td>{runData.allruns.leadCompetition[idx].frequency > 0 ? `${runData.allruns.leadCompetition[idx].frequency.toFixed(1)}%` : '0%'}</td></tr>
				)}
				{runData?.allruns?.competeFight && (
					<tr><th>Dueling frequency</th><td>{runData.allruns.competeFight[idx].frequency > 0 ? `${runData.allruns.competeFight[idx].frequency.toFixed(1)}%` : '0%'}</td></tr>
				)}
			</tbody>
			{chartData.sk && chartData.sk[idx] && chartData.sk[idx].size > 0 &&
				<tbody>
					{Array.from(chartData.sk[idx].entries()).map(([id,ars]) => ars.flatMap(pos =>
						<tr>
							<th>{skillnames[id][0]}</th>
							<td>{pos[1] == -1 ? `${pos[0].toFixed(2)} m` : `${pos[0].toFixed(2)} m – ${pos[1].toFixed(2)} m`}</td>
						</tr>))}
				</tbody>}
		</table>
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
}) {
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
		duelingRates
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
					}
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
					}
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
}) {
	try {
		const hash = await serialize(courseId, nsamples, seed, posKeepMode, racedef, uma1, uma2, pacer, showVirtualPacemakerOnGraph, pacemakerCount, selectedPacemakers, showLanes, witVarianceSettings, competeFight, leadCompetition, duelingRates);
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
async function saveProfilesToStorage(profiles: SavedUmaProfile[]): Promise<void> {
	const json = JSON.stringify(profiles, null, 2);
	
	// Try to save to file first
	try {
		const handle = await getProfilesFileHandle();
		if (handle) {
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
		localStorage.setItem('umalator-saved-profiles', json);
	} catch (error) {
		console.warn('Failed to save profiles to localStorage:', error);
		throw error;
	}
}

// Load profiles from file (or localStorage as fallback)
async function getAllSavedProfiles(): Promise<SavedUmaProfile[]> {
	// Try to load from file first if we have a handle
	if (profilesFileHandle) {
		try {
			const file = await profilesFileHandle.getFile();
			const text = await file.text();
			const profiles = JSON.parse(text) as SavedUmaProfile[];
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
	if ('showOpenFilePicker' in window && !hasLocalStorageData) {
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
			const profiles = JSON.parse(text) as SavedUmaProfile[];
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
			return JSON.parse(stored);
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
	const profiles = await getAllSavedProfiles();
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
	await saveProfilesToStorage(profiles);
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
		const profiles = JSON.parse(text) as SavedUmaProfile[];
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

const EMPTY_RESULTS_STATE = {courseId: DEFAULT_COURSE_ID, results: [], runData: null, chartData: null, displaying: '', spurtInfo: null, staminaStats: null, firstUmaStats: null, raceParams: null};
function updateResultsState(state: typeof EMPTY_RESULTS_STATE, o: number | string | {results: any, runData: any, spurtInfo?: any, staminaStats?: any, firstUmaStats?: any, raceParams?: any}) {
	if (typeof o == 'number') {
		return {
			courseId: o,
			results: [],
			runData: null,
			chartData: null,
			displaying: '',
			spurtInfo: null,
			staminaStats: null,
			firstUmaStats: null
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
			raceParams: state.raceParams
		};
		} else {
			// Ensure we have a valid chartData - try meanrun, then medianrun, then minrun, then maxrun
			const displayKey = state.displaying || 'meanrun';
			let chartData = o.runData?.[displayKey];
			if (!chartData && o.runData) {
				chartData = o.runData.medianrun || o.runData.minrun || o.runData.maxrun || null;
			}
			return {
				courseId: state.courseId,
				results: o.results,
				runData: o.runData,
				chartData: chartData,
				displaying: state.displaying || 'meanrun',
				spurtInfo: o.spurtInfo || null,
				staminaStats: o.staminaStats || null,
				firstUmaStats: o.firstUmaStats || null,
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

const enum Mode { Compare, Chart, UniquesChart, GlobalCompare, RaceOptimizer }
const enum UiStateMsg { SetModeCompare, SetModeChart, SetModeUniquesChart, SetModeGlobalCompare, SetModeRaceOptimizer, SetCurrentIdx0, SetCurrentIdx1, SetCurrentIdx2, ToggleExpand }

const DEFAULT_UI_STATE = {mode: Mode.Compare, currentIdx: 0, expanded: false};

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

function StatsTable({ caption, captionColor, rows, enableSorting = false }) {
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

	const headerStyle = enableSorting 
		? {border: '1px solid #ccc', padding: '8px', textAlign: 'center', cursor: 'pointer', userSelect: 'none'}
		: {border: '1px solid #ccc', padding: '8px', textAlign: 'center'};

	return (
		<table style={{borderCollapse: 'collapse', marginTop: '0', width: '100%', display: 'table', borderSpacing: 0}}>
			<caption style={{fontWeight: 'bold', marginBottom: '8px', marginTop: '10px', color: captionColor, captionSide: 'top', display: 'table-caption'}}>{caption}</caption>
			<thead>
				<tr>
					<th style={{border: '1px solid #ccc', padding: '8px', textAlign: 'left', cursor: enableSorting ? 'pointer' : 'default', userSelect: enableSorting ? 'none' : 'auto'}} onClick={() => handleSort('label')}>
						{getFirstColumnHeader()}{getSortIndicator('label')}
					</th>
					<th style={headerStyle} onClick={() => handleSort('count')}>
						Count{getSortIndicator('count')}
					</th>
					<th style={headerStyle} onClick={() => handleSort('min')}>
						Min{getSortIndicator('min')}
					</th>
					<th style={headerStyle} onClick={() => handleSort('max')}>
						Max{getSortIndicator('max')}
					</th>
					<th style={headerStyle} onClick={() => handleSort('mean')}>
						Mean{getSortIndicator('mean')}
					</th>
					<th style={headerStyle} onClick={() => handleSort('median')}>
						Median{getSortIndicator('median')}
					</th>
				</tr>
			</thead>
			<tbody>
				{sortedRows.map(({ label, stats }, idx) => (
					<tr key={`${caption}-${label}-${idx}`}>
						<th scope="row" style={{border: '1px solid #ccc', padding: '8px', textAlign: 'left', fontWeight: 'normal'}}>{label}</th>
						<td style={{border: '1px solid #ccc', padding: '8px', textAlign: 'center'}}>{stats.count != null ? stats.count : 0}</td>
						<td style={{border: '1px solid #ccc', padding: '8px', textAlign: 'center'}}>{formatValue(stats.min, label)}</td>
						<td style={{border: '1px solid #ccc', padding: '8px', textAlign: 'center'}}>{formatValue(stats.max, label)}</td>
						<td style={{border: '1px solid #ccc', padding: '8px', textAlign: 'center'}}>{formatValue(stats.mean, label)}</td>
						<td style={{border: '1px solid #ccc', padding: '8px', textAlign: 'center'}}>{formatValue(stats.median, label)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function App(props) {
	//const [language, setLanguage] = useLanguageSelect(); 
	const [darkMode, toggleDarkMode] = useReducer(b=>!b, false);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const [racedef, setRaceDef] = useState(() => DEFAULT_PRESET.racedef);
	const [nsamples, setSamples] = useState(DEFAULT_SAMPLES);
	const [workerCount, setWorkerCount] = useState(8);
	const [seed, setSeed] = useState(DEFAULT_SEED);
	const [runOnceCounter, setRunOnceCounter] = useState(0);
	const [isSimulationRunning, setIsSimulationRunning] = useState(false);
	const [simulationProgress, setSimulationProgress] = useState<{round: number, total: number, completed?: number, totalSkills?: number} | null>(null);
	const [workerVersion, setWorkerVersion] = useState(0);
	const chartWorkersCompletedRef = useRef(0);
	const chartWorkersProgressRef = useRef<Map<number, {round: number, completed: number, totalSkills: number}>>(new Map());
	const chartWorkersInitialSkillsRef = useRef<Map<number, number>>(new Map());
	const chartWorkersCompletedSetRef = useRef<Set<number>>(new Set());
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

	const [syncRng, toggleSyncRng] = useReducer((b,_) => !b, false);
	const [skillWisdomCheck, toggleSkillWisdomCheck] = useReducer((b,_) => !b, true);
	const [rushedKakari, toggleRushedKakari] = useReducer((b,_) => !b, true);
	const [competeFight, setCompeteFight] = useState(false);
	const [leadCompetition, setLeadCompetition] = useState(true);
	const [duelingConfigOpen, setDuelingConfigOpen] = useState(false);
	const [duelingRates, setDuelingRates] = useState({
		runaway: 10,
		frontRunner: 20,
		paceChaser: 30,
		lateSurger: 35,
		endCloser: 35
	});
	const [hpDeathPositionTab, setHpDeathPositionTab] = useState(0);
	const [showVirtualPacemakerOnGraph, toggleShowVirtualPacemakerOnGraph] = useReducer((b,_) => !b, false);
	const [pacemakerCount, setPacemakerCount] = useState(1);
	const [selectedPacemakerIndices, setSelectedPacemakerIndices] = useState([]); // Array of selected pacemaker indices (0, 1, 2), empty means none selected
	const [isPacemakerDropdownOpen, setIsPacemakerDropdownOpen] = useState(false);
	const [globalCompareDistance, setGlobalCompareDistance] = useState<DistanceType>(DistanceType.Mile);
	const [globalCompareTerrain, setGlobalCompareTerrain] = useState<Surface>(Surface.Turf);
	const [maxCareerRating, setMaxCareerRating] = useState(8200);
	const [optimizerResult, setOptimizerResult] = useState<any>(null);
	const [optimizerProgress, setOptimizerProgress] = useState<any>(null);
	const [optimizerIterations, setOptimizerIterations] = useState<any[]>([]);
	const [optimizerMaxIterations, setOptimizerMaxIterations] = useState(100);
const [optimizerEvaluationMethod, setOptimizerEvaluationMethod] = useState<'mean' | 'median' | 'aggregate'>('median');
	const [optimizerMinStat, setOptimizerMinStat] = useState(300);
	const [optimizerMaxStat, setOptimizerMaxStat] = useState(1200);
	const [optimizerChartData, setOptimizerChartData] = useState<any>(null);
	const [optimizerRunData, setOptimizerRunData] = useState<any>(null);
	const [optimizerDisplaying, setOptimizerDisplaying] = useState<'minrun' | 'maxrun' | 'meanrun' | 'medianrun'>('medianrun');
const [optimizerInitCount, setOptimizerInitCount] = useState(100);
const [optimizerUseReferenceInit, setOptimizerUseReferenceInit] = useState(false);
	const [optimizerInitSamples, setOptimizerInitSamples] = useState(10);
	const [optimizerIterSamples, setOptimizerIterSamples] = useState(20);
	const [optimizerFinalRunSamples, setOptimizerFinalRunSamples] = useState(500);
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
		}, competeFight, leadCompetition, duelingRates);
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
	
	const [{courseId, results, runData, chartData, displaying, spurtInfo, staminaStats, firstUmaStats, raceParams}, setSimState] = useReducer(updateResultsState, EMPTY_RESULTS_STATE);
	const setCourseId = setSimState;
	const setResults = setSimState;
	const setChartData = setSimState;

	const [tableData, updateTableData] = useReducer((data,newData) => {
		const merged = new Map();
		if (newData == 'reset') {
			return merged;
		}
		data.forEach((v,k) => merged.set(k,v));
		(newData as any).forEach((v,k) => merged.set(k,v));
		return merged;
	}, new Map());
	const tableDataRef = useRef(tableData);
	const selectedSkillIdRef = useRef('');
	useEffect(() => {
		tableDataRef.current = tableData;
	}, [tableData]);

	const [popoverSkill, setPopoverSkill] = useState('');

	function racesetter(prop) {
		return (value) => setRaceDef(racedef.set(prop, value));
	}

	const course = useMemo(() => CourseHelpers.getCourse(courseId), [courseId]);

	const [uma1, setUma1] = useState(() => new HorseState());
	const [uma2, setUma2] = useState(() => new HorseState());
	const [pacer, setPacer] = useState(() => new HorseState({strategy: 'Nige'}));

	const [lastRunChartUma, setLastRunChartUma] = useState(uma1);

	const [{mode, currentIdx, expanded}, updateUiState] = useReducer(nextUiState, DEFAULT_UI_STATE);
	function toggleExpand(e: Event) {
		e.stopPropagation();
		postEvent('toggleExpand', {expand: !expanded});
		updateUiState(UiStateMsg.ToggleExpand);
	}

	const [loadingAdditionalSamples, setLoadingAdditionalSamples] = useState<Set<string>>(new Set());
	const [additionalSamplesRunCount, setAdditionalSamplesRunCount] = useState<Map<string, number>>(new Map());

	// Create dynamic workers array (max 16 workers)
	const workers = useMemo(() => {
		return Array.from({length: 16}, (_, i) => i + 1).map((workerIndex) => {
			const w = new Worker('./simulator.worker.js');
			w.addEventListener('message', function (e) {
			const {type, results, round, total, skillId, result, completed, totalSkills, iteration, data} = e.data;
			switch (type) {
				case 'compare':
					setResults(results);
					break;
				case 'chart':
					updateTableData(results);
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
						const runData = data.cumulativeResults.runData || null;
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
						// Trigger re-render by setting a dummy progress (we'll display per-worker progress from the ref)
						setSimulationProgress({round: 0, total: 0});
					}
					break;
				case 'compare-progress':
					setSimulationProgress({round: completed, total});
					// Update UI with cumulative results if provided
					if (results) {
						setResults(results);
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
					if (skillId && result) {
						const existingResult = tableDataRef.current.get(skillId);
						if (existingResult) {
							const merged = mergeResults(existingResult, result);
							const updatedMap = new Map(tableDataRef.current);
							updatedMap.set(skillId, merged);
							updateTableData(updatedMap);
							if (selectedSkillIdRef.current === skillId) {
								setResults(merged);
							}
						}
					}
					setLoadingAdditionalSamples(prev => {
						const next = new Set(prev);
						next.delete(skillId);
						return next;
					});
					break;
			}
			});
			return w;
		});
	}, [workerVersion]);

	function loadState() {
		if (window.location.hash) {
			deserialize(window.location.hash.slice(1)).then(o => {
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
			});
		} else {
			loadFromLocalStorage().then(o => {
				if (o) {
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
				}
			});
		}
	}

	useEffect(function () {
		loadState();
		window.addEventListener('hashchange', loadState);
	}, []);

	// Auto-save settings whenever they change
	useEffect(() => {
		autoSaveSettings();
	}, [courseId, nsamples, seed, posKeepMode, racedef, uma1, uma2, pacer, syncRng, skillWisdomCheck, rushedKakari, showVirtualPacemakerOnGraph, pacemakerCount, selectedPacemakerIndices, competeFight, leadCompetition, duelingRates]);
	
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
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates
				}
			}
		});
	}

	function doGlobalComparison() {
		postEvent('doGlobalComparison', {});
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
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates,
					time: racedef.time,
					grade: racedef.grade
				}
			}
		});
	}

	function doRunOnce() {
		postEvent('doRunOnce', {});
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
					syncRng: syncRng,
					skillWisdomCheck: skillWisdomCheck,
					rushedKakari: rushedKakari,
					competeFight: competeFight,
					leadCompetition: leadCompetition,
					duelingRates: duelingRates
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
		setOptimizerInitProgress({completed: 0, total: optimizerInitCount});
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
				maxIterations: optimizerMaxIterations
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
				);
			}), uma1, course, params);

			uma = uma1.toJS();
		}
		
		const filler = new Map();
		skills.forEach(id => filler.set(id, getNullRow(id)));
		
		// Split skills among workers
		const skillsPerWorker = Math.floor(skills.length / workerCount);
		const skillChunks: string[][] = [];
		for (let i = 0; i < workerCount; i++) {
			const start = i * skillsPerWorker;
			const end = i === workerCount - 1 ? skills.length : (i + 1) * skillsPerWorker;
			skillChunks.push(skills.slice(start, end));
		}
		
		updateTableData('reset');
		updateTableData(filler);
		setAdditionalSamplesRunCount(new Map());
		const chartOptions = {
			seed, 
			posKeepMode: PosKeepMode.Approximate, 
			pacemakerCount: 1,
			mode: hpConsumption ? 'compare' : undefined,
			syncRng: hpConsumption ? true : undefined,
			skillWisdomCheck: false,
			rushedKakari: false,
			competeFight: false
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

	const [selectedSkillId, setSelectedSkillId] = useState('');
	useEffect(() => {
		selectedSkillIdRef.current = selectedSkillId;
	}, [selectedSkillId]);

	function basinnChartSelection(skillId) {
		const r = tableData.get(skillId);
		if (r.runData != null) {
			setResults(r);
			setSelectedSkillId(skillId);
		} else {
			setSelectedSkillId('');
		}
	}

	function runAdditionalSamplesForSkill(skillId: string) {
		if (loadingAdditionalSamples.has(skillId) || isSimulationRunning) return;
		
		setLoadingAdditionalSamples(prev => new Set(prev).add(skillId));
		
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
				skillId,
				nsamples: 1000,
				course,
				racedef: params,
				uma,
				pacer: pacer.toJS(),
				options: {
					seed: effectiveSeed,
					posKeepMode: PosKeepMode.Approximate,
					pacemakerCount: 1,
					skillWisdomCheck: false,
					rushedKakari: false
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
		setPopoverSkill(skillId);
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
		if (selectedSkillId && tableData.has(selectedSkillId)) {
			const r = tableData.get(selectedSkillId);
			if (r && r.runData != null) {
				setResults(r);
			}
		}
	}, [tableData, selectedSkillId]);

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
	const tempLabels = [...posKeepData, ...virtualPacemakerPosKeepData, ...competeFightData, ...leadCompetitionData, ...virtualPacemakerLeadCompetitionData, ...downhillData].map(posKeep => ({
		...posKeep,
		x: posKeep.start / courseDistanceForLabels * 960,
		width: posKeep.duration / courseDistanceForLabels * 960,
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
			<div class={`umaTab ${currentIdx == 0 ? 'selected' : ''}`} onClick={() => updateUiState(UiStateMsg.SetCurrentIdx0)}>Umamusume 1</div>
			{(mode == Mode.Compare || mode == Mode.GlobalCompare) && <div class={`umaTab ${currentIdx == 1 ? 'selected' : ''}`} onClick={() => updateUiState(UiStateMsg.SetCurrentIdx1)}>Umamusume 2{posKeepMode != PosKeepMode.Virtual && <div id="expandBtn" title="Expand panel" onClick={toggleExpand} />}</div>}
			{posKeepMode == PosKeepMode.Virtual && (mode == Mode.Compare || mode == Mode.GlobalCompare) && <div class={`umaTab ${currentIdx == 2 ? 'selected' : ''}`} onClick={() => updateUiState(UiStateMsg.SetCurrentIdx2)}>Virtual Pacemaker<div id="expandBtn" title="Expand panel" onClick={toggleExpand} /></div>}
		</Fragment>
	);

	const createExpandedContent = useCallback((skillId: string, runData: any, courseDistance: number) => {
		const currentDisplaying = displaying || 'meanrun';
		let effectivenessRate = 0;
		const totalCount = runData.allruns?.totalRuns || 0;
		let skillProcs = 0;
		if (runData.allruns && runData.allruns.skBasinn && Array.isArray(runData.allruns.skBasinn)) {
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
			<div style="position: relative;">
				<div style={`margin-bottom: 8px; width: 300px;`}>
					<div style={`font-size: 9px; margin-bottom: 2px; display: flex; align-items: center; gap: 8px;`}>
						<span>Total samples: {totalCount} ({skillProcs} skill procs)</span>
						<button 
							class="runAdditionalSamples"
							onClick={(e) => { e.stopPropagation(); runAdditionalSamplesForSkill(skillId); }}
							disabled={loadingAdditionalSamples.has(skillId) || isSimulationRunning}
						>
							{loadingAdditionalSamples.has(skillId) ? 'Running...' : isSimulationRunning ? 'Simulation Running...' : 'Run Additional Samples'}
						</button>
					</div>
					<div style={`font-size: 9px; margin-bottom: 2px;`}>Effectiveness rate: {effectivenessRate.toFixed(1)}%</div>
					<div style={`display: flex; width: 100%; height: 8px; border: 1px solid #ccc; overflow: hidden;`}>
						<div style={`width: ${effectivenessRate}%; background-color: #4caf50; height: 100%;`}></div>
						<div style={`width: ${100 - effectivenessRate}%; background-color: #f44336; height: 100%;`}></div>
					</div>
				</div>
				<div style={`display: flex; gap: 20px; align-items: flex-start;`}>
					<div>
						<LengthDifferenceChart 
							skillId={skillId} 
							runData={runData} 
							courseDistance={courseDistance}
						/>
						<ActivationFrequencyChart 
							skillId={skillId} 
							runData={runData} 
							courseDistance={courseDistance}
						/>
					</div>
					<VelocityChart 
						skillId={skillId} 
						runData={runData}
						courseDistance={courseDistance}
						displaying={currentDisplaying}
					/>
				</div>
				<div style="position: absolute; bottom: 0; right: 0; font-size: 9px; font-style: italic; padding: 4px;">
					(yes these graphs are copied from utools &gt;-&lt;)
				</div>
			</div>
		);
	}, [displaying, loadingAdditionalSamples, isSimulationRunning, runAdditionalSamplesForSkill]);

	let resultsPane;
	if ((mode == Mode.Compare || mode == Mode.GlobalCompare) && results.length > 0) {
		resultsPane = (
			mode == Mode.GlobalCompare ? (
				<div id="globalCompareWrapper" style="display: flex; align-items: flex-start; gap: 20px; grid-column: 1; grid-row: 1;">
					<div id="resultsPane" class="mode-compare global-compare-mode">
					<table id="resultsSummary">
						<tfoot>
							<tr>
								{Object.entries({
									minrun: ['Minimum', 'Set chart display to the run with minimum bashin difference'],
									maxrun: ['Maximum', 'Set chart display to the run with maximum bashin difference'],
									meanrun: ['Mean', 'Set chart display to a run representative of the mean bashin difference'],
									medianrun: ['Median', 'Set chart display to a run representative of the median bashin difference']
								}).map(([k,label]) =>
									<th scope="col" class={displaying == k ? 'selected' : ''} title={label[1]} onClick={() => setChartData(k)}>{label[0]}</th>
								)}
							</tr>
						</tfoot>
						<tbody>
							<tr>
								<td onClick={() => setChartData('minrun')}>{results[0].toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
								<td onClick={() => setChartData('maxrun')}>{results[results.length-1].toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
								<td onClick={() => setChartData('meanrun')}>{mean.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
								<td onClick={() => setChartData('medianrun')}>{median.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
							</tr>
						</tbody>
					</table>
					<div id="resultsHelp">Negative numbers mean <strong style="color:#2a77c5">Umamusume 1</strong> is faster, positive numbers mean <strong style="color:#c52a2a">Umamusume 2</strong> is faster.</div>
					
					
					{(firstUmaStats || staminaStats) && (
						<div style={{marginTop: '15px', marginBottom: '10px', textAlign: 'center'}}>
							{firstUmaStats && (
								<div style={{marginBottom: '2px', display: 'flex', justifyContent: 'center', gap: '40px'}}>
									<div style={{textAlign: 'right', minWidth: '250px'}}>
										<strong>Uma 1:</strong> Final leg 1st place: <span style={{color: '#2a77c5', fontWeight: 'bold'}}>{firstUmaStats.uma1.firstPlaceRate.toFixed(1)}%</span>
									</div>
									<div style={{textAlign: 'left', minWidth: '250px'}}>
										<strong>Uma 2:</strong> Final leg 1st place: <span style={{color: '#c52a2a', fontWeight: 'bold'}}>{firstUmaStats.uma2.firstPlaceRate.toFixed(1)}%</span>
									</div>
								</div>
							)}
							{staminaStats && (
								<>
									<div style={{marginBottom: '2px', display: 'flex', justifyContent: 'center', gap: '40px'}}>
										<div style={{textAlign: 'right', minWidth: '250px'}}>
											<strong>Uma 1:</strong> Spurt Rate: <span style={{color: '#2a77c5', fontWeight: 'bold'}}>{staminaStats.uma1.fullSpurtRate.toFixed(1)}%</span>
										</div>
										<div style={{textAlign: 'left', minWidth: '250px'}}>
											<strong>Uma 2:</strong> Spurt Rate: <span style={{color: '#c52a2a', fontWeight: 'bold'}}>{staminaStats.uma2.fullSpurtRate.toFixed(1)}%</span>
										</div>
									</div>
									<div style={{marginBottom: '2px', display: 'flex', justifyContent: 'center', gap: '40px'}}>
										<div style={{textAlign: 'right', minWidth: '250px'}}>
											<strong>Uma 1:</strong> Survival Rate: <span style={{color: '#2a77c5', fontWeight: 'bold'}}>{staminaStats.uma1.staminaSurvivalRate.toFixed(1)}%</span>
										</div>
										<div style={{textAlign: 'left', minWidth: '250px'}}>
											<strong>Uma 2:</strong> Survival Rate: <span style={{color: '#c52a2a', fontWeight: 'bold'}}>{staminaStats.uma2.staminaSurvivalRate.toFixed(1)}%</span>
										</div>
									</div>
								</>
							)}
						</div>
					)}
					
					<Histogram width={500} height={333} data={results} />
					{staminaStats && (
						<div style={{marginTop: '20px', width: '500px', paddingBottom: '20px'}}>
							<div style={{display: 'flex', marginBottom: '0'}}>
								<div 
									class={`umaTab staminaTab ${hpDeathPositionTab == 0 ? 'selected' : ''}`} 
									onClick={() => setHpDeathPositionTab(0)}
									style={{cursor: 'pointer'}}
								>
									Uma 1
								</div>
								<div 
									class={`umaTab staminaTab ${hpDeathPositionTab == 1 ? 'selected' : ''}`} 
									onClick={() => setHpDeathPositionTab(1)}
									style={{cursor: 'pointer'}}
								>
									Uma 2
								</div>
							</div>
							{hpDeathPositionTab == 0 && (
								<>
									<StatsTable 
										caption="Stamina Death Stats"
										captionColor="#2a77c5"
										rows={[
											{ label: 'Full Spurt', stats: staminaStats.uma1.hpDiedPositionStatsFullSpurt },
											{ label: 'Non-Full Spurt', stats: staminaStats.uma1.hpDiedPositionStatsNonFullSpurt }
										]}
									/>
									{staminaStats.uma1.nonFullSpurtVelocityStats && staminaStats.uma1.nonFullSpurtDelayStats && (
										<StatsTable 
											caption="Non-Full Spurt Stats"
											captionColor="#2a77c5"
											rows={[
												{ label: 'Velocity', stats: staminaStats.uma1.nonFullSpurtVelocityStats },
												{ label: 'Delay', stats: staminaStats.uma1.nonFullSpurtDelayStats }
											]}
										/>
									)}
								</>
							)}
							{hpDeathPositionTab == 1 && (
								<>
									<StatsTable 
										caption="Stamina Death Stats"
										captionColor="#c52a2a"
										rows={[
											{ label: 'Full Spurt', stats: staminaStats.uma2.hpDiedPositionStatsFullSpurt },
											{ label: 'Non-Full Spurt', stats: staminaStats.uma2.hpDiedPositionStatsNonFullSpurt }
										]}
									/>
									{staminaStats.uma2.nonFullSpurtVelocityStats && staminaStats.uma2.nonFullSpurtDelayStats && (
										<StatsTable 
											caption="Non-Full Spurt Stats"
											captionColor="#c52a2a"
											rows={[
												{ label: 'Velocity', stats: staminaStats.uma2.nonFullSpurtVelocityStats },
												{ label: 'Delay', stats: staminaStats.uma2.nonFullSpurtDelayStats }
											]}
										/>
									)}
								</>
							)}
						</div>
					)}
					</div>
					<div id="infoTables">
						<ResultsTable caption="Umamusume 1" color="#2a77c5" chartData={chartData} idx={0} runData={runData} />
						<ResultsTable caption="Umamusume 2" color="#c52a2a" chartData={chartData} idx={1} runData={runData} />
						{mode == Mode.GlobalCompare && raceParams && (() => {
							// Group results by parameter value and calculate statistics for each value
							const groupByValue = <T,>(data: Array<{value: T, result: number}>, getLabel: (val: T) => string, sortFn?: (a: T, b: T) => number) => {
								const grouped = new Map<string, number[]>();
								data.forEach(({value, result}) => {
									const key = getLabel(value);
									if (!grouped.has(key)) {
										grouped.set(key, []);
									}
									grouped.get(key)!.push(result);
								});

								// Calculate stats for each group
								const stats = Array.from(grouped.entries()).map(([label, results]) => {
									const sorted = [...results].sort((a, b) => a - b);
									const count = results.length;
									const min = sorted[0];
									const max = sorted[sorted.length - 1];
									const mean = results.reduce((a, b) => a + b, 0) / results.length;
									const mid = Math.floor(sorted.length / 2);
									const median = sorted.length % 2 === 0 
										? (sorted[mid - 1] + sorted[mid]) / 2 
										: sorted[mid];
									return { label, stats: { count, min, max, mean, median } };
								});

								// Sort by label or value if sortFn provided
								if (sortFn) {
									// Extract original values and sort
									const valueMap = new Map<string, T>();
									data.forEach(({value}) => {
										const key = getLabel(value);
										if (!valueMap.has(key)) {
											valueMap.set(key, value);
										}
									});
									stats.sort((a, b) => {
										const valA = valueMap.get(a.label)!;
										const valB = valueMap.get(b.label)!;
										return sortFn(valA, valB);
									});
								} else {
									stats.sort((a, b) => a.label.localeCompare(b.label));
								}

								return stats;
							};

							// Helper functions to convert enum values to labels
							const getLocationName = (trackIdStr: string) => TRACKNAMES_en[+trackIdStr] || trackIdStr;
							const getTerrainLabel = (terrain: number) => {
								const labels = ['', 'Firm', 'Good', 'Soft', 'Heavy'];
								return labels[terrain] || terrain.toString();
							};
							const getWeatherLabel = (weather: number) => {
								const labels = ['', 'Sunny', 'Cloudy', 'Rainy', 'Snowy'];
								return labels[weather] || weather.toString();
							};
							const getSeasonLabel = (season: number) => {
								const labels = ['', 'Spring', 'Summer', 'Autumn', 'Winter', 'Sakura'];
								return labels[season] || season.toString();
							};

							const locationRows = groupByValue(raceParams.locations || [], getLocationName);
							const lengthRows = groupByValue(raceParams.lengths || [], (val: number) => val.toString() + ' m', (a, b) => a - b);
							const terrainRows = groupByValue(raceParams.terrains || [], getTerrainLabel);
							const weatherRows = groupByValue(raceParams.weathers || [], getWeatherLabel);
							const seasonRows = groupByValue(raceParams.seasons || [], getSeasonLabel);

							return (
								<div style={{marginTop: '20px', width: '100%'}}>
									{locationRows.length > 0 && (
										<StatsTable
											key="location-table"
											caption="Racetrack Location"
											captionColor="#666"
											rows={locationRows}
											enableSorting={true}
										/>
									)}
									{lengthRows.length > 0 && (
										<StatsTable
											key="length-table"
											caption="Racetrack Length"
											captionColor="#666"
											rows={lengthRows}
											enableSorting={true}
										/>
									)}
									{terrainRows.length > 0 && (
										<StatsTable
											key="terrain-table"
											caption="Terrain Condition"
											captionColor="#666"
											rows={terrainRows}
											enableSorting={true}
										/>
									)}
									{weatherRows.length > 0 && (
										<StatsTable
											key="weather-table"
											caption="Weather Condition"
											captionColor="#666"
											rows={weatherRows}
											enableSorting={true}
										/>
									)}
									{seasonRows.length > 0 && (
										<StatsTable
											key="season-table"
											caption="Season Condition"
											captionColor="#666"
											rows={seasonRows}
											enableSorting={true}
										/>
									)}
								</div>
							);
						})()}
					</div>
				</div>
			) : (
				<div id="resultsPaneWrapper" style={{marginTop: '80px'}}>
					<div id="resultsPane" class="mode-compare" key="compare-results">
						<table id="resultsSummary">
							<tfoot>
								<tr>
									{Object.entries({
										minrun: ['Minimum', 'Set chart display to the run with minimum bashin difference'],
										maxrun: ['Maximum', 'Set chart display to the run with maximum bashin difference'],
										meanrun: ['Mean', 'Set chart display to a run representative of the mean bashin difference'],
										medianrun: ['Median', 'Set chart display to a run representative of the median bashin difference']
									}).map(([k,label]) =>
										<th scope="col" class={displaying == k ? 'selected' : ''} title={label[1]} onClick={() => setChartData(k)}>{label[0]}</th>
									)}
								</tr>
							</tfoot>
							<tbody>
								<tr>
									<td onClick={() => setChartData('minrun')}>{results[0].toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
									<td onClick={() => setChartData('maxrun')}>{results[results.length-1].toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
									<td onClick={() => setChartData('meanrun')}>{mean.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
									<td onClick={() => setChartData('medianrun')}>{median.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
								</tr>
							</tbody>
						</table>
						<div id="resultsHelp">Negative numbers mean <strong style="color:#2a77c5">Umamusume 1</strong> is faster, positive numbers mean <strong style="color:#c52a2a">Umamusume 2</strong> is faster.</div>
						
						
						{(firstUmaStats || staminaStats) && (
							<div style={{marginTop: '15px', marginBottom: '10px', textAlign: 'center'}}>
								{firstUmaStats && (
									<div style={{marginBottom: '2px', display: 'flex', justifyContent: 'center', gap: '40px'}}>
										<div style={{textAlign: 'right', minWidth: '250px'}}>
											<strong>Uma 1:</strong> Final leg 1st place: <span style={{color: '#2a77c5', fontWeight: 'bold'}}>{firstUmaStats.uma1.firstPlaceRate.toFixed(1)}%</span>
										</div>
										<div style={{textAlign: 'left', minWidth: '250px'}}>
											<strong>Uma 2:</strong> Final leg 1st place: <span style={{color: '#c52a2a', fontWeight: 'bold'}}>{firstUmaStats.uma2.firstPlaceRate.toFixed(1)}%</span>
										</div>
									</div>
								)}
								{staminaStats && (
									<>
										<div style={{marginBottom: '2px', display: 'flex', justifyContent: 'center', gap: '40px'}}>
											<div style={{textAlign: 'right', minWidth: '250px'}}>
												<strong>Uma 1:</strong> Spurt Rate: <span style={{color: '#2a77c5', fontWeight: 'bold'}}>{staminaStats.uma1.fullSpurtRate.toFixed(1)}%</span>
											</div>
											<div style={{textAlign: 'left', minWidth: '250px'}}>
												<strong>Uma 2:</strong> Spurt Rate: <span style={{color: '#c52a2a', fontWeight: 'bold'}}>{staminaStats.uma2.fullSpurtRate.toFixed(1)}%</span>
											</div>
										</div>
										<div style={{marginBottom: '2px', display: 'flex', justifyContent: 'center', gap: '40px'}}>
											<div style={{textAlign: 'right', minWidth: '250px'}}>
												<strong>Uma 1:</strong> Survival Rate: <span style={{color: '#2a77c5', fontWeight: 'bold'}}>{staminaStats.uma1.staminaSurvivalRate.toFixed(1)}%</span>
											</div>
											<div style={{textAlign: 'left', minWidth: '250px'}}>
												<strong>Uma 2:</strong> Survival Rate: <span style={{color: '#c52a2a', fontWeight: 'bold'}}>{staminaStats.uma2.staminaSurvivalRate.toFixed(1)}%</span>
											</div>
										</div>
									</>
								)}
							</div>
						)}
						
						<Histogram width={500} height={333} data={results} />
						{staminaStats && (
							<div style={{marginTop: '20px', width: '500px', paddingBottom: '20px'}}>
								<div style={{display: 'flex', marginBottom: '0'}}>
									<div 
										class={`umaTab staminaTab ${hpDeathPositionTab == 0 ? 'selected' : ''}`} 
										onClick={() => setHpDeathPositionTab(0)}
										style={{cursor: 'pointer'}}
									>
										Uma 1
									</div>
									<div 
										class={`umaTab staminaTab ${hpDeathPositionTab == 1 ? 'selected' : ''}`} 
										onClick={() => setHpDeathPositionTab(1)}
										style={{cursor: 'pointer'}}
									>
										Uma 2
									</div>
								</div>
								{hpDeathPositionTab == 0 && (
									<>
										<StatsTable 
											caption="Stamina Death Stats"
											captionColor="#2a77c5"
											rows={[
												{ label: 'Full Spurt', stats: staminaStats.uma1.hpDiedPositionStatsFullSpurt },
												{ label: 'Non-Full Spurt', stats: staminaStats.uma1.hpDiedPositionStatsNonFullSpurt }
											]}
										/>
										{staminaStats.uma1.nonFullSpurtVelocityStats && staminaStats.uma1.nonFullSpurtDelayStats && (
											<StatsTable 
												caption="Non-Full Spurt Stats"
												captionColor="#2a77c5"
												rows={[
													{ label: 'Velocity', stats: staminaStats.uma1.nonFullSpurtVelocityStats },
													{ label: 'Delay', stats: staminaStats.uma1.nonFullSpurtDelayStats }
												]}
											/>
										)}
									</>
								)}
								{hpDeathPositionTab == 1 && (
									<>
										<StatsTable 
											caption="Stamina Death Stats"
											captionColor="#c52a2a"
											rows={[
												{ label: 'Full Spurt', stats: staminaStats.uma2.hpDiedPositionStatsFullSpurt },
												{ label: 'Non-Full Spurt', stats: staminaStats.uma2.hpDiedPositionStatsNonFullSpurt }
											]}
										/>
										{staminaStats.uma2.nonFullSpurtVelocityStats && staminaStats.uma2.nonFullSpurtDelayStats && (
											<StatsTable 
												caption="Non-Full Spurt Stats"
												captionColor="#c52a2a"
												rows={[
													{ label: 'Velocity', stats: staminaStats.uma2.nonFullSpurtVelocityStats },
													{ label: 'Delay', stats: staminaStats.uma2.nonFullSpurtDelayStats }
												]}
											/>
										)}
									</>
								)}
							</div>
						)}
					</div>
					<div id="infoTables">
						<ResultsTable caption="Umamusume 1" color="#2a77c5" chartData={chartData} idx={0} runData={runData} />
						<ResultsTable caption="Umamusume 2" color="#c52a2a" chartData={chartData} idx={1} runData={runData} />
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
			<div id="resultsPaneWrapper" style={{flexDirection: 'column'}}>
				{/* Stats bar (below track + selectors, above summary bubbles) */}
				<OptimizerStatsBar stats={displayStats} careerRating={displayCareerRating} onLoadToUma1={loadOptimizedIntoUma1} />
				<div style={{display: 'flex', width: '980px', maxWidth: '980px', alignItems: 'flex-start', marginBottom: '8px'}}>
					<div id="resultsPane" class="mode-compare" key="optimizer-results" style={{width: '500px', marginRight: '16px'}}>
						<table id="resultsSummary">
							<tfoot>
								<tr>
									{Object.entries({
										minrun: ['Minimum', 'Set chart display to the run with minimum bashin difference'],
										maxrun: ['Maximum', 'Set chart display to the run with maximum bashin difference'],
										meanrun: ['Mean', 'Set chart display to a run representative of the mean bashin difference'],
										medianrun: ['Median', 'Set chart display to a run representative of the median bashin difference']
									}).map(([k,label]) =>
										<th scope="col" class={optimizerDisplaying == k ? 'selected' : ''} title={label[1]} onClick={() => setOptimizerChart(k as any)}>{label[0]}</th>
									)}
								</tr>
							</tfoot>
							<tbody>
								<tr>
									<td onClick={() => setOptimizerChart('minrun')}>{marginStats.min.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
									<td onClick={() => setOptimizerChart('maxrun')}>{marginStats.max.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
									<td onClick={() => setOptimizerChart('meanrun')}>{marginStats.mean.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
									<td onClick={() => setOptimizerChart('medianrun')}>{marginStats.median.toFixed(2)}<span class="unit-basinn">{CC_GLOBAL?'lengths':'バ身'}</span></td>
								</tr>
							</tbody>
						</table>
					<div id="resultsHelp" style="text-align: center;">
							Negative numbers mean <strong style="color:#2a77c5">Optimized Umamusume</strong> is faster, positive numbers mean the <strong style="color:#c52a2a">Reference Uma (Uma 1 input)</strong> is faster.
						</div>
						<div style={{marginLeft: '10px'}}>
							<Histogram width={500} height={333} data={diffs} />
						</div>
					</div>
					<div id="infoTables" style={{width: '460px', display: 'flex', flexDirection: 'column', gap: '10px', alignSelf: 'flex-start', transform: 'translate(20px, -60px)'}}>
						{/* Same relative spot as Uma 1 table in Race Compare */}
						<ResultsTable caption="Optimized Umamusume" color="#2a77c5" chartData={optimizerChartData} idx={0} runData={optimizerRunData} />
					</div>
				</div>
				<div style={{width: '980px', maxWidth: '980px'}}>
					{/* Graphs */}
					<OptimizerGraphs iterations={optimizerIterations} evaluationMethod={optimizerEvaluationMethod} width={420} />
				</div>
			</div>
		);
	} else if ((mode == Mode.Chart || mode == Mode.UniquesChart) && tableData.size > 0) {
		const dirty = !uma1.equals(lastRunChartUma);
		resultsPane = (
			<div id="resultsPaneWrapper">
				<div id="resultsPane" class="mode-chart">
					<div class="basinnChartWrapperWrapper">
						<BasinnChart 
							data={Array.from(tableData.values())} 
							dirty={dirty}
							hidden={mode == Mode.Chart ? uma1.skills : new Set()}
							onSelectionChange={basinnChartSelection}
							onRunTypeChange={setChartData}
							onDblClickRow={addSkillFromTable}
							onInfoClick={showPopover}
							showUmaIcons={mode == Mode.UniquesChart}
							courseDistance={course.distance}
							expandedContent={createExpandedContent}
						/>
						<button class={`basinnChartRefresh${dirty ? '' : ' hidden'}`} onClick={doBasinnChart} disabled={isSimulationRunning || loadingAdditionalSamples.size > 0}>⟲</button>
						<div class={`basinnChartRefreshText${dirty ? '' : ' hidden'}`}>Uma skills have changed, refresh is required</div>
					</div>
				</div>
			</div>
		);
	} else if (CC_GLOBAL) {
		resultsPane = (
			<div id="resultsPaneWrapper">
				<div id="resultsPane">
					<IntroText />
				</div>
			</div>
		);
	} else {
		resultsPane = null;
	}

	return (
		<Language.Provider value={props.lang}>
			<IntlProvider definition={strings}>
				<div id="topPane" class={chartData || optimizerChartData ? 'hasResults' : ''}>
					{mode != Mode.GlobalCompare && (
						<RaceTrack courseid={courseId} width={960} height={240} xOffset={20} yOffset={15} yExtra={20} mouseMove={rtMouseMove} mouseLeave={rtMouseLeave} onSkillDrag={handleSkillDrag} regions={mode == Mode.RaceOptimizer && optimizerChartData ? (() => {
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
							<VelocityLines data={mode == Mode.RaceOptimizer ? optimizerChartData : chartData} courseDistance={course.distance} width={960} height={250} xOffset={20} showHp={showHp} showLanes={mode == Mode.Compare ? showLanes : false} horseLane={course.horseLane} showVirtualPacemaker={showVirtualPacemakerOnGraph && posKeepMode === PosKeepMode.Virtual} selectedPacemakers={getSelectedPacemakers()} />
						
						<g id="rtMouseOverBox" style="display:none">
							<text id="rtV1" x="25" y="10" fill="#2a77c5" font-size="10px"></text>
							<text id="rtV2" x="25" y="20" fill="#c52a2a" font-size="10px"></text>
							<text id="rtVp" x="25" y="30" fill="#22c55e" font-size="10px"></text>
							<text id="pd1" x="25" y="10" fill="#2a77c5" font-size="10px"></text>
							<text id="pd2" x="25" y="20" fill="#c52a2a" font-size="10px"></text>
						</g>
					</RaceTrack>
					)}
					{mode == Mode.GlobalCompare && results.length > 0 ? resultsPane : null}
					{mode == Mode.GlobalCompare && results.length === 0 ? (
						<div style={{width: '980px', height: '240px', visibility: 'hidden', pointerEvents: 'none'}}></div>
					) : null}
					<div id="runPane">
						<fieldset>
							<legend>Mode:</legend>
							<div>
								<input type="radio" id="mode-compare" name="mode" value="compare" checked={mode == Mode.Compare} onClick={() => updateUiState(UiStateMsg.SetModeCompare)} />
								<label for="mode-compare">Race Compare</label>
							</div>
							<div>
								<input type="radio" id="mode-global-compare" name="mode" value="global-compare" checked={mode == Mode.GlobalCompare} onClick={() => updateUiState(UiStateMsg.SetModeGlobalCompare)} />
								<label for="mode-global-compare">Global Compare</label>
							</div>
							<div>
								<input type="radio" id="mode-chart" name="mode" value="chart" checked={mode == Mode.Chart} onClick={() => updateUiState(UiStateMsg.SetModeChart)} />
								<label for="mode-chart">Skill Chart</label>
							</div>
							<div>
								<input type="radio" id="mode-uniques-chart" name="mode" value="uniques-chart" checked={mode == Mode.UniquesChart} onClick={() => updateUiState(UiStateMsg.SetModeUniquesChart)} />
								<label for="mode-uniques-chart">Uma Chart</label>
							</div>
							<div>
								<input type="radio" id="mode-race-optimizer" name="mode" value="race-optimizer" checked={mode == Mode.RaceOptimizer} onClick={() => updateUiState(UiStateMsg.SetModeRaceOptimizer)} />
								<label for="mode-race-optimizer">Race Optimizer</label>
							</div>
						</fieldset>
						{mode == Mode.GlobalCompare && (
							<>
								<fieldset id="globalDistanceFieldset" style="border: 1px solid rgb(148, 150, 189); border-radius: 8px; padding: 8px; margin: 5px 0;">
									<legend style="padding: 0 5px;">Distance:</legend>
									<select id="global-distance" value={globalCompareDistance} onInput={(e) => setGlobalCompareDistance(+e.currentTarget.value)} tabindex={2} style="background: none; border: 1px solid rgb(148, 150, 189); border-radius: 4px; padding: 4px 8px; width: 100%;">
										<option value={DistanceType.Short}>Sprint (≤1400m)</option>
										<option value={DistanceType.Mile}>Mile (1401-1800m)</option>
										<option value={DistanceType.Mid}>Medium (1801-2400m)</option>
										<option value={DistanceType.Long}>Long (≥2400m)</option>
									</select>
								</fieldset>
								<fieldset id="globalTerrainFieldset" style="border: 1px solid rgb(148, 150, 189); border-radius: 8px; padding: 8px; margin: 5px 0;">
									<legend style="padding: 0 5px;">Terrain:</legend>
									<select id="global-terrain" value={globalCompareTerrain} onInput={(e) => setGlobalCompareTerrain(+e.currentTarget.value)} tabindex={3} style="background: none; border: 1px solid rgb(148, 150, 189); border-radius: 4px; padding: 4px 8px; width: 100%;">
										<option value={Surface.Turf}>Turf</option>
										<option value={Surface.Dirt}>Dirt</option>
									</select>
								</fieldset>
							</>
						)}
						{mode == Mode.RaceOptimizer && (
							<fieldset id="optimizerFieldset" style="border: 1px solid rgb(148, 150, 189); border-radius: 8px; padding: 8px; margin: 5px 0;">
								<legend style="padding: 0 5px;">Optimizer Settings:</legend>
								<div style="display: flex; flex-direction: column; gap: 8px;">
									<label>
										Max Career Rating:
										<input type="number" value={maxCareerRating} onInput={(e) => setMaxCareerRating(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" />
									</label>
									<label>
										<span>Use Reference as Initial Condition</span>
										<input type="checkbox" checked={optimizerUseReferenceInit} onInput={(e) => setOptimizerUseReferenceInit(e.currentTarget.checked)} style="margin-left: 8px;" />
									</label>
									{!optimizerUseReferenceInit && (
										<>
											<label>
												Initializations:
												<input type="number" value={optimizerInitCount} onInput={(e) => setOptimizerInitCount(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" min="1" max="500" />
											</label>
											<label>
												Samples per Initialization:
												<input type="number" value={optimizerInitSamples} onInput={(e) => setOptimizerInitSamples(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" min="1" max="500" />
											</label>
										</>
									)}
									<label>
										Number of Iterations:
										<input type="number" value={optimizerMaxIterations} onInput={(e) => setOptimizerMaxIterations(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" min="1" max="200" />
									</label>
									<label>
										Samples per Iteration:
										<input type="number" value={optimizerIterSamples} onInput={(e) => setOptimizerIterSamples(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" min="1" max="500" />
									</label>
									<label>
										Final Run Samples:
										<input type="number" value={optimizerFinalRunSamples} onInput={(e) => setOptimizerFinalRunSamples(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" min="1" max="1000" />
									</label>
									<label>
										Evaluation Method:
										<select value={optimizerEvaluationMethod} onInput={(e) => setOptimizerEvaluationMethod(e.currentTarget.value as 'mean' | 'median' | 'aggregate')} style="margin-left: 8px;">
											<option value="median">Median</option>
											<option value="mean">Mean</option>
											<option value="aggregate">Aggregate</option>
										</select>
									</label>
									<label>
										Stat Lower Bound:
										<input type="number" value={optimizerMinStat} onInput={(e) => setOptimizerMinStat(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" min="0" max="2000" />
									</label>
									<label>
										Stat Upper Bound:
										<input type="number" value={optimizerMaxStat} onInput={(e) => setOptimizerMaxStat(+e.currentTarget.value)} style="margin-left: 8px; width: 100px;" min="0" max="2000" />
									</label>
								</div>
							</fieldset>
						)}
						{
							isSimulationRunning
							? <button id="run" class="abort-button" onClick={abortSimulation} tabindex={1}>ABORT</button>
							: mode == Mode.Compare
							? <button id="run" onClick={doComparison} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>COMPARE</button>
							: mode == Mode.GlobalCompare
							? <button id="run" onClick={doGlobalComparison} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>GLOBAL COMPARE</button>
							: mode == Mode.RaceOptimizer
							? <button id="run" onClick={doOptimizer} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>OPTIMIZE</button>
							: <button id="run" onClick={doBasinnChart} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>
								RUN
							</button>
						}
						{
							mode == Mode.Compare && !isSimulationRunning
							? <button id="runOnce" onClick={doRunOnce} tabindex={1} disabled={loadingAdditionalSamples.size > 0}>Run Once</button>
							: null
						}
						{mode != Mode.RaceOptimizer && (
							<>
								<label for="nsamples">Samples:</label>
								<input type="number" id="nsamples" min="1" max="10000" value={nsamples} onInput={(e) => setSamples(+e.currentTarget.value)} />
							</>
						)}
						{(mode == Mode.Chart || mode == Mode.UniquesChart) && (
							<>
								<label for="workerCount">Workers:</label>
								<input type="number" id="workerCount" min="1" max="16" value={workerCount} onInput={(e) => setWorkerCount(Math.max(1, Math.min(16, +e.currentTarget.value)))} />
							</>
						)}
						{(mode == Mode.Compare || mode == Mode.GlobalCompare) && isSimulationRunning && simulationProgress && (
							<div id="compareProgressBar">
								<div id="compareProgressBarFill" style={`width: ${(simulationProgress.round / simulationProgress.total) * 100}%`}></div>
								<span id="compareProgressText">{simulationProgress.round} / {simulationProgress.total}</span>
							</div>
						)}
						{mode == Mode.RaceOptimizer && isSimulationRunning && (optimizerProgress || optimizerInitProgress || optimizerFinalProgress) && (
							<div id="compareProgressBar">
								<div
									id="compareProgressBarFill"
									style={
										optimizerPhase === 'init' && optimizerInitProgress
											? `width: ${(optimizerInitProgress.completed / optimizerInitProgress.total) * 100}%`
											: optimizerPhase === 'final' && optimizerFinalProgress
											? `width: ${(optimizerFinalProgress.completed / optimizerFinalProgress.total) * 100}%`
											: optimizerProgress
											? `width: ${(optimizerProgress.iteration / optimizerMaxIterations) * 100}%`
											: 'width: 0%'
									}
								></div>
								<span id="compareProgressText" style="white-space: nowrap;">
									{optimizerPhase === 'init' && optimizerInitProgress
										? `Initializing ${optimizerInitProgress.completed} / ${optimizerInitProgress.total}`
										: optimizerPhase === 'final' && optimizerFinalProgress
										? `Running Final Samples ${optimizerFinalProgress.completed} / ${optimizerFinalProgress.total}`
										: optimizerProgress
										? `Iteration ${optimizerProgress.iteration} / ${optimizerMaxIterations}`
										: ''}
								</span>
							</div>
						)}
						{(mode == Mode.Chart || mode == Mode.UniquesChart) && isSimulationRunning && (
							<div id="chartProgressBarsContainer" style="display: flex; flex-direction: column; gap: 4px; margin: 5px 0;">
								{Array.from({length: workerCount}, (_, i) => {
									const workerIndex = i + 1;
									const progress = chartWorkersProgressRef.current.get(workerIndex);
									const isCompleted = chartWorkersCompletedSetRef.current.has(workerIndex);
									
									if (!progress && !isCompleted) return null;
									
									// Color per round: 1=blue, 2=teal, 3=orange, 4=soft red
									const roundColors = {
										1: 'linear-gradient(90deg, #3b82f6, #2563eb)',
										2: 'linear-gradient(90deg, #14b8a6, #0d9488)',
										3: 'linear-gradient(90deg, #f59e0b, #d97706)',
										4: 'linear-gradient(90deg, #fca5a5, #f87171)'
									};
									const color = isCompleted ? 'linear-gradient(90deg, #10b981, #059669)' : (roundColors[progress?.round] || roundColors[1]);
									
									return (
										<div key={workerIndex} id="compareProgressBar" style="position: relative;">
											<div id="compareProgressBarFill" style={`width: ${isCompleted ? 100 : (progress.completed / progress.totalSkills) * 100}%; background: ${color};`}></div>
											<span id="compareProgressText">
												{isCompleted ? 'Completed!' : `Run ${progress.round}: ${progress.completed} / ${progress.totalSkills} Skills`}
											</span>
										</div>
									);
								})}
							</div>
						)}
						<label for="seed">Seed:</label>
						<div id="seedWrapper">
							<input type="number" id="seed" value={seed} onInput={(e) => { setSeed(+e.currentTarget.value); setRunOnceCounter(0); }} />
							<button title="Randomize seed" onClick={() => { setSeed(Math.floor(Math.random() * (-1 >>> 0)) >>> 0); setRunOnceCounter(0); }}>🎲</button>
						</div>
						{(mode == Mode.Compare || mode == Mode.GlobalCompare || mode == Mode.RaceOptimizer) && (
							<fieldset id="posKeepFieldset">
								<legend>Position Keep:</legend>
								<select id="poskeepmode" value={posKeepMode} onInput={(e) => setPosKeepMode(+e.currentTarget.value)}>
									<option value={PosKeepMode.None}>None</option>
									<option value={PosKeepMode.Approximate}>Approximate</option>
									<option value={PosKeepMode.Virtual}>Virtual Pacemaker</option>
								</select>
								{posKeepMode == PosKeepMode.Approximate && (
									<div id="pacemakerIndicator">
										<span>Using default pacemaker</span>
									</div>
								)}
								{posKeepMode == PosKeepMode.Virtual && (
									<div id="pacemakerIndicator">
										<div>
											<label>Show Pacemakers:</label>
											<div className="pacemaker-combobox">
												<button 
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
																<input 
																	type="checkbox" 
																	checked={selectedPacemakerIndices.includes(index)}
																	onChange={() => togglePacemakerSelection(index)}
																/>
																<span style={{color: index === 0 ? '#22c55e' : index === 1 ? '#a855f7' : '#ec4899'}}>
																	Pacemaker {index + 1}
																</span>
															</label>
														))}
													</div>
												)}
											</div>
										</div>
										<div id="pacemakerCountControl">
											<label for="pacemakercount">Number of pacemakers: {pacemakerCount}</label>
											<input 
												type="range" 
												id="pacemakercount" 
												min="1" 
												max="3" 
												value={pacemakerCount} 
												onInput={(e) => handlePacemakerCountChange(+e.currentTarget.value)} 
											/>
										</div>
									</div>
								)}
							</fieldset>
						)}
						{/**
						{mode == Mode.Compare && (
							<div>
								<label for="showlanes">Show Lanes</label>
								<input type="checkbox" id="showlanes" checked={showLanes} onClick={toggleShowLanes} />
							</div>
						)} **/}
						{(mode == Mode.Compare || mode == Mode.GlobalCompare || mode == Mode.RaceOptimizer) && (
							<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0;">
								<div style="display: flex; flex-direction: column; gap: 0;">
									<div>
										<label for="syncRng">Sync RNG</label>
										<input type="checkbox" id="syncRng" checked={syncRng} onClick={handleSyncRngToggle} />
									</div>
									<div>
										<label for="skillWisdomCheck">Skill Wit Check</label>
										<input type="checkbox" id="skillWisdomCheck" checked={skillWisdomCheck} onClick={handleSkillWisdomCheckToggle} />
									</div>
									<div>
										<label for="rushedKakari">Rushed / Kakari</label>
										<input type="checkbox" id="rushedKakari" checked={rushedKakari} onClick={handleRushedKakariToggle} />
									</div>
								</div>
								<div style="display: flex; flex-direction: column; gap: 0;">
									<div>
										<label for="leadCompetition">Spot Struggle</label>
										<input type="checkbox" id="leadCompetition" checked={leadCompetition} onClick={() => setLeadCompetition(!leadCompetition)} />
									</div>
									<div style="display: flex; align-items: center; gap: 8px;">
										<label for="competeFight">Dueling</label>
										<input type="checkbox" id="competeFight" checked={competeFight} onClick={() => setCompeteFight(!competeFight)} />
										<button 
											type="button"
											onClick={() => setDuelingConfigOpen(true)}
											style="background: rgb(248, 248, 248); border: 1px solid rgb(148, 150, 189); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; line-height: 1; height: auto; color: rgb(51, 51, 51); font-weight: 500; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; min-width: 28px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);"
											onMouseOver={(e) => { e.currentTarget.style.background = 'rgb(240, 240, 240)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'; }}
											onMouseOut={(e) => { e.currentTarget.style.background = 'rgb(248, 248, 248)'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; }}
											onMouseDown={(e) => e.currentTarget.style.background = 'rgb(232, 232, 232)'}
											onMouseUp={(e) => e.currentTarget.style.background = 'rgb(240, 240, 240)'}
											title="Configure dueling rates"
										>
											<Settings size={14} />
										</button>
									</div>
								</div>
							</div>
						)}
						{(mode == Mode.Chart || mode == Mode.UniquesChart) && (
							<div>
								<label for="hpconsumption">HP Consumption</label>
								<input type="checkbox" id="hpconsumption" checked={hpConsumption} onClick={toggleHpConsumption} />
							</div>
						)}
						{mode != Mode.GlobalCompare && (
							<div>
								<label for="showhp">Show HP</label>
								<input type="checkbox" id="showhp" checked={showHp} onClick={toggleShowHp} />
							</div>
						)}

						<a href="#" onClick={generatePresetEntry}>Generate and Copy Preset Entry</a>
						{mode != Mode.GlobalCompare && (
							<RacePresets courseId={courseId} racedef={racedef} set={(courseId, racedef) => { setCourseId(courseId); setRaceDef(racedef); }} />
						)}
					</div>
					{mode != Mode.GlobalCompare && (
						<div id="buttonsRow">
							<TrackSelect key={courseId} courseid={courseId} setCourseid={setCourseId} tabindex={2} />
							<div id="buttonsRowSpace" />
							<TimeOfDaySelect value={racedef.time} set={racesetter('time')} />
							<div>
								<GroundSelect value={racedef.ground} set={racesetter('ground')} />
								<WeatherSelect value={racedef.weather} set={racesetter('weather')} />
							</div>
							<SeasonSelect value={racedef.season} set={racesetter('season')} />
						</div>
					)}
				</div>
				{mode != Mode.GlobalCompare && mode != Mode.RaceOptimizer && resultsPane}
				{mode == Mode.RaceOptimizer && optimizerIterations.length > 0 && resultsPane}
				{expanded && <div id="umaPane" />}
				<div id={expanded ? 'umaOverlay' : 'umaPane'}>
					<div class={!expanded && currentIdx == 0 ? 'selected' : ''}>
						<HorseDef key={uma1.outfitId} state={uma1} setState={setUma1} courseDistance={mode == Mode.GlobalCompare ? 1600 : course.distance} tabstart={() => 4} onResetAll={resetAllUmas} runData={(mode == Mode.Compare || mode == Mode.GlobalCompare) ? runData : null} umaIndex={(mode == Mode.Compare || mode == Mode.GlobalCompare) ? 0 : null} disableStats={false}>
							{expanded ? 'Umamusume 1' : umaTabs}
						</HorseDef>
					</div>
					{expanded &&
						<div id="copyUmaButtons">
							<div id="copyUmaToRight" title="Copy uma 1 to uma 2" onClick={copyUmaToRight} />
							<div id="copyUmaToLeft" title="Copy uma 2 to uma 1" onClick={copyUmaToLeft} />
							<div id="swapUmas" title="Swap umas" onClick={swapUmas}>⮂</div>
						</div>}
					{(mode == Mode.Compare || mode == Mode.GlobalCompare) && <div class={!expanded && currentIdx == 1 ? 'selected' : ''}>
						<HorseDef key={uma2.outfitId} state={uma2} setState={setUma2} courseDistance={course.distance} tabstart={() => 4 + horseDefTabs()} onResetAll={resetAllUmas} runData={runData} umaIndex={1}>
							{expanded ? 'Umamusume 2' : umaTabs}
						</HorseDef>
					</div>}
					{posKeepMode == PosKeepMode.Virtual && (mode == Mode.Compare || mode == Mode.GlobalCompare) && <div class={!expanded && currentIdx == 2 ? 'selected' : ''}>
						<HorseDef key={pacer.outfitId} state={pacer} setState={setPacer} courseDistance={mode == Mode.GlobalCompare ? 1600 : course.distance} tabstart={() => 4 + ((mode == Mode.Compare || mode == Mode.GlobalCompare) ? 2 : 1) * horseDefTabs()} onResetAll={resetAllUmas}>
							{expanded ? 'Virtual Pacemaker' : umaTabs}
						</HorseDef>
					</div>}
					{expanded && <div id="closeUmaOverlay" title="Close panel" onClick={toggleExpand}>✕</div>}
				</div>
				{popoverSkill && <BasinnChartPopover skillid={popoverSkill} results={tableData.get(popoverSkill).results} courseDistance={course.distance} />}
				{duelingConfigOpen && (
					<div 
						style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;"
						onClick={(e) => { if (e.target === e.currentTarget) setDuelingConfigOpen(false); }}
					>
						<div style="background: white; border-radius: 8px; padding: 24px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
							<h2 style="margin-top: 0; margin-bottom: 20px;">Dueling Configuration</h2>
							<div style="display: flex; flex-direction: column; gap: 16px;">
								<div>
									<label style="display: block; margin-bottom: 8px; font-weight: 500;">Runaway: {duelingRates.runaway}%</label>
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
									<label style="display: block; margin-bottom: 8px; font-weight: 500;">Front Runner: {duelingRates.frontRunner}%</label>
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
									<label style="display: block; margin-bottom: 8px; font-weight: 500;">Pace Chaser: {duelingRates.paceChaser}%</label>
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
									<label style="display: block; margin-bottom: 8px; font-weight: 500;">Late Surger: {duelingRates.lateSurger}%</label>
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
									<label style="display: block; margin-bottom: 8px; font-weight: 500;">End Closer: {duelingRates.endCloser}%</label>
									<input 
										type="range" 
										min="0" 
										max="100" 
										value={duelingRates.endCloser} 
										onInput={(e) => setDuelingRates({...duelingRates, endCloser: parseInt((e.currentTarget as HTMLInputElement).value)})}
										style="width: 100%;"
									/>
								</div>
								<div style="background: #fee; border: 1px solid #fcc; border-radius: 4px; padding: 12px; margin-top: 8px;">
									<p style="margin: 0; color: #c00; font-size: 0.9em;">
										These are estimate %'s extracted from in-game race data, your actual dueling rate will vary based CM-by-CM based on overall lobby compositions.
									</p>
								</div>
							</div>
							<div style="display: flex; justify-content: flex-end; margin-top: 24px;">
								<button 
									onClick={() => setDuelingConfigOpen(false)}
									style="background: rgb(148, 150, 189); color: white; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer; font-weight: 500;"
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
render(<App lang="en-ja" />, document.getElementById('app'));



import { h, Fragment } from 'preact';
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { Text, Localizer } from 'preact-i18n';

import {
	ColumnDef, SortFn, SortingState,
	createSortedRowModel, flexRender, rowSortingFeature, sortFns, tableFeatures, useTable
} from '@tanstack/preact-table';

import { Region, RegionList } from '../uma-skill-tools/Region';
import { CourseData } from '../uma-skill-tools/CourseData';
import { RaceParameters } from '../uma-skill-tools/RaceParameters';
import { getParser } from '../uma-skill-tools/ConditionParser';
import { buildBaseStats, buildSkillData, Perspective } from '../uma-skill-tools/RaceSolverBuilder';

import type { HorseState } from '../components/HorseDef';
import { useLanguage } from '../components/Language';
import { visualScale } from '../components/uiScale';
import { runComparison } from './compare';

import './BasinnChart.css';

import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import skillmeta from './skill_meta.json';
import umas from './umas.json';
import icons from '../icons.json';
import { umaToolsAsset, withBasePath } from '../components/assetPaths';

export function isPurpleSkill(id) {
	const iconId = skillmeta[id].iconId;
	return iconId[iconId.length-1] == '4';
}

function umaForUniqueSkill(skillId: string): string | null {
	const sid = parseInt(skillId);
	if (sid < 100000 || sid >= 200000) return null;
	
	const remainder = sid - 100001;
	if (remainder < 0) return null;
	
	const i = Math.floor(remainder / 10) % 1000;
	const v = Math.floor(remainder / 10 / 1000) + 1;
	
	const umaId = i.toString().padStart(3, '0');
	const baseUmaId = `1${umaId}`;
	const outfitId = `${baseUmaId}${v.toString().padStart(2, '0')}`;
	
	if (umas[baseUmaId] && umas[baseUmaId].outfits[outfitId]) {
		return outfitId;
	}
	
	return null;
}

import { RUNAWAY_STYLE_SKILL_ID } from '../uma-skill-tools/SkillConstants';

export { RUNAWAY_STYLE_SKILL_ID };

export function getActivateableSkills(skills: string[], horse: HorseState, course: CourseData, racedef: RaceParameters) {
	const parser = getParser();
	const h2 = buildBaseStats(horse, horse.mood);
	const wholeCourse = new RegionList();
	wholeCourse.push(new Region(0, course.distance));
	return skills.filter(id => {
		// Always include Runaway: chart compares style change, not skill activation regions.
		if (id === RUNAWAY_STYLE_SKILL_ID) return true;
		let sd;
		try {
			sd = buildSkillData(h2, racedef, course, wholeCourse, parser, id, Perspective.Any);
		} catch (_) {
			return false;
		}
		return sd.some(trigger => trigger.regions.length > 0 && trigger.regions[0].start < 9999);
	});
}

export function getNullRow(skillid: string) {
	return {id: skillid, min: 0, max: 0, mean: 0, median: 0, results: [], runData: null};
}

function formatChartValue(value: number) {
	if (!Number.isFinite(value)) return '—';
	return value.toFixed(2).replace('-0.00', '0.00');
}

function quantile(sorted: number[], p: number) {
	if (sorted.length == 0) return 0;
	const index = (sorted.length - 1) * p;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower == upper) return sorted[lower];
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

const distributionStatsCache = new WeakMap<object, {min: number, max: number, q1: number, q3: number, median: number, mean: number}>();

function distributionStats(row: any) {
	let stats = distributionStatsCache.get(row);
	if (stats == null) {
		const values = [...(row.results || [])].filter(Number.isFinite).sort((a, b) => a - b);
		stats = {
			min: Number.isFinite(row.min) ? row.min : (values[0] || 0),
			max: Number.isFinite(row.max) ? row.max : (values[values.length - 1] || 0),
			q1: quantile(values, 0.25),
			q3: quantile(values, 0.75),
			median: Number.isFinite(row.median) ? row.median : quantile(values, 0.5),
			mean: Number.isFinite(row.mean) ? row.mean : 0
		};
		distributionStatsCache.set(row, stats);
	}
	return stats;
}

function DistributionCell({row, maxAbs}: {row: any, maxAbs: number}) {
	const {min, max, q1, q3, median, mean} = distributionStats(row);
	const position = (value: number) => Math.max(0, Math.min(100, 50 + (value / maxAbs) * 50));
	const meanWidth = Math.min(50, Math.abs(mean) / maxAbs * 50);
	const meanLeft = mean < 0 ? 50 - meanWidth : 50;
	const meanClass = mean < 0 ? 'negativeMean' : mean > 0 ? 'positiveMean' : 'isEven';

	return (
		<div class="raceContextPlot skillDistributionPlot" aria-label={`Mean ${formatChartValue(mean)}, median ${formatChartValue(median)}, IQR ${formatChartValue(q1)} to ${formatChartValue(q3)}`}>
			<div
				class="raceContextRange"
				style={`left:${position(min)}%;width:${Math.max(1, position(max) - position(min))}%`}
			/>
			<div
				class={`raceContextMean ${meanClass}`}
				style={`left:${meanLeft}%;width:${meanWidth > 0 ? Math.max(meanWidth, 0.5) : 0}%`}
			/>
			<div class="raceContextCenter" />
			<div class="raceContextQuartile" style={`left:${position(q1)}%`} />
			<div class="raceContextQuartile" style={`left:${position(q3)}%`} />
			<div class="raceContextMedian" style={`left:${position(median)}%`} />
		</div>
	);
}

const SKILL_CIRCLE_RE = /([◎○◯●◉〇])/g;

function SkillNameText({id, owned = false}: {id: string, owned?: boolean}) {
	const lang = useLanguage();
	// Match app.tsx IntlProvider: English UI uses EN names; ja / en-ja use JP names.
	const langid = +(lang == 'en');
	const name = skillnames[id]?.[langid] ?? id;
	if (!owned) return name;
	return name.split(SKILL_CIRCLE_RE).map((part, i) => {
		if (!part) return null;
		if (/^[◎○◯●◉〇]$/.test(part)) {
			return <span class="chartSkillCircle" key={i}>{part}</span>;
		}
		return <span class="chartSkillNameText" key={i}>{part}</span>;
	});
}

function SkillNameCell(props) {
	const { id, showUmaIcons = false, owned = false } = props;
	
	if (showUmaIcons) {
		const umaId = umaForUniqueSkill(id);
		if (umaId && icons[umaId]) {
			return (
				<div class="chartSkillName">
					<img src={withBasePath(icons[umaId])} title="View skill details" />
					<span class="chartSkillLabel"><SkillNameText id={id} owned={owned} /></span>
				</div>
			);
		}
	}
	
	return (
		<div class="chartSkillName">
			<img src={umaToolsAsset(`icons/${skillmeta[id].iconId}.png`)} title="View skill details" />
			<span class="chartSkillLabel"><SkillNameText id={id} owned={owned} /></span>
		</div>
	);
}

const METRIC_COLUMNS = [
	['min', 'Min'],
	['max', 'Max'],
	['mean', 'Mean'],
	['median', 'Median']
] as const;

function sortIndicator(sorted: false | 'asc' | 'desc') {
	return sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : '';
}

export function BasinnChart(props) {
	const [expanded, setExpanded] = useState('');
	const [selectedType, setSelectedType] = useState('median');
	const wrapperRef = useRef<HTMLDivElement>(null);
	const clickTimeoutRef = useRef(null);
	const lastClickRef = useRef({id: '', time: 0});
	const [sorting, setSorting] = useState<SortingState>([{id: 'median', desc: true}]);

	useEffect(function () {
		if (props.selectedSkillId === undefined) return;
		const next = props.selectedSkillId || '';
		if (next !== expanded) {
			setExpanded(next);
		}
	}, [props.selectedSkillId]);

	useEffect(function () {
		if (!props.centerSelectionWhenHidden || !props.selectedSkillId) return;
		const frame = requestAnimationFrame(() => {
			const wrapper = wrapperRef.current;
			const row = wrapper?.querySelector<HTMLTableRowElement>(`tr[data-skillid="${props.selectedSkillId}"]`);
			if (!wrapper || !row) return;
			const wrapperRect = wrapper.getBoundingClientRect();
			const rowRect = row.getBoundingClientRect();
			const headerBottom = wrapper.querySelector('thead')?.getBoundingClientRect().bottom || wrapperRect.top;
			const visibleTop = Math.max(wrapperRect.top, headerBottom);
			const visibleBottom = wrapperRect.bottom;
			if (rowRect.top >= visibleTop && rowRect.bottom <= visibleBottom) return;
			const rowCenter = rowRect.top + rowRect.height / 2;
			const viewportCenter = visibleTop + (visibleBottom - visibleTop) / 2;
			wrapper.scrollTop += (rowCenter - viewportCenter) / visualScale(wrapper);
		});
		return () => cancelAnimationFrame(frame);
	}, [props.selectedSkillId, props.centerSelectionWhenHidden]);

	function selectMetric(type: string) {
		setSelectedType(type);
		props.onRunTypeChange(type + 'run');
	}

	const distributionScale = useMemo(() => {
		const values = props.data.flatMap(row => (row.results || []).filter(Number.isFinite));
		if (values.length == 0) return 0.01;
		if (values.length == 1) return Math.max(Math.abs(values[0]), 0.01);
		const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
		const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
		const std = Math.sqrt(variance);
		if (std == 0) return Math.max(...values.map(Math.abs), 0.01);
		return Math.max(Math.abs(mean - 3 * std), Math.abs(mean + 3 * std), 0.01);
	}, [props.data]);

	// Cell renderers are component types to flexRender, so `columns` must keep a stable identity across
	// result updates or every cell remounts. Values that change with the data are read through refs instead.
	const distributionScaleRef = useRef(distributionScale);
	distributionScaleRef.current = distributionScale;
	const ownedSkillsRef = useRef(props.ownedSkills);
	ownedSkillsRef.current = props.ownedSkills;

	function toggleExpand(skillId) {
		if (expanded === skillId) {
			setExpanded('');
			props.onSelectionChange('');
		} else {
			setExpanded(skillId);
			props.onSelectionChange(skillId, selectedType + 'run');
		}
	}

	function selectSkill(skillId) {
		setExpanded(skillId);
		props.onSelectionChange(skillId, selectedType + 'run');
	}

	const columns = useMemo(() => [{
		header: ({ column }) => (
			<span onClick={column.getToggleSortingHandler()}>
				Skill{sortIndicator(column.getIsSorted())}
			</span>
		),
		id: 'skillName',
		accessorFn: (row) => skillnames[row.id]?.[0] || row.id,
		cell: (info) => (
			<SkillNameCell
				id={info.row.original.id}
				showUmaIcons={props.showUmaIcons}
				owned={ownedSkillsRef.current?.has?.(info.row.original.id)}
			/>
		),
		sortingFn: 'alphanumeric'
	}, {
		header: () => <span>Finish Margin</span>,
		id: 'distribution',
		accessorFn: (row) => row[selectedType],
		cell: (info) => <DistributionCell row={info.row.original} maxAbs={distributionScaleRef.current} />,
		enableSorting: false
	}, ...METRIC_COLUMNS.map(([type, label]) => ({
		header: ({column}) => (
			<span
				class={`chartMetricHeaderLabel chartMetricHeaderLabel--${type}${selectedType == type ? ' is-selected' : ''}`}
				onClick={(e) => {
					e.stopPropagation();
					selectMetric(type);
					const handler = column.getToggleSortingHandler();
					if (handler) handler(e);
				}}
			>
				{label}{sortIndicator(column.getIsSorted())}
			</span>
		),
		id: type,
		accessorKey: type,
		cell: (info) => <span class="chartMetricValue">{formatChartValue(info.getValue())}</span>,
		sortDescFirst: true
	}))], [selectedType, props.showUmaIcons]);

	const table = useTable({
		_features: tableFeatures({rowSortingFeature}),
		_rowModels: {sortedRowModel: createSortedRowModel(sortFns)},
		columns,
		data: props.data,
		onSortingChange: setSorting,
		enableSortingRemoval: false,
		state: {sorting}
	});

	function handleClick(e) {
		const tr = e.target.closest('tr');
		if (tr == null) return;
		e.stopPropagation();
		const id = tr.dataset.skillid;
		if (e.target.closest('img')) {
			selectSkill(id);
			props.onInfoClick(id);
			return;
		}
		if (e.target.closest('th, .columnHeader')) {
			return;
		}

		const now = Date.now();
		const isDoubleClick = lastClickRef.current.id === id && (now - lastClickRef.current.time) < 300;

		if (clickTimeoutRef.current) {
			clearTimeout(clickTimeoutRef.current);
			clickTimeoutRef.current = null;
			if (!isDoubleClick) {
				toggleExpand(id);
			}
			return;
		}

		lastClickRef.current = {id, time: now};
		clickTimeoutRef.current = setTimeout(() => {
			clickTimeoutRef.current = null;
			if (lastClickRef.current.id === id && (Date.now() - lastClickRef.current.time) >= 300) {
				toggleExpand(id);
			}
		}, 300);
	}

	function handleDblClick(e) {
		if (clickTimeoutRef.current) {
			clearTimeout(clickTimeoutRef.current);
			clickTimeoutRef.current = null;
		}
		const tr = e.target.closest('tr');
		if (tr == null) return;
		e.stopPropagation();
		e.preventDefault();
		const id = tr.dataset.skillid;
		if (e.target.tagName == 'IMG') {
			return;
		}
		if (expanded === id) {
			return;
		}
		lastClickRef.current = {id: '', time: 0};
		props.onDblClickRow(id);
	}

	return (
		<div ref={wrapperRef} class={`basinnChartWrapper${props.dirty ? ' dirty' : ''}${props.wideSkillColumn ? ' wideSkillColumn' : ''}`}>
			<table class="basinnChart">
				<thead>
					{table.getHeaderGroups().map(headerGroup => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map(header => (
								<th key={header.id} colSpan={header.colSpan} class={`basinnChartHeader basinnChartHeader--${header.column.id}`}>
									{!header.isPlaceholder && (
										<div class="columnHeader">
											{flexRender(header.column.columnDef.header, header.getContext())}
										</div>
									)}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody onClick={handleClick} onDblClick={handleDblClick}>
					{table.getRowModel().rows.map(row => {
						const id = row.original.id;
						const isExpanded = expanded === id;
						return (
							<tr
								key={row.id}
								data-skillid={id}
								class={`basinnChartRow basinnChartRow--rarity-${skilldata[id]?.rarity || 1}${isExpanded ? ' expanded' : ''}${props.ownedSkills?.has?.(id) ? ' is-owned' : ''}`}
							>
								{row.getAllCells().map(cell => (
									<td key={cell.id} class={`basinnChartCell basinnChartCell--${cell.column.id}`}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

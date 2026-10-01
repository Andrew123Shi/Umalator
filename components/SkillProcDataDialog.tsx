import { h } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { computePosition, flip, shift } from '@floating-ui/dom';
import { SkillChartSidePlots } from '../umalator/app';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import { visualScale } from './uiScale';

function extractSkillRunData(compareRunData: any, umaIndex: number): any {
	if (!compareRunData?.allruns) {
		return null;
	}

	const umaSkBasinn = compareRunData.allruns.skBasinn?.[umaIndex];
	const umaSk = compareRunData.allruns.sk?.[umaIndex];
	const totalRuns = compareRunData.allruns.totalRuns || 0;

	if (!umaSkBasinn && !umaSk) {
		return null;
	}

	return {
		allruns: {
			skBasinn: umaSkBasinn ? [umaSkBasinn] : [],
			sk: umaSk ? [umaSk] : [],
			totalRuns: totalRuns
		},
		minrun: compareRunData.minrun,
		maxrun: compareRunData.maxrun,
		meanrun: compareRunData.meanrun,
		medianrun: compareRunData.medianrun
	};
}

interface SkillProcDataDialogProps {
	skillId: string;
	compareRunData: any;
	courseDistance: number;
	umaIndex: number;
	anchor: HTMLElement;
	displaying?: string;
	onClose: () => void;
}

export function SkillProcDataDialog(props: SkillProcDataDialogProps) {
	const { skillId, compareRunData, courseDistance, umaIndex, anchor, displaying = 'meanrun', onClose } = props;
	const popoverRef = useRef<HTMLDivElement>(null);
	const runData = extractSkillRunData(compareRunData, umaIndex);

	useEffect(() => {
		if (!anchor || !popoverRef.current) return;
		const popover = popoverRef.current;
		popover.style.visibility = 'hidden';
		computePosition(anchor, popover, {
			placement: 'right-start',
			middleware: [flip(), shift({ padding: 8 })],
		}).then(({ x, y }) => {
			if (!popoverRef.current) return;
			const scale = visualScale(popoverRef.current);
			popoverRef.current.style.transform = `translate(${x / scale}px, ${y / scale}px)`;
			popoverRef.current.style.visibility = 'visible';
		});

		function onDocPointerDown(ev: MouseEvent) {
			const target = ev.target as HTMLElement;
			if (popover.contains(target)) return;
			if (anchor.contains(target)) return;
			onClose();
		}
		function onKeyDown(ev: KeyboardEvent) {
			if (ev.key === 'Escape') onClose();
		}
		document.addEventListener('mousedown', onDocPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onDocPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [anchor, onClose]);

	if (!runData) {
		return null;
	}

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

	const skillName = skillnames[skillId]?.[0] || skillId;

	return createPortal(
		<div class="skillProcDataPopover" ref={popoverRef} style="visibility:hidden" tabIndex={-1}>
			<div class="skillProcDataHeader">
				<h3 class="skillProcDataTitle">
					<span class="skillProcDataTitleName">{skillName}</span>
					<span class="skillProcDataTitleSuffix">Detailed Activation Data</span>
				</h3>
				<button type="button" class="skillProcDataClose" onClick={onClose}>✕</button>
			</div>
			<div class="skillProcDataContent">
				<div class="skillChartExpandedResult skillProcDataExpandedResult">
					<div class="skillChartExpandedSummary">
						<div class="skillChartExpandedSamples">
							<div class="skillChartExpandedSamplesText">
								<span class="skillDetailsLabel">Total samples</span>
								<span class="skillChartExpandedSampleValue">{totalCount} ({skillProcs} activations)</span>
							</div>
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
						displaying={displaying}
						orientation="horizontal"
						velocityVariant="procHighlight"
						umaIndex={umaIndex}
					/>
				</div>
			</div>
		</div>,
		document.body
	);
}

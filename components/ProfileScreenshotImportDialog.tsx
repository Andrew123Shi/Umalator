import { h, Fragment } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Map as ImmMap } from 'immutable';

import { ProfileImportDraft, importProfileFromScreenshots, outfitIdForUniqueSkill } from './ProfileScreenshotImportV3';
import { Skill, SkillList } from './SkillList';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillmeta from '../umalator/skill_meta.json';
import skillnames from '../umalator-global/skillnames.json';
import umas from '../umalator/umas.json';
import icons from '../icons.json';
import { umaToolsAsset, withBasePath } from './assetPaths';

interface ScreenshotItem {
	id: string;
	name: string;
	dataUrl: string;
}

interface ProfileScreenshotImportDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onApplyDraft: (draft: ProfileImportDraft, saveProfile: boolean) => Promise<void> | void;
}

const OTHER_SELECTION = '__OTHER__';
const EXAMPLE_SCREENSHOT_PATH = umaToolsAsset('components/ExampleProfile.png');

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
		reader.readAsDataURL(file);
	});
}

function appendScreenshots(current: ScreenshotItem[], additions: ScreenshotItem[]) {
	const existingKeys = new Set(current.map(item => item.dataUrl.slice(0, 120)));
	const unique = additions.filter(item => !existingKeys.has(item.dataUrl.slice(0, 120)));
	return [...current, ...unique];
}

function traineeLabelForOutfit(outfitId: string | null): { nameWithOutfit: string; id: string } | null {
	if (!outfitId) return null;
	const umaId = outfitId.slice(0, 4);
	const uma = (umas as any)[umaId];
	if (!uma) return { nameWithOutfit: outfitId, id: outfitId };
	const outfitRaw = uma?.outfits?.[outfitId];
	const epithet = typeof outfitRaw === 'string' ? outfitRaw : (outfitRaw?.epithet || '');
	const traineeName = (uma?.name?.[1] || uma?.name?.[0] || outfitId);
	return {
		nameWithOutfit: epithet ? `${traineeName} ${epithet}` : traineeName,
		id: outfitId
	};
}

function normalizeUnknownRawText(raw: string): string {
	return String(raw || '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function ProfileScreenshotImportDialog(props: ProfileScreenshotImportDialogProps) {
	const { isOpen, onClose, onApplyDraft } = props;
	const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
	const [processing, setProcessing] = useState(false);
	const [draft, setDraft] = useState<ProfileImportDraft | null>(null);
	const [error, setError] = useState('');
	const [unknownIndex, setUnknownIndex] = useState(0);
	const [unknownSelections, setUnknownSelections] = useState<Record<string, string>>({});
	const [otherPickerOpenFor, setOtherPickerOpenFor] = useState<string | null>(null);
	const [exampleImageFailed, setExampleImageFailed] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const suppressResolvedAutoAdvanceRef = useRef(false);

	const unresolved = draft?.unknownSkills || [];
	const hasUnknowns = unresolved.length > 0;
	const allUnknownResolved = hasUnknowns && unresolved.every(item => unknownSelections[item.id] != null);
	const hasReachedResolverEnd = hasUnknowns && unknownIndex >= unresolved.length;
	const hasStartedOcr = processing || draft != null;

	const activeUnknown = hasUnknowns && unknownIndex < unresolved.length ? unresolved[unknownIndex] : null;
	const activeScreenshot = useMemo(() => {
		if (!hasStartedOcr || screenshots.length === 0) return null;
		// While OCR is still processing, keep focus on the first screenshot.
		if (processing && !draft) return screenshots[0];
		if (activeUnknown) {
			return screenshots.find(screenshot => screenshot.id === activeUnknown.screenshotId)
				|| screenshots.find(screenshot => screenshot.name === activeUnknown.screenshotName)
				|| screenshots[0];
		}
		const lastUnknown = unresolved[unresolved.length - 1];
		if (lastUnknown) {
			return screenshots.find(screenshot => screenshot.id === lastUnknown.screenshotId)
				|| screenshots.find(screenshot => screenshot.name === lastUnknown.screenshotName)
				|| screenshots[screenshots.length - 1];
		}
		return screenshots[screenshots.length - 1];
	}, [activeUnknown, draft, hasStartedOcr, processing, screenshots, unresolved]);
	const selectableSkillIds = useMemo(() => Object.keys(skilldata).filter(skillId => {
		const rarity = (skilldata as any)[skillId]?.rarity;
		const isTrueUnique = rarity > 2 && rarity < 6 && !String(skillId).startsWith('9');
		return !isTrueUnique;
	}), []);
	const resolvedDraft = useMemo(() => {
		if (!draft) return null;
		const extraSkillIds = unresolved
			.map(item => unknownSelections[item.id])
			.filter(Boolean)
			.filter(skillId => skillId !== OTHER_SELECTION);
		const mergedSkillIds = Array.from(new Set([...draft.skillIds, ...extraSkillIds]));
		let uniqueSkillId = draft.uniqueSkillId;
		if (!uniqueSkillId) {
			const forcedUniqueSelection = unresolved
				.find(item => item.id.includes('-0') || item.id.includes('-unique-'))
				&& unknownSelections[unresolved.find(item => item.id.includes('-0') || item.id.includes('-unique-'))!.id];
			if (forcedUniqueSelection && forcedUniqueSelection !== OTHER_SELECTION && (skilldata as any)[forcedUniqueSelection]?.rarity > 2) {
				uniqueSkillId = forcedUniqueSelection;
			}
		}
		if (!uniqueSkillId) {
			uniqueSkillId = mergedSkillIds.find(skillId => {
				const rarity = (skilldata as any)[skillId]?.rarity;
				return rarity > 2 && rarity < 6 && !String(skillId).startsWith('9');
			}) || null;
		}
		const outfitId = uniqueSkillId ? outfitIdForUniqueSkill(uniqueSkillId) : draft.outfitId;
		return { ...draft, skillIds: mergedSkillIds, uniqueSkillId, outfitId: outfitId || draft.outfitId };
	}, [draft, unresolved, unknownSelections]);

	async function handleFiles(files: FileList | File[]) {
		const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
		if (!imageFiles.length) {
			setError('No image files detected. Use PNG/JPG/WEBP screenshots.');
			return;
		}
		setError('');
		const loaded = await Promise.all(imageFiles.map(async (file, idx) => ({
			id: `${Date.now()}-${idx}`,
			name: file.name,
			dataUrl: await fileToDataUrl(file)
		})));
		setScreenshots(prev => appendScreenshots(prev, loaded));
	}

	async function handleProcess() {
		if (!screenshots.length) {
			setError('Upload or paste at least one screenshot.');
			return;
		}
		setError('');
		setProcessing(true);
		try {
			const result = await importProfileFromScreenshots(screenshots);
			setDraft(result);
			setUnknownIndex(0);
			setUnknownSelections({});
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Import failed.');
		} finally {
			setProcessing(false);
		}
	}

	function clearAll() {
		setScreenshots([]);
		setDraft(null);
		setUnknownSelections({});
		setUnknownIndex(0);
		setOtherPickerOpenFor(null);
		setError('');
	}

	function removeScreenshot(id: string) {
		setScreenshots(prev => prev.filter(item => item.id !== id));
	}

	function handlePaste(e: ClipboardEvent) {
		const clipboardItems = Array.from(e.clipboardData?.items || []).filter(item => item.type.startsWith('image/'));
		if (!clipboardItems.length) return;
		e.preventDefault();
		Promise.all(
			clipboardItems.map(async (item, idx) => {
				const file = item.getAsFile();
				if (!file) throw new Error('Failed to paste image from clipboard.');
				return {
					id: `${Date.now()}-paste-${idx}`,
					name: `pasted-${idx + 1}.png`,
					dataUrl: await fileToDataUrl(file)
				};
			})
		).then(items => {
			setScreenshots(prev => appendScreenshots(prev, items));
			setError('');
		}).catch(err => {
			setError(err instanceof Error ? err.message : 'Paste failed.');
		});
	}

	function setUnknownSelection(skillId: string) {
		if (!activeUnknown) return;
		const key = normalizeUnknownRawText(activeUnknown.rawText);
		setUnknownSelections(prev => {
			const next = { ...prev, [activeUnknown.id]: skillId };
			unresolved.forEach(item => {
				if (item.id !== activeUnknown.id && normalizeUnknownRawText(item.rawText) === key) {
					next[item.id] = skillId;
				}
			});
			return next;
		});
		setUnknownIndex(prev => Math.min(unresolved.length, prev + 1));
	}

	function openOtherPicker() {
		if (!activeUnknown) return;
		setOtherPickerOpenFor(activeUnknown.id);
	}

	function goToPreviousUnknown() {
		suppressResolvedAutoAdvanceRef.current = true;
		setUnknownIndex(prev => Math.max(0, prev - 1));
	}

	function pickOtherSkillFromPicker(selected: any) {
		if (!otherPickerOpenFor || selected == null) return;
		const pickedIds = selected.valueSeq().toArray();
		const skillId = pickedIds[pickedIds.length - 1];
		if (!skillId) return;
		const source = unresolved.find(item => item.id === otherPickerOpenFor);
		const key = normalizeUnknownRawText(source?.rawText || '');
		setUnknownSelections(prev => {
			const next = { ...prev, [otherPickerOpenFor]: skillId };
			if (key) {
				unresolved.forEach(item => {
					if (item.id !== otherPickerOpenFor && normalizeUnknownRawText(item.rawText) === key) {
						next[item.id] = skillId;
					}
				});
			}
			return next;
		});
		setOtherPickerOpenFor(null);
		setUnknownIndex(prev => Math.min(unresolved.length, prev + 1));
	}

	async function apply(saveProfile: boolean) {
		if (!resolvedDraft) return;
		await onApplyDraft(resolvedDraft, saveProfile);
		clearAll();
		onClose();
	}

	const canApplyUnknowns = unresolved.every(item => unknownSelections[item.id] != null);
	const canApplyAfterResolution = !hasUnknowns || canApplyUnknowns || hasReachedResolverEnd;
	const traineeLabel = traineeLabelForOutfit(resolvedDraft?.outfitId || null);

	useEffect(() => {
		if (suppressResolvedAutoAdvanceRef.current) {
			suppressResolvedAutoAdvanceRef.current = false;
			return;
		}
		if (allUnknownResolved) return;
		if (!hasUnknowns || unknownIndex >= unresolved.length) return;
		const current = unresolved[unknownIndex];
		if (!current || unknownSelections[current.id] == null) return;
		let next = unknownIndex + 1;
		while (next < unresolved.length && unknownSelections[unresolved[next].id] != null) next++;
		if (next !== unknownIndex) setUnknownIndex(next);
	}, [allUnknownResolved, hasUnknowns, unknownIndex, unresolved, unknownSelections]);

	return createPortal(
		<>
			<div class={`profileImportOverlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
			<div class={`profileImportDialog ${isOpen ? 'open' : ''}`} onPaste={handlePaste as any} tabIndex={0} onClick={(e) => e.stopPropagation()}>
				<div class="profileImportHeader">
					<h3>Import Profile from Screenshot</h3>
					<button class="profileImportClose" onClick={onClose}>×</button>
				</div>
				<div class="profileImportContent">
					<div class="profileImportTwoPanel active">
						<div class="profileImportScreensPanel">
							<div class="profileImportScreensPanelBody">
								{hasStartedOcr && activeScreenshot ? (
									<Fragment>
										<div class="profileImportScreensPanelImageWrap">
											<img src={activeScreenshot.dataUrl} alt={activeScreenshot.name} />
										</div>
										{screenshots.length > 1 && (
											<ul class="profileImportActiveThumbStrip">
												{screenshots.map(screenshot => (
													<li key={screenshot.id} class={screenshot.id === activeScreenshot.id ? 'active' : ''}>
														<img src={screenshot.dataUrl} alt={screenshot.name} />
													</li>
												))}
											</ul>
										)}
									</Fragment>
								) : (
									<Fragment>
										<div class="profileImportExampleHeader"><strong>Example Screenshot</strong></div>
										<div class="profileImportScreensPanelImageWrap">
											{exampleImageFailed ? (
												<div class="profileImportExampleFallback">
													Example screenshot could not be loaded from a local file URL.
													<br />
													Place it in a web-served project path (for example under `components`) to display it reliably.
												</div>
											) : (
												<img src={EXAMPLE_SCREENSHOT_PATH} alt="Example Umamusume profile screenshot" onError={() => setExampleImageFailed(true)} />
											)}
										</div>
									</Fragment>
								)}
							</div>
						</div>
						<div class="profileImportMainPanel">
							{!hasStartedOcr && (
								<div class="profileImportDropzone profileImportDropzoneClickable" onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										inputRef.current?.click();
									}
								}}>
									<span>Upload or Paste Screenshot(s)</span>
									{screenshots.length > 0 && (
										<ul class="profileImportScreenshotList">
											{screenshots.map(screenshot => (
												<li key={screenshot.id} class="profileImportScreenshotItem">
													<img src={screenshot.dataUrl} alt={screenshot.name} />
													<button
														type="button"
														class="profileImportThumbRemove"
														title="Remove screenshot"
														onClick={(e) => {
															e.stopPropagation();
															removeScreenshot(screenshot.id);
														}}
													>
														×
													</button>
												</li>
											))}
										</ul>
									)}
								</div>
							)}
							<input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none" onChange={(e) => e.currentTarget.files && handleFiles(e.currentTarget.files)} />
							{!hasStartedOcr && (
								<div class="profileImportInstructionText">
									<p>To ensure the OCR works properly, follow these formatting guidelines:</p>
									<ul class="profileImportInstructionList">
										<li>
										    Upload screenshot(s) that include the <strong>entire</strong> Umamusume profile box. 
											<ul class="profileImportInstructionSubList">
											<li>Include both the &quot;Umamusume Details&quot; header at the top and the &quot;Close&quot; button at the bottom.</li>
											</ul>
										</li>
										<li>
											If all skills do not fit in one image, upload additional screenshots with the same format (for example, after scrolling the skills section).
											<ul class="profileImportInstructionSubList">
											<li>The first screenshot must include the unique (rainbow) skill. Ensure that the skill list is scrolled all the way to the top.</li>
											<li>For subsequent screenshots, scroll the skills such that the top row of skill tiles is entirely visible and not cut off partially.</li>
											</ul>
										</li>
										<li>Refer to the example screenshot on the left.</li>
										</ul>
									<p>The OCR may make mistakes. Verify all imported values before applying. Note that aptitudes are not imported and must be set manually.</p>
								</div>
							)}
							{!hasStartedOcr ? (
								<div class="profileImportActions">
									<button class="resetUmaButton profileImportPrimaryAction" onClick={handleProcess} disabled={processing || screenshots.length === 0}>{processing ? 'Reading...' : 'Run OCR Import'}</button>
									<button class="resetUmaButton" onClick={clearAll} disabled={processing}>Clear</button>
								</div>
							) : processing ? (
								<div class="profileImportActions profileImportActionsSingle">
									<button class="resetUmaButton profileImportPrimaryAction" disabled>Reading...</button>
								</div>
							) : (
								<div class="profileImportActions profileImportActionsSingle">
									<button class="resetUmaButton profileImportResetAction" onClick={clearAll} disabled={processing}>Reset</button>
								</div>
							)}

							{error && <div class="profileImportError">{error}</div>}

							{draft && draft.warnings.length > 0 && (
								<div class="profileImportWarnings">
									{draft.warnings.map(warning => <div key={warning}>- {warning}</div>)}
								</div>
							)}

							{hasUnknowns && (
								<div class="profileImportUnknownPrompt">
									<h4>{allUnknownResolved || hasReachedResolverEnd ? 'All Skills Resolved' : 'Identify This Skill:'}</h4>
									{activeUnknown && (
										<Fragment>
											{activeUnknown.cropDataUrl ? (
												<img src={activeUnknown.cropDataUrl} class="profileImportUnknownCrop" />
											) : (
												<div class="profileImportUnknownNoCrop">No crop available for this guess; use text + candidates below.</div>
											)}
											<div class="profileImportUnknownCandidates">
												{activeUnknown.candidates.map(candidate => (
													<button
														key={candidate.skillId}
														type="button"
														class={`profileImportSkillCandidateButton ${unknownSelections[activeUnknown.id] === candidate.skillId ? 'selected' : ''}`}
														onClick={() => setUnknownSelection(candidate.skillId)}
														title={`${candidate.name} (${Math.round(candidate.score * 100)}%)`}
													>
														<Skill id={candidate.skillId} />
													</button>
												))}
												<button
													type="button"
													class={`profileImportSkillCandidateButton ${unknownSelections[activeUnknown.id] === OTHER_SELECTION ? 'selected' : ''}`}
													onClick={openOtherPicker}
												>
													<span class="skill addSkillButton profileImportOtherOption">
														<span class="profileImportOtherIcon"><span>+</span></span>
														<span class="skillName">Other</span>
													</span>
												</button>
											</div>
										</Fragment>
									)}
									<div class="profileImportUnknownNav">
										<button
											class="resetUmaButton"
											onClick={goToPreviousUnknown}
											disabled={unknownIndex === 0}
										>
											Previous
										</button>
										<span class="profileImportUnknownIndex">
											{allUnknownResolved || hasReachedResolverEnd ? `${unresolved.length}/${unresolved.length}` : `${Math.min(unknownIndex + 1, unresolved.length)}/${unresolved.length}`}
										</span>
										{activeUnknown && (
											<button
												class="resetUmaButton"
												onClick={() => setUnknownIndex(Math.min(unresolved.length, unknownIndex + 1))}
												disabled={unknownIndex >= unresolved.length}
											>
												{unknownSelections[activeUnknown.id] ? 'Next' : 'Skip'}
											</button>
										)}
									</div>
								</div>
							)}

							{resolvedDraft && (
								<div class="profileImportReview">
									<div class="profileImportReviewHeader">
										<h4>Import Summary</h4>
										<p>Review the detected details before applying.</p>
									</div>
									<div class="profileImportTraineeRow">
										{traineeLabel && (icons as any)[traineeLabel.id] && (
											<img src={withBasePath((icons as any)[traineeLabel.id])} alt="" />
										)}
										<strong>{traineeLabel?.nameWithOutfit || 'Not resolved'}</strong>
										{traineeLabel && <span class="profileImportReviewId">{traineeLabel.id}</span>}
									</div>
									<div class="profileImportReviewSection">
										<span class="profileImportReviewLabel">Stats</span>
										<div class="profileImportStatsGrid">
											{[
												['speed', 'Speed', resolvedDraft.stats.speed],
												['stamina', 'Stamina', resolvedDraft.stats.stamina],
												['power', 'Power', resolvedDraft.stats.power],
												['guts', 'Guts', resolvedDraft.stats.guts],
												['wit', 'Wit', resolvedDraft.stats.wisdom]
											].map(([icon, label, value]) => (
												<div class="profileImportStatCard" key={icon as string} title={label as string}>
													<img src={umaToolsAsset(`icons/${icon}.webp`)} alt={label as string} />
													<strong>{value ?? '-'}</strong>
												</div>
											))}
										</div>
									</div>
									<div class="profileImportReviewMetaGrid">
										<div class="profileImportReviewMetaCard">
											<span>Unique Skill Level Detected</span>
											<strong>{resolvedDraft.uniqueLevel ?? '—'}</strong>
										</div>
										<div class="profileImportReviewMetaCard">
											<span>Resolved Skills</span>
											<strong>{resolvedDraft.skillIds.length}</strong>
										</div>
									</div>
									<div class="profileImportReviewSection">
										<span class="profileImportReviewLabel">Detected Skills</span>
										<div class="profileImportSkillPreview">
											{resolvedDraft.skillIds.map(skillId => {
												const names = (skillnames as any)[skillId] || [];
												return (
													<div key={skillId} class="profileImportSkillPreviewCard">
														<img src={umaToolsAsset(`icons/${(skillmeta as any)[skillId]?.iconId}.png`)} alt="" />
														<span>
															<strong>{names[1] || names[0] || skillId}</strong>
															<small>{skillId}</small>
														</span>
													</div>
												);
											})}
										</div>
									</div>
								</div>
							)}
							{resolvedDraft && (
								<div class="profileImportApplyActions profileImportApplyActionsCentered">
									<button class="resetUmaButton profileImportPrimaryAction" onClick={() => apply(false)} disabled={!canApplyAfterResolution}>Apply</button>
								</div>
							)}
							{resolvedDraft && (
								<div class="profileImportDisclaimer">
									The OCR can make mistakes. Make sure to double check that all imported details are correct. Note that aptitudes are not imported.
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
			{otherPickerOpenFor && (
				<Fragment>
					<div class="horseSkillPickerOverlay open profileImportOtherPickerOverlay" onClick={() => setOtherPickerOpenFor(null)} />
					<div class="horseSkillPickerWrapper open profileImportOtherPickerWrapper" onClick={(e) => e.stopPropagation()}>
						<SkillList ids={selectableSkillIds} selected={ImmMap()} setSelected={pickOtherSkillFromPicker} isOpen={otherPickerOpenFor != null} />
					</div>
				</Fragment>
			)}
		</>,
		document.body
	);
}

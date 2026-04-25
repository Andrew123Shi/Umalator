import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Map as ImmMap } from 'immutable';

import { ProfileImportDraft, importProfileFromScreenshots, outfitIdForUniqueSkill } from './ProfileScreenshotImportV3';
import { Skill, SkillList } from './SkillList';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillmeta from '../umalator/skill_meta.json';
import skillnames from '../umalator-global/skillnames.json';
import umas from '../umalator/umas.json';

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
const EXAMPLE_SCREENSHOT_PATH = '/uma-tools/components/ExampleProfile.png';

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

	const unresolved = draft?.unknownSkills || [];
	const hasUnknowns = unresolved.length > 0;
	const allUnknownResolved = hasUnknowns && unresolved.every(item => unknownSelections[item.id] != null);
	const hasReachedResolverEnd = hasUnknowns && unknownIndex >= unresolved.length;
	const hasStartedOcr = processing || draft != null;

	const activeUnknown = hasUnknowns && unknownIndex < unresolved.length ? unresolved[unknownIndex] : null;
	const activeScreenshot = useMemo(() => {
		if (!hasStartedOcr || screenshots.length === 0) return null;
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
	}, [activeUnknown, hasStartedOcr, screenshots, unresolved]);
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
		if (allUnknownResolved) return;
		if (!hasUnknowns || unknownIndex >= unresolved.length) return;
		const current = unresolved[unknownIndex];
		if (!current || unknownSelections[current.id] == null) return;
		let next = unknownIndex + 1;
		while (next < unresolved.length && unknownSelections[unresolved[next].id] != null) next++;
		if (next !== unknownIndex) setUnknownIndex(next);
	}, [allUnknownResolved, hasUnknowns, unknownIndex, unresolved, unknownSelections]);

	return (
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
									To ensure the OCR works properly, upload a screenshot that includes the <strong>entire</strong> Umamusume profile box with the skills displayed. This includes both &quot;Umamusume Details&quot; header at the top of the profile and the &quot;Close&quot; button at the bottom. If there are too many skills to be included in one screenshot, upload multiple screenshots that show the additional skills with the same formatting (e.g. scroll down in the skills section), or simply add them manually. The first screenshot must include the unique (rainbow) skill.
									<br />
									Refer to the example screenshot to the left.
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
											<div class="profileImportUnknownText">OCR read <strong>"{activeUnknown.rawText || '(empty)'}"</strong></div>
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
													class={`profileImportSkillCandidateButton skill addSkillButton profileImportOtherOption ${unknownSelections[activeUnknown.id] === OTHER_SELECTION ? 'selected' : ''}`}
													onClick={openOtherPicker}
												>
													<span>+</span> Other
												</button>
											</div>
										</Fragment>
									)}
									<div class="profileImportUnknownNav">
										<button
											class="resetUmaButton"
											onClick={() => setUnknownIndex(Math.max(0, unknownIndex - 1))}
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
									<h4>Review Imported Profile</h4>
									<div class="profileImportSummaryRow">
										Trainee:{' '}
										<strong>{traineeLabel?.nameWithOutfit || 'Not resolved'}</strong>
										<span>{traineeLabel ? `(${traineeLabel.id})` : ''}</span>
									</div>
									<div class="profileImportSummaryRow">
										Stats:
										<span>
											SPD <strong>{resolvedDraft.stats.speed ?? '-'}</strong> / STA <strong>{resolvedDraft.stats.stamina ?? '-'}</strong> / PWR <strong>{resolvedDraft.stats.power ?? '-'}</strong> / GUT <strong>{resolvedDraft.stats.guts ?? '-'}</strong> / WIT <strong>{resolvedDraft.stats.wisdom ?? '-'}</strong>
										</span>
									</div>
									<div class="profileImportSummaryRow">Unique Level: <strong>{resolvedDraft.uniqueLevel ?? 'Not detected'}</strong></div>
									<div class="profileImportSummaryRow">Total Resolved Skills: <strong>{resolvedDraft.skillIds.length}</strong></div>
									<div class="profileImportSkillPreview">
										{resolvedDraft.skillIds.map(skillId => (
											<span key={skillId} class="profileImportSkillPreviewBubble">
												{skillId}
												<span class="profileImportSkillHoverCard">
													<img src={`/uma-tools/icons/${(skillmeta as any)[skillId]?.iconId}.png`} alt="" />
													<span>{((skillnames as any)[skillId] || [skillId])[0]}</span>
												</span>
											</span>
										))}
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
		</>
	);
}

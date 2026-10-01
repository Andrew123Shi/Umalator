import { h, Fragment } from 'preact';
import { createPortal } from 'preact/compat';
import { useState, useReducer, useMemo, useEffect, useRef } from 'preact/hooks';
import { IntlProvider, Text, Localizer } from 'preact-i18n';
import { computePosition, flip, shift } from '@floating-ui/dom';

import { SkillList, Skill, ExpandedSkillDetails } from '../components/SkillList';
import { ProfileScreenshotImportDialog } from './ProfileScreenshotImportDialog';
import { ProfileImportDraft } from './ProfileScreenshotImportV3';

import { HorseParameters } from '../uma-skill-tools/HorseTypes';

import { SkillSet, HorseState, RANDOM_MOOD, RUNAWAY_STYLE_SKILL_ID, RUNAWAY_SKILL_GROUP_ID, hasRunawaySkill } from './HorseDefTypes';

import './HorseDef.css';

import umas from '../umalator/umas.json';
import icons from '../icons.json';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillmeta from '../umalator/skill_meta.json';
import { umaToolsAsset, withBasePath } from './assetPaths';
import { visualScale } from './uiScale';

import { getAllSavedProfiles, saveUmaProfile, loadUmaProfile, deleteUmaProfile, renameUmaProfile, selectAnotherProfilesDatabase, createNewProfilesDatabase } from '../umalator/app';

import { calculateRatingBreakdown, calculateSkillScore, getRatingBadge, RATING_BADGES, buildAptitudeVector } from './CareerRating';

// Type for saved profiles (matches the one in app.tsx)
interface SavedUmaProfile {
	id: string;
	name: string;
	timestamp: number;
	data: any;
}

const umaAltIds = Object.keys(umas).flatMap(id => Object.keys(umas[id].outfits));
const umaNamesForSearch = {};

function getOutfitData(umaId: string, outfitId: string) {
	const outfit = umas[umaId]?.outfits?.[outfitId];
	if (!outfit) return null;
	return typeof outfit === 'string' ? {epithet: outfit} : outfit;
}

function getOutfitEpithet(umaId: string, outfitId: string): string {
	return getOutfitData(umaId, outfitId)?.epithet || '';
}

function strategyFromOutfitData(outfitData: any): HorseState['strategy'] | null {
	if (!outfitData || typeof outfitData.strategy !== 'number') return null;
	const mapped = ['', 'Nige', 'Senkou', 'Sasi', 'Oikomi'][outfitData.strategy];
	return (mapped as HorseState['strategy']) || null;
}

function strategyAptitudeFromOutfitData(outfitData: any, strategy: HorseState['strategy']) {
	if (!outfitData || !Array.isArray(outfitData.aptitudes)) return null;
	const strategyIndex = ['Nige', 'Senkou', 'Sasi', 'Oikomi'].indexOf(strategy === 'Oonige' ? 'Nige' : strategy);
	if (strategyIndex < 0) return null;
	const raw = outfitData.aptitudes[4 + strategyIndex];
	if (typeof raw !== 'number' || raw < 0 || raw > 7) return null;
	return ' GFEDCBA'[raw] || null;
}

function defaultStrategyForOutfit(outfitId: string): HorseState['strategy'] {
	if (!outfitId) return 'Senkou';
	const outfitData = getOutfitData(outfitId.slice(0, 4), outfitId);
	return strategyFromOutfitData(outfitData) || 'Senkou';
}

function applySkillsChange(state: HorseState, newSkills: HorseState['skills']): HorseState {
	const hadRunaway = hasRunawaySkill(state.skills);
	const hasRunaway = hasRunawaySkill(newSkills);
	let next = state.set('skills', newSkills);
	if (hasRunaway && !hadRunaway) {
		return next.set('strategy', 'Oonige');
	}
	if (!hasRunaway && hadRunaway) {
		next = next.set('forcedSkillPositions', next.forcedSkillPositions.delete(RUNAWAY_STYLE_SKILL_ID));
		if (next.strategy === 'Oonige') {
			next = next.set('strategy', defaultStrategyForOutfit(next.outfitId));
		}
	}
	return next;
}

function applyStrategyChange(state: HorseState, newStrategy: HorseState['strategy']): HorseState {
	let next = state.set('strategy', newStrategy);
	if (newStrategy === 'Oonige') {
		if (!hasRunawaySkill(next.skills)) {
			next = next.set('skills', next.skills.set(RUNAWAY_SKILL_GROUP_ID, RUNAWAY_STYLE_SKILL_ID));
		}
	} else if (hasRunawaySkill(next.skills)) {
		next = next
			.set('skills', next.skills.delete(RUNAWAY_SKILL_GROUP_ID))
			.set('forcedSkillPositions', next.forcedSkillPositions.delete(RUNAWAY_STYLE_SKILL_ID));
	}
	return next;
}

umaAltIds.forEach(id => {
	const u = umas[id.slice(0,4)];
	umaNamesForSearch[id] = (getOutfitEpithet(id.slice(0,4), id) + ' ' + ((u && u.name && u.name[1]) || '')).toUpperCase().replace(/\./g, '');
});

function searchNames(query) {
	const q = (query == null ? '' : String(query)).toUpperCase().replace(/\./g, '');
	return umaAltIds.filter(oid => umaNamesForSearch[oid].indexOf(q) > -1);
}

export function UmaProfileManager(props) {
	const { currentState, onLoad, onClose } = props;
	const [profiles, setProfiles] = useState<SavedUmaProfile[]>([]);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState('');
	const [saveMessage, setSaveMessage] = useState('');
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState('');

	// Filter profiles based on search query (by profile name and uma character name)
	const filteredProfiles = useMemo(() => {
		if (!searchQuery.trim()) {
			return profiles;
		}
		const query = searchQuery.trim().toLowerCase();
		return profiles.filter(profile => {
			// Search by profile name
			if (profile.name.toLowerCase().includes(query)) {
				return true;
			}
			// Search by uma character name
			const umaData = profile.data;
			const umaId = umaData.outfitId;
			if (umaId) {
				const u = umas[umaId.slice(0,4)];
				if (u && u.name && u.name[1]) {
					// Check English name (index 1)
					if (u.name[1].toLowerCase().includes(query)) {
						return true;
					}
					// Also check Japanese name (index 0) if it exists
					if (u.name[0] && u.name[0].toLowerCase().includes(query)) {
						return true;
					}
					// Check outfit/epithet name if it exists
					const epithet = getOutfitEpithet(umaId.slice(0,4), umaId);
					if (epithet && epithet.toLowerCase().includes(query)) {
						return true;
					}
				}
			}
			return false;
		});
	}, [profiles, searchQuery]);

	// Load profiles on mount - try to load from file
	useEffect(() => {
		async function loadProfiles() {
			setLoading(true);
			try {
				// First try localStorage (fast, no prompt)
				try {
					const stored = localStorage.getItem('umalator-saved-profiles');
					if (stored) {
						const cachedProfiles = JSON.parse(stored);
						if (cachedProfiles.length > 0) {
							cachedProfiles.sort((a, b) => b.timestamp - a.timestamp);
							setProfiles(cachedProfiles);
							setLoading(false);
							// Then try to load from file in background to update
							getAllSavedProfiles().then(allProfiles => {
								allProfiles.sort((a, b) => b.timestamp - a.timestamp);
								setProfiles(allProfiles);
							}).catch(() => {
								// Ignore errors, keep using cached data
							});
							return;
						}
					}
				} catch (e) {
					// Ignore localStorage errors
				}

				// If no localStorage data, try to load from file (may prompt)
				const allProfiles = await getAllSavedProfiles();
				// Sort by timestamp, newest first
				allProfiles.sort((a, b) => b.timestamp - a.timestamp);
				setProfiles(allProfiles);
			} catch (error) {
				console.warn('Failed to load profiles:', error);
				// Try localStorage as final fallback
				try {
					const stored = localStorage.getItem('umalator-saved-profiles');
					if (stored) {
						const allProfiles = JSON.parse(stored);
						allProfiles.sort((a, b) => b.timestamp - a.timestamp);
						setProfiles(allProfiles);
					}
				} catch (e) {
					// Ignore
				}
			} finally {
				setLoading(false);
			}
		}
		loadProfiles();
	}, []);

	async function refreshProfiles() {
		try {
			const allProfiles = await getAllSavedProfiles();
			// Sort by timestamp, newest first
			allProfiles.sort((a, b) => b.timestamp - a.timestamp);
			setProfiles(allProfiles);
		} catch (error) {
			console.warn('Failed to refresh profiles:', error);
		}
	}

	async function handleSave() {
		try {
			const name = prompt('Enter a name for this profile (or leave empty for auto-generated):');
			if (name === null) return; // User cancelled
			await saveUmaProfile(currentState, name || undefined);
			await refreshProfiles();
			setSaveMessage('Profile saved!');
			setTimeout(() => setSaveMessage(''), 2000);
		} catch (error) {
			alert('Failed to save profile: ' + error.message);
		}
	}

	async function handleSelectAnotherDatabase() {
		try {
			const selectedProfiles = await selectAnotherProfilesDatabase();
			if (selectedProfiles === null) {
				return;
			}
			selectedProfiles.sort((a, b) => b.timestamp - a.timestamp);
			setProfiles(selectedProfiles);
			setSaveMessage('Database selected!');
			setTimeout(() => setSaveMessage(''), 2000);
		} catch (error) {
			alert('Failed to select database: ' + error.message);
		}
	}

	async function handleCreateNewDatabase() {
		try {
			const selectedProfiles = await createNewProfilesDatabase();
			if (selectedProfiles === null) {
				return;
			}
			setProfiles(selectedProfiles);
			setSaveMessage('New database created!');
			setTimeout(() => setSaveMessage(''), 2000);
		} catch (error) {
			alert('Failed to create database: ' + error.message);
		}
	}

	async function handleLoad(profileId: string) {
		try {
			const profile = await loadUmaProfile(profileId);
			if (profile) {
				onLoad(profile);
				onClose();
			} else {
				alert('Failed to load profile');
			}
		} catch (error) {
			alert('Failed to load profile: ' + error.message);
		}
	}

	async function handleDelete(profileId: string) {
		if (confirm('Are you sure you want to delete this profile?')) {
			try {
				await deleteUmaProfile(profileId);
				await refreshProfiles();
			} catch (error) {
				alert('Failed to delete profile: ' + error.message);
			}
		}
	}

	function startRename(profileId: string, currentName: string) {
		setRenamingId(profileId);
		setRenameValue(currentName);
	}

	async function confirmRename(profileId: string) {
		if (renameValue.trim()) {
			try {
				await renameUmaProfile(profileId, renameValue.trim());
				await refreshProfiles();
			} catch (error) {
				alert('Failed to rename profile: ' + error.message);
			}
		}
		setRenamingId(null);
		setRenameValue('');
	}

	function cancelRename() {
		setRenamingId(null);
		setRenameValue('');
	}

	function formatTimestamp(timestamp: number): string {
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);
		
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
		if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
		if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
		return new Date(timestamp).toLocaleDateString();
	}

	return createPortal(
		<>
			<div class="umaProfileManagerOverlay" onClick={onClose} />
			<div class="umaProfileManagerDialog">
				<div class="umaProfileManagerHeader">
					<h3>Uma Database</h3>
					<button class="umaProfileManagerClose" onClick={onClose}>×</button>
				</div>
				<div class="umaProfileManagerContent">
					<div class="umaProfileManagerActions">
						<div class="umaProfileManagerPrimaryActions">
							<button class="umaProfileManagerSaveButton" onClick={handleSave}>Save Current Profile</button>
							<div class="umaProfileManagerSavedCount">{profiles.length} Saved Umas</div>
						</div>
						{saveMessage && <span class="umaProfileManagerMessage">{saveMessage}</span>}
						<div class="umaProfileManagerDatabaseButtons">
							<button class="umaProfileManagerSaveButton" onClick={handleCreateNewDatabase}>Create New Database</button>
							<button class="umaProfileManagerSaveButton" onClick={handleSelectAnotherDatabase}>Select Another Database</button>
						</div>
					</div>
					{profiles.length > 0 && (
						<div class="umaProfileManagerSearch">
							<input
								type="text"
								class="umaProfileManagerSearchInput"
								placeholder="Search by profile name or uma character..."
								value={searchQuery}
								onInput={(e) => setSearchQuery(e.currentTarget.value)}
							/>
						</div>
					)}
					{loading ? (
						<div class="umaProfileManagerEmpty">Loading profiles...</div>
					) : profiles.length === 0 ? (
						<div class="umaProfileManagerEmpty">No saved profiles yet. Save a profile to get started!</div>
					) : filteredProfiles.length === 0 ? (
						<div class="umaProfileManagerEmpty">No profiles match your search.</div>
					) : (
						<ul class="umaProfileManagerList">
							{filteredProfiles.map(profile => {
								const umaData = profile.data;
								const umaId = umaData.outfitId;
								const u = umaId && umas[umaId.slice(0,4)];
								return (
									<li key={profile.id} class="umaProfileManagerItem">
										<div class="umaProfileManagerItemMain">
											{umaId && u && (
												<img src={withBasePath(icons[umaId])} class="umaProfileManagerUmaIcon" />
											)}
											<div class="umaProfileManagerItemInfo">
												{renamingId === profile.id ? (
													<input
														type="text"
														class="umaProfileManagerRenameInput"
														value={renameValue}
														onInput={(e) => setRenameValue(e.currentTarget.value)}
														onKeyDown={(e) => {
															if (e.key === 'Enter') confirmRename(profile.id);
															if (e.key === 'Escape') cancelRename();
														}}
														autoFocus
													/>
												) : (
													<div class="umaProfileManagerItemName">{profile.name}</div>
												)}
												{umaId && u && (
													<div class="umaProfileManagerItemUma">{getOutfitEpithet(umaId.slice(0,4), umaId)} {u.name[1]}</div>
												)}
												<div class="umaProfileManagerItemTime">{formatTimestamp(profile.timestamp)}</div>
											</div>
										</div>
										<div class="umaProfileManagerItemActions">
											{renamingId === profile.id ? (
												<>
													<button class="umaProfileManagerActionButton" onClick={() => confirmRename(profile.id)}>✓</button>
													<button class="umaProfileManagerActionButton" onClick={cancelRename}>✗</button>
												</>
											) : (
												<>
													<button class="umaProfileManagerActionButton umaProfileManagerLoadButton" onClick={() => handleLoad(profile.id)} title="Load">Load</button>
													<button class="umaProfileManagerActionButton" onClick={() => startRename(profile.id, profile.name)} title="Rename">Rename</button>
													<button class="umaProfileManagerActionButton" onClick={() => handleDelete(profile.id)} title="Delete">Delete</button>
												</>
											)}
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</div>
		</>,
		document.body
	);
}

export function UmaSelector(props) {
	const randomMob = useMemo(() => umaToolsAsset(`icons/mob/trained_mob_chr_icon_${8000 + Math.floor(Math.random() * 624)}_000001_01.png`), []);
	const u = props.value && umas[props.value.slice(0,4)];
	const [profileManagerOpen, setProfileManagerOpen] = useState(false);
	const [profileImportOpen, setProfileImportOpen] = useState(false);

	const input = useRef(null);
	const suggestionsContainer = useRef(null);
	const [open, setOpen] = useState(false);
	const [activeIdx, setActiveIdx] = useState(-1);
	function update(q) {
		return {input: q, suggestions: searchNames(q)};
	}
	const [query, search] = useReducer((_,q) => update(q), (u && u.name && u.name[1]) || '', update);

	function confirm(oid) {
		setOpen(false);
		props.select(oid);
		const uname = umas[oid.slice(0,4)].name[1];
		search(uname);
		setActiveIdx(-1);
		if (input.current != null) {
			input.current.value = uname;
			input.current.blur();
		}
	}

	function focusAndSelect() {
		if (!input.current) return;
		input.current.focus();
		input.current.select();
		setOpen(true);
	}

	function clearAndFocus() {
		search('');
		setActiveIdx(-1);
		setOpen(true);
		input.current?.focus();
	}

	function setActiveAndScroll(idx) {
		setActiveIdx(idx);
		if (!suggestionsContainer.current) return;
		const container = suggestionsContainer.current;
		const li = container.querySelector(`[data-uma-id="${query.suggestions[idx]}"]`);
		const ch = container.offsetHeight - 4;  // 4 for borders
		if (li.offsetTop < container.scrollTop) {
			container.scrollTop = li.offsetTop;
		} else if (li.offsetTop >= container.scrollTop + ch) {
			const h = li.offsetHeight;
			container.scrollTop = (li.offsetTop / h - (ch / h - 1)) * h;
		}
	}

	function handleClick(e) {
		const li = e.target.closest('.umaSuggestion');
		if (li == null) return;
		e.stopPropagation();
		confirm(li.dataset.umaId);
	}

	function handleInput(e) {
		search(e.target.value);
	}

	function handleKeyDown(e) {
		const l = query.suggestions.length;
		switch (e.keyCode) {
			case 13:
				if (activeIdx > -1) confirm(query.suggestions[activeIdx]);
				break;
			case 38:
				setActiveAndScroll((activeIdx - 1 + l) % l);
				break;
			case 40:
				setActiveAndScroll((activeIdx + 1 + l) % l);
				break;
		}
	}

	function handleBlur(e) {
		if (e.target.value.length == 0) {
			const currentName = (u && u.name && u.name[1]) || '';
			search(currentName);
		}
		setOpen(false);
	}

	async function handleSaveProfile() {
		try {
			const name = prompt('Enter a name for this profile (or leave empty for auto-generated):');
			if (name === null) return; // User cancelled
			await saveUmaProfile(props.currentState, name || undefined);
			alert('Profile saved!');
		} catch (error) {
			alert('Failed to save profile: ' + error.message);
		}
	}

	function handleOpenImport(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		setProfileImportOpen(true);
	}

	async function handleApplyImportedDraft(draft: ProfileImportDraft, saveProfileAfterApply: boolean) {
		let nextState = props.currentState || new HorseState();
		if (draft.outfitId) {
			nextState = nextState.set('outfitId', draft.outfitId);
		}
		if (draft.stats.speed != null) nextState = nextState.set('speed', draft.stats.speed);
		if (draft.stats.stamina != null) nextState = nextState.set('stamina', draft.stats.stamina);
		if (draft.stats.power != null) nextState = nextState.set('power', draft.stats.power);
		if (draft.stats.guts != null) nextState = nextState.set('guts', draft.stats.guts);
		if (draft.stats.wisdom != null) nextState = nextState.set('wisdom', draft.stats.wisdom);
		if (draft.uniqueLevel != null) nextState = nextState.set('uniqueLevel', draft.uniqueLevel);
		if (draft.skillIds.length > 0) {
			nextState = applySkillsChange(nextState, SkillSet(draft.skillIds));
		}
		if (props.onLoadProfile) {
			props.onLoadProfile(nextState);
		}
		if (saveProfileAfterApply) {
			await saveUmaProfile(nextState);
			alert('Imported profile applied and saved.');
		}
	}

	return (
		<>
			<div class="umaSelector">
				<div class="umaSelectorIconsBox">
					<img src={props.value ? withBasePath(icons[props.value]) : randomMob} onClick={focusAndSelect} title="Select uma" />
				</div>
				<div class="profileButtons">
					{props.currentState && <button type="button" className="resetUmaButton importButton" onClick={handleOpenImport} title="Import from screenshot">📷 Import</button>}
					<div class="profileButtonsRow">
						{props.currentState && <button className="resetUmaButton" onClick={handleSaveProfile} title="Save current profile">Save</button>}
						{props.currentState && <button className="resetUmaButton" onClick={() => setProfileManagerOpen(true)} title="Load saved profile">Load</button>}
					</div>
				</div>
				<div class="resetButtons">
					{props.onReset && <button className="resetUmaButton" onClick={props.onReset} title="Reset this horse to default stats and skills">Reset</button>}
					{props.onResetAll && <button className="resetUmaButton" onClick={props.onResetAll} title="Reset all horses to default stats and skills">Reset All</button>}
				</div>
				<div class="umaNameStack">
					<div class="umaEpithet"><span>{props.value && getOutfitEpithet(props.value.slice(0,4), props.value)}</span></div>
					<div class="umaSelectWrapper">
						<div class="umaSelectField">
							<input type="text" class="umaSelectInput" value={query.input} tabindex={props.tabindex} onInput={handleInput} onKeyDown={handleKeyDown} onFocus={(e) => { setOpen(true); e.currentTarget.select(); }} onClick={(e) => e.currentTarget.select()} onBlur={handleBlur} ref={input} />
							<button type="button" class="umaSwitchButton" onClick={clearAndFocus} title="Switch uma">
								<img src={umaToolsAsset('icons/utx_ico_umamusume_00.png')} alt="" />
							</button>
						</div>
						<ul class={`umaSuggestions ${open ? 'open' : ''}`} onMouseDown={handleClick} ref={suggestionsContainer}>
							{query.suggestions.map((oid, i) => {
								const uid = oid.slice(0,4);
								const outfitName = getOutfitEpithet(uid, oid);
								return (
									<li key={oid} data-uma-id={oid} class={`umaSuggestion ${i == activeIdx ? 'selected' : ''}`}>
										<img src={withBasePath(icons[oid])} loading="lazy" />
										<span class="umaSuggestionText">
											{outfitName && <span class="umaSuggestionOutfit">{outfitName}</span>}
											<span class="umaSuggestionName">{umas[uid].name[1]}</span>
										</span>
									</li>
								);
							})}
						</ul>
					</div>
				</div>
			</div>
			{profileManagerOpen && (
				<UmaProfileManager
					currentState={props.currentState}
					onLoad={(loadedState) => {
						if (props.onLoadProfile) {
							props.onLoadProfile(loadedState);
						}
						setProfileManagerOpen(false);
					}}
					onClose={() => setProfileManagerOpen(false)}
				/>
			)}
			<ProfileScreenshotImportDialog
				isOpen={profileImportOpen}
				onClose={() => setProfileImportOpen(false)}
				onApplyDraft={handleApplyImportedDraft}
			/>
		</>
	);
}

function rankForStat(x: number) {
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

export function Stat(props) {
	return (
		<div class="horseParam">
			<img src={umaToolsAsset(`icons/statusrank/ui_statusrank_${(100 + rankForStat(props.value)).toString().slice(1)}.png`)} />
			<input type="number" min="1" max="2000" value={props.value} tabindex={props.tabindex} disabled={props.disabled} onInput={(e) => props.change(+e.currentTarget.value)} style={props.disabled ? {opacity: 0.5, cursor: 'not-allowed'} : {}} />
		</div>
	);
}

const APTITUDES = Object.freeze(['S','A','B','C','D','E','F','G']);
export function AptitudeIcon(props) {
	const idx = 7 - APTITUDES.indexOf(props.a);
	return <img src={umaToolsAsset(`icons/utx_ico_statusrank_${(100 + idx).toString().slice(1)}.png`)} loading="lazy" />;
}

export function AptitudeSelect(props){
	const [open, setOpen] = useState(false);
	function setAptitude(e) {
		e.stopPropagation();
		props.setA(e.currentTarget.dataset.horseAptitude);
		setOpen(false);
	}
	function selectByKey(e: KeyboardEvent) {
		const k = e.key.toUpperCase();
		if (APTITUDES.indexOf(k) > -1) {
			props.setA(k);
		}
	}
	return (
		<div class="horseAptitudeSelect" tabindex={props.tabindex} onClick={() => setOpen(!open)} onBlur={setOpen.bind(null, false)} onKeyDown={selectByKey}>
			<span><AptitudeIcon a={props.a} /></span>
			<ul style={open ? "display:block" : "display:none"}>
				{APTITUDES.map(a => <li key={a} data-horse-aptitude={a} onClick={setAptitude}><AptitudeIcon a={a} /></li>)}
			</ul>
		</div>
	);
}

export function MoodSelect(props){
	const [open, setOpen] = useState(false);
	const moodValues = [
		{value: 2, icon: 'utx_ico_motivation_m_04', label: 'Great'},
		{value: 1, icon: 'utx_ico_motivation_m_03', label: 'Good'},
		{value: 0, icon: 'utx_ico_motivation_m_02', label: 'Normal'},
		{value: -1, icon: 'utx_ico_motivation_m_01', label: 'Bad'},
		{value: -2, icon: 'utx_ico_motivation_m_00', label: 'Awful'},
		{value: RANDOM_MOOD, icon: null, label: 'Random'}
	];
	
	function setMood(e) {
		e.stopPropagation();
		props.setM(+e.currentTarget.dataset.mood);
		setOpen(false);
	}
	
	return (
		<div class="horseMoodSelect" tabindex={props.tabindex} onClick={() => setOpen(!open)} onBlur={setOpen.bind(null, false)}>
			<span>
				{props.m === RANDOM_MOOD
					? <span title="Random">🎲</span>
					: <img src={umaToolsAsset(`icons/global/${moodValues.find(m => m.value === props.m)?.icon}.png`)} />
				}
			</span>
			<ul style={open ? "display:block" : "display:none"}>
				{moodValues.map(mood => 
					<li key={mood.value} data-mood={mood.value} onClick={setMood}>
						{mood.value === RANDOM_MOOD
							? <span title={mood.label}>🎲</span>
							: <img src={umaToolsAsset(`icons/global/${mood.icon}.png`)} title={mood.label} />
						}
					</li>
				)}
			</ul>
		</div>
	);
}

export function StrategySelect(props) {
	const disabled = props.disabled || false;
	const [open, setOpen] = useState(false);
	const options = CC_GLOBAL
		? [
			{ value: 'Oonige', label: 'Runaway' },
			{ value: 'Nige', label: 'Front Runner' },
			{ value: 'Senkou', label: 'Pace Chaser' },
			{ value: 'Sasi', label: 'Late Surger' },
			{ value: 'Oikomi', label: 'End Closer' },
		]
		: [
			{ value: 'Nige', label: '逃げ' },
			{ value: 'Senkou', label: '先行' },
			{ value: 'Sasi', label: '差し' },
			{ value: 'Oikomi', label: '追込' },
			{ value: 'Oonige', label: '大逃げ' },
		];
	const current = options.find(o => o.value === props.s) || options[0];

	function choose(value: string) {
		if (disabled) return;
		props.setS(value);
		setOpen(false);
	}

	return (
		<div
			class="horseStrategySelect"
			tabindex={props.tabindex}
			aria-disabled={disabled ? 'true' : 'false'}
			onClick={() => { if (!disabled) setOpen(!open); }}
			onBlur={() => setOpen(false)}
		>
			<span><em>{current.label}</em></span>
			<ul style={open ? 'display:block' : 'display:none'}>
				{options.map(o => (
					<li
						key={o.value}
						aria-selected={o.value === props.s ? 'true' : 'false'}
						onClick={(e) => { e.stopPropagation(); choose(o.value); }}
					>
						{o.label}
					</li>
				))}
			</ul>
		</div>
	);
}

export function StarLevelSelect(props) {
	const [hovered, setHovered] = useState(0);
	const levels = [1, 2, 3, 4, 5];
	const filled = hovered || props.value;
	function onKeyDown(e) {
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			e.preventDefault();
			props.onChange(Math.min(5, props.value + 1));
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			e.preventDefault();
			props.onChange(Math.max(1, props.value - 1));
		} else if (e.key >= '1' && e.key <= '5') {
			props.onChange(+e.key);
		}
	}
	return (
		<div
			class="horseStarLevelSelect"
			tabindex={props.tabindex}
			role="radiogroup"
			aria-label="Star Level"
			onMouseLeave={() => setHovered(0)}
			onKeyDown={onKeyDown}
		>
			{levels.map(lvl => (
				<button
					type="button"
					key={lvl}
					class={`horseStar${lvl <= filled ? ' is-filled' : ''}`}
					role="radio"
					aria-checked={lvl === props.value ? 'true' : 'false'}
					aria-label={`${lvl} star${lvl === 1 ? '' : 's'}`}
					tabindex={-1}
					onMouseEnter={() => setHovered(lvl)}
					onClick={(e) => {
						e.stopPropagation();
						props.onChange(lvl);
					}}
				>★</button>
			))}
		</div>
	);
}

const nonUniqueSkills = Object.keys(skilldata).filter(id => skilldata[id].rarity < 3 || skilldata[id].rarity > 5);
const universallyAccessiblePinks = ['92111091' /* welfare kraft alt pink unique inherit */].concat(Object.keys(skilldata).filter(id => id[0] == '4'));

export function isGeneralSkill(id: string) {
	return skilldata[id].rarity < 3 || universallyAccessiblePinks.indexOf(id) > -1;
}

function assertIsSkill(sid: string): asserts sid is keyof typeof skilldata {
	console.assert(skilldata[sid] != null);
}

function uniqueSkillForUma(oid: typeof umaAltIds[number]): keyof typeof skilldata {
	const i = +oid.slice(1, -2), v = +oid.slice(-2);
	const sid = (100000 + 10000 * (v - 1) + i * 10 + 1).toString();
	assertIsSkill(sid);
	return sid;
}

function skillOrder(a, b) {
	const x = skillmeta[a].order, y = skillmeta[b].order;
	return +(y < x) - +(x < y) || +(b < a) - +(a < b);
}

let totalTabs = 0;
export function horseDefTabs() {
	return totalTabs;
}

export function HorseDef(props) {
	const {state, setState} = props;
	const [skillPickerOpen, setSkillPickerOpen] = useState(false);
	const [detailSkillId, setDetailSkillId] = useState<string | null>(null);
	const [detailAnchor, setDetailAnchor] = useState<HTMLElement | null>(null);
	const skillDetailPopoverRef = useRef<HTMLDivElement>(null);

	const tabstart = props.tabstart();
	let tabi = 0;
	function tabnext() {
		if (++tabi > totalTabs) totalTabs = tabi;
		return tabstart + tabi - 1;
	}

	const umaId = state.outfitId;
	const selectableSkills = useMemo(() => nonUniqueSkills.filter(id => skilldata[id].rarity != 6 || id.startsWith(umaId) || universallyAccessiblePinks.indexOf(id) != -1), [umaId]);

	function setter(prop: keyof HorseState) {
		return (x) => setState(state.set(prop, x));
	}
	function setStrategy(strategy: HorseState['strategy']) {
		setState(state => applyStrategyChange(state, strategy));
	}
	function setSkills(newSkills: HorseState['skills']) {
		setState(state => applySkillsChange(state, newSkills));
	}
	function loadProfile(loaded: HorseState) {
		let next = loaded;
		if (hasRunawaySkill(next.skills)) {
			// A loaded/imported state already contains its final skill set, so there
			// is no before/after transition for applySkillsChange to detect.
			next = next.set('strategy', 'Oonige');
		} else if (next.strategy === 'Oonige') {
			next = applyStrategyChange(next, 'Oonige');
		}
		setState(next);
	}

	function closeSkillDetail() {
		setDetailSkillId(null);
		setDetailAnchor(null);
	}

	function setUma(id) {
		let newSkills = state.skills.filter(isGeneralSkill);
		let nextState = state;

		if (id) {
			const uid = uniqueSkillForUma(id);
			newSkills = newSkills.set(skillmeta[uid].groupId, uid);
			const outfitData = getOutfitData(id.slice(0, 4), id);
			const strategy = strategyFromOutfitData(outfitData);
			if (strategy) {
				nextState = nextState.set('strategy', strategy);
				const mappedStrategyAptitude = strategyAptitudeFromOutfitData(outfitData, strategy);
				if (mappedStrategyAptitude) {
					nextState = nextState.set('strategyAptitude', mappedStrategyAptitude);
				}
			}
		}

		const removedSkillIds = nextState.skills.valueSeq().toSet().subtract(newSkills.valueSeq().toSet());
		let newForcedPositions = nextState.forcedSkillPositions;
		removedSkillIds.forEach(skillId => {
			newForcedPositions = newForcedPositions.delete(skillId);
		});

		setState(applySkillsChange(
			nextState.set('outfitId', id)
				.set('forcedSkillPositions', newForcedPositions),
			newSkills
		));
	}

	function resetThisHorse() {
		setState(new HorseState());
	}

	function openSkillPicker(e) {
		e.stopPropagation();
		setSkillPickerOpen(true);
	}

	function setSkillsAndClose(skills) {
		setSkills(skills);
		setSkillPickerOpen(false);
	}

	function handleSkillClick(e) {
		e.stopPropagation();
		if (e.target.classList.contains('forcedPositionInput') || e.target.closest('.uniqueSkillLevelSelect')) {
			return;
		}
		const se = e.target.closest('.skill');
		if (se == null || se.classList.contains('addSkillButton')) return;
		const skillId = se.dataset.skillid;
		if (e.target.classList.contains('skillDismiss')) {
			const newSkills = state.skills.delete(state.skills.findKey(id => id == skillId));
			setState(applySkillsChange(
				state.set('forcedSkillPositions', state.forcedSkillPositions.delete(skillId)),
				newSkills
			));
			if (detailSkillId === skillId) closeSkillDetail();
			return;
		}
		if (detailSkillId === skillId) {
			closeSkillDetail();
			return;
		}
		setDetailSkillId(skillId);
		setDetailAnchor(se as HTMLElement);
	}

	function handlePositionChange(skillId: string, value: string) {
		const numValue = parseFloat(value);
		if (value === '' || isNaN(numValue)) {
			setState(state.set('forcedSkillPositions', state.forcedSkillPositions.delete(skillId)));
		} else {
			setState(state.set('forcedSkillPositions', state.forcedSkillPositions.set(skillId, numValue)));
		}
	}

	useEffect(function () {
		if (!detailSkillId || !detailAnchor || !skillDetailPopoverRef.current) return;
		const popover = skillDetailPopoverRef.current;
		popover.style.visibility = 'hidden';
		computePosition(detailAnchor, popover, {
			placement: 'right-start',
			middleware: [flip(), shift({ padding: 8 })],
		}).then(({ x, y }) => {
			if (!skillDetailPopoverRef.current) return;
			const scale = visualScale(skillDetailPopoverRef.current);
			skillDetailPopoverRef.current.style.transform = `translate(${x / scale}px, ${y / scale}px)`;
			skillDetailPopoverRef.current.style.visibility = 'visible';
		});

		function onDocPointerDown(ev: MouseEvent) {
			const target = ev.target as HTMLElement;
			if (popover.contains(target)) return;
			if (detailAnchor.contains(target)) return;
			/* Skill chips toggle via handleSkillClick; don't race-close here. */
			if (target.closest('.horseSkillListWrapper')) return;
			closeSkillDetail();
		}
		function onKeyDown(ev: KeyboardEvent) {
			if (ev.key === 'Escape') closeSkillDetail();
		}
		document.addEventListener('mousedown', onDocPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onDocPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [detailSkillId, detailAnchor]);

	useEffect(function () {
		const currentSkillIds = state.skills.valueSeq().toSet();
		const forcedPositionSkillIds = state.forcedSkillPositions.keySeq().toSet();
		const orphanedSkillIds = forcedPositionSkillIds.subtract(currentSkillIds);
		if (orphanedSkillIds.size > 0) {
			let newForcedPositions = state.forcedSkillPositions;
			orphanedSkillIds.forEach(skillId => {
				newForcedPositions = newForcedPositions.delete(skillId);
			});
			setState(state.set('forcedSkillPositions', newForcedPositions));
		}
		if (detailSkillId && !currentSkillIds.has(detailSkillId)) {
			closeSkillDetail();
		}
	}, [state.skills]);

	const u = uniqueSkillForUma(umaId);
	const aptitudeVector = useMemo(
		() => buildAptitudeVector(state.distanceAptitude, state.strategyAptitude, state.surfaceAptitude),
		[state.distanceAptitude, state.strategyAptitude, state.surfaceAptitude]
	);

	const skillList = useMemo(function () {
		return Array.from(state.skills.values()).sort(skillOrder).map(id => {
			const isUnique = id == u;
			return (
				<li key={id}>
					<div class="horseSkillItem">
						<div class="horseSkillItemMain">
							<Skill
								id={id}
								selected={false}
								dismissable={id != u}
								trailing={isUnique ? (
									<select
										class="uniqueSkillLevelSelect"
										value={state.uniqueLevel || 0}
										onChange={(e) => setState(prev => prev.set('uniqueLevel', parseInt((e.target as HTMLSelectElement).value, 10)))}
										onClick={(e) => e.stopPropagation()}
									>
										<option value={0}>Lv 0</option>
										{[1, 2, 3, 4, 5, 6].map(lvl => <option key={lvl} value={lvl}>Lv {lvl}</option>)}
									</select>
								) : null}
							/>
						</div>
						{state.forcedSkillPositions.has(id) && (
							<span class="forcedPositionLabel inline">
								@{state.forcedSkillPositions.get(id)}m
							</span>
						)}
					</div>
				</li>
			);
		});
	}, [state.skills, umaId, state.forcedSkillPositions, state.uniqueLevel]);

	// Calculate career rating with async skill score
	const [skillScore, setSkillScore] = useState(0);
	
	useEffect(() => {
		// Get all skills except unique skill
		const nonUniqueSkillIds = Array.from(state.skills.values()).filter(id => id != u);
		calculateSkillScore(nonUniqueSkillIds, aptitudeVector).then(score => {
			setSkillScore(score);
		}).catch(err => {
			console.warn('Failed to calculate skill score:', err);
			setSkillScore(0);
		});
	}, [state.skills, u, aptitudeVector]);
	
	const ratingBreakdown = useMemo(() => {
		return calculateRatingBreakdown(
			{
				speed: state.speed,
				stamina: state.stamina,
				power: state.power,
				guts: state.guts,
				wisdom: state.wisdom
			},
			skillScore,
			state.starLevel || 3,
			state.uniqueLevel || 0
		);
	}, [state.speed, state.stamina, state.power, state.guts, state.wisdom, skillScore, state.starLevel, state.uniqueLevel]);

	const ratingBadge = useMemo(() => getRatingBadge(ratingBreakdown.total), [ratingBreakdown.total]);

	return (
		<div class="horseDef">
			<div class="horseDefHeader">{props.children}</div>
			<UmaSelector value={umaId} select={setUma} tabindex={tabnext()} onReset={resetThisHorse} onResetAll={props.onResetAll} currentState={state} onLoadProfile={loadProfile} />
			<div class="horseParams">
				<div class="horseParamHeader"><img src={umaToolsAsset('icons/status_00.png')} /><span>Speed</span></div>
				<div class="horseParamHeader"><img src={umaToolsAsset('icons/status_01.png')} /><span>Stamina</span></div>
				<div class="horseParamHeader"><img src={umaToolsAsset('icons/status_02.png')} /><span>Power</span></div>
				<div class="horseParamHeader"><img src={umaToolsAsset('icons/status_03.png')} /><span>Guts</span></div>
				<div class="horseParamHeader"><img src={umaToolsAsset('icons/status_04.png')} /><span>{CC_GLOBAL?'Wit':'Wisdom'}</span></div>
				<Stat value={state.speed} change={setter('speed')} tabindex={tabnext()} disabled={props.disableStats} />
				<Stat value={state.stamina} change={setter('stamina')} tabindex={tabnext()} disabled={props.disableStats} />
				<Stat value={state.power} change={setter('power')} tabindex={tabnext()} disabled={props.disableStats} />
				<Stat value={state.guts} change={setter('guts')} tabindex={tabnext()} disabled={props.disableStats} />
				<Stat value={state.wisdom} change={setter('wisdom')} tabindex={tabnext()} disabled={props.disableStats} />
			</div>
			<div class="horseAptitudes">
				<div>
					<span>Surface aptitude:</span>
					<AptitudeSelect a={state.surfaceAptitude} setA={setter('surfaceAptitude')} tabindex={tabnext()} />
				</div>
				<div>
					<span>Distance aptitude:</span>
					<AptitudeSelect a={state.distanceAptitude} setA={setter('distanceAptitude')} tabindex={tabnext()} />
				</div>
				<div>
					<span>Mood:</span>
					<MoodSelect m={state.mood} setM={setter('mood')} tabindex={tabnext()} />
				</div>
				<div>
					<span>{CC_GLOBAL ? 'Style:' : 'Strategy:'}</span>
					<StrategySelect s={state.strategy} setS={setStrategy} tabindex={tabnext()} />
				</div>
				<div>
					<span>{CC_GLOBAL ? 'Style aptitude:' : 'Strategy aptitude:'}</span>
					<AptitudeSelect a={state.strategyAptitude} setA={setter('strategyAptitude')} tabindex={tabnext()} />
				</div>
				<div>
					<span>Star Level:</span>
					<StarLevelSelect
						value={state.starLevel || 3}
						onChange={(lvl: number) => setState(state.set('starLevel', lvl))}
						tabindex={tabnext()}
					/>
				</div>
			</div>
			<div class="careerRatingDisplay">
				<div class="careerRatingMain">
					<div 
						class="careerRatingBadge" 
						style={{
							backgroundImage: `url(${umaToolsAsset('icons/rank_badges.png')})`,
							backgroundSize: '432px 432px',
							backgroundPosition: `-${ratingBadge.sprite.col * 72}px -${ratingBadge.sprite.row * 72}px`,
							width: '72px',
							height: '72px',
							display: 'inline-block',
							verticalAlign: 'middle'
						}}
						title={ratingBadge.label}
					/>
					<span class="careerRatingTotal">
						<span class="careerRatingBreakdownLabel">Career Rating</span>
						<strong class="careerRatingNumber">{ratingBreakdown.total.toLocaleString()}</strong>
					</span>
				</div>
				<div class="careerRatingBreakdown">
					<span class="careerRatingBreakdownRow">
						<span class="careerRatingBreakdownLabel">Stat Rating</span>
						<strong class="careerRatingBreakdownValue">{ratingBreakdown.statsScore.toLocaleString()}</strong>
					</span>
					<span class="careerRatingBreakdownRow">
						<span class="careerRatingBreakdownLabel">Skill Contribution</span>
						<strong class="careerRatingBreakdownValue">{ratingBreakdown.skillScore.toLocaleString()}</strong>
					</span>
					<span class="careerRatingBreakdownRow">
						<span class="careerRatingBreakdownLabel">Unique Bonus</span>
						<strong class="careerRatingBreakdownValue">{ratingBreakdown.uniqueBonus.toLocaleString()}</strong>
					</span>
				</div>
			</div>
			<div class="horseSkillListWrapper" onClick={handleSkillClick}>
				<ul class="horseSkillList">
					{skillList}
					<li key="add">
						<div class="skill addSkillButton" onClick={openSkillPicker} tabindex={tabnext()}>
							<span>+</span>Add Skill
						</div>
					</li>
				</ul>
			</div>
			{createPortal(
				<>
					<div class={`horseSkillPickerOverlay ${skillPickerOpen ? "open" : ""}`} onClick={setSkillPickerOpen.bind(null, false)} />
					<div
						class={`horseSkillPickerWrapper ${skillPickerOpen ? "open" : ""}`}
						onMouseDown={(e) => e.stopPropagation()}
						onClick={(e) => e.stopPropagation()}
					>
						<SkillList ids={selectableSkills} selected={state.skills} setSelected={setSkillsAndClose} isOpen={skillPickerOpen} />
					</div>
				</>,
				document.body
			)}
			{detailSkillId && createPortal(
				<div
					class="horseSkillDetailPopover"
					style="visibility:hidden"
					ref={skillDetailPopoverRef}
					onClick={(e) => {
						const dismiss = (e.target as HTMLElement).closest('.skillDismiss');
						if (!dismiss) return;
						e.stopPropagation();
						closeSkillDetail();
					}}
				>
					<ExpandedSkillDetails
						id={detailSkillId}
						distanceFactor={props.courseDistance}
						raceContext={{
							...(props.raceContext || {}),
							runningStyle: ({Nige: 1, Senkou: 2, Sasi: 3, Oikomi: 4, Oonige: 1} as const)[state.strategy]
						}}
						dismissable={detailSkillId != u}
						starLevel={state.starLevel || 3}
						forcedPosition={state.forcedSkillPositions.get(detailSkillId) || ''}
						onPositionChange={(value: string) => handlePositionChange(detailSkillId, value)}
						aptitudes={aptitudeVector}
						uniqueLevel={detailSkillId == u ? (state.uniqueLevel || 0) : undefined}
						onUniqueLevelChange={detailSkillId == u ? ((level: number) => setState(prev => prev.set('uniqueLevel', level))) : undefined}
					/>
				</div>,
				document.body
			)}
		</div>
	);
}

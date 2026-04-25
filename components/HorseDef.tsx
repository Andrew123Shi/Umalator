import { h, Fragment } from 'preact';
import { useState, useReducer, useMemo, useEffect, useRef } from 'preact/hooks';
import { IntlProvider, Text, Localizer } from 'preact-i18n';
import { Set as ImmSet } from 'immutable';

import { SkillList, Skill, ExpandedSkillDetails } from '../components/SkillList';
import { SkillProcDataDialog } from './SkillProcDataDialog';
import { ProfileScreenshotImportDialog } from './ProfileScreenshotImportDialog';
import { ProfileImportDraft } from './ProfileScreenshotImportV3';

import { HorseParameters } from '../uma-skill-tools/HorseTypes';

import { SkillSet, HorseState } from './HorseDefTypes';

import './HorseDef.css';

import umas from '../umalator/umas.json';
import icons from '../icons.json';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillmeta from '../umalator/skill_meta.json';

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

	return (
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
												<img src={icons[umaId]} class="umaProfileManagerUmaIcon" />
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
													<button class="umaProfileManagerActionButton" onClick={() => handleLoad(profile.id)} title="Load">Load</button>
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
		</>
	);
}

export function UmaSelector(props) {
	const randomMob = useMemo(() => `/uma-tools/icons/mob/trained_mob_chr_icon_${8000 + Math.floor(Math.random() * 624)}_000001_01.png`, []);
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

	function focus() {
		input.current && input.current.select();
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
		if (e.target.value.length == 0) props.select('');
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
			nextState = nextState.set('skills', SkillSet(draft.skillIds));
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
				<div class="umaSelectorIconsBox" onClick={focus}>
					<img src={props.value ? icons[props.value] : randomMob} />
					<img src="/uma-tools/icons/utx_ico_umamusume_00.png" />
				</div>
				<div class="umaEpithet"><span>{props.value && getOutfitEpithet(props.value.slice(0,4), props.value)}</span></div>
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
				<div class="umaSelectWrapper">
					<input type="text" class="umaSelectInput" value={query.input} tabindex={props.tabindex} onInput={handleInput} onKeyDown={handleKeyDown} onFocus={() => setOpen(true)} onBlur={handleBlur} ref={input} />
					<ul class={`umaSuggestions ${open ? 'open' : ''}`} onMouseDown={handleClick} ref={suggestionsContainer}>
						{query.suggestions.map((oid, i) => {
							const uid = oid.slice(0,4);
							return (
								<li key={oid} data-uma-id={oid} class={`umaSuggestion ${i == activeIdx ? 'selected' : ''}`}>
									<img src={icons[oid]} loading="lazy" /><span>{getOutfitEpithet(uid, oid)} {umas[uid].name[1]}</span>
								</li>
							);
						})}
					</ul>
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
			<img src={`/uma-tools/icons/statusrank/ui_statusrank_${(100 + rankForStat(props.value)).toString().slice(1)}.png`} />
			<input type="number" min="1" max="2000" value={props.value} tabindex={props.tabindex} disabled={props.disabled} onInput={(e) => props.change(+e.currentTarget.value)} style={props.disabled ? {opacity: 0.5, cursor: 'not-allowed'} : {}} />
		</div>
	);
}

const APTITUDES = Object.freeze(['S','A','B','C','D','E','F','G']);
export function AptitudeIcon(props) {
	const idx = 7 - APTITUDES.indexOf(props.a);
	return <img src={`/uma-tools/icons/utx_ico_statusrank_${(100 + idx).toString().slice(1)}.png`} loading="lazy" />;
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
		{value: -2, icon: 'utx_ico_motivation_m_00', label: 'Awful'}
	];
	
	function setMood(e) {
		e.stopPropagation();
		props.setM(+e.currentTarget.dataset.mood);
		setOpen(false);
	}
	
	return (
		<div class="horseMoodSelect" tabindex={props.tabindex} onClick={() => setOpen(!open)} onBlur={setOpen.bind(null, false)}>
			<span>
				<img src={`/uma-tools/icons/global/${moodValues.find(m => m.value === props.m)?.icon}.png`} />
			</span>
			<ul style={open ? "display:block" : "display:none"}>
				{moodValues.map(mood => 
					<li key={mood.value} data-mood={mood.value} onClick={setMood}>
						<img src={`/uma-tools/icons/global/${mood.icon}.png`} title={mood.label} />
					</li>
				)}
			</ul>
		</div>
	);
}

export function StrategySelect(props) {
	const disabled = props.disabled || false;
	if (CC_GLOBAL) {
		return (
			<select class="horseStrategySelect" value={props.s} tabindex={props.tabindex} disabled={disabled} onInput={(e) => props.setS(e.currentTarget.value)}>
				<option value="Oonige">Runaway</option>
				<option value="Nige">Front Runner</option>
				<option value="Senkou">Pace Chaser</option>
				<option value="Sasi">Late Surger</option>
				<option value="Oikomi">End Closer</option>
			</select>
		);
	}
	return (
		<select class="horseStrategySelect" value={props.s} tabindex={props.tabindex} disabled={disabled} onInput={(e) => props.setS(e.currentTarget.value)}>
			<option value="Nige">逃げ</option>
			<option value="Senkou">先行</option>
			<option value="Sasi">差し</option>
			<option value="Oikomi">追込</option>
			<option value="Oonige">大逃げ</option>
		</select>
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
	const [expanded, setExpanded] = useState(() => ImmSet());
	const [procDataSkillId, setProcDataSkillId] = useState<string | null>(null);

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
	const setSkills = setter('skills');

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

		setState(
			nextState.set('outfitId', id)
				.set('skills', newSkills)
				.set('forcedSkillPositions', newForcedPositions)
		);
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
		// Don't toggle expansion if clicking on position input
		if (e.target.classList.contains('forcedPositionInput')) {
			return;
		}
		const se = e.target.closest('.skill, .expandedSkill');
		if (se == null) return;
		if (e.target.classList.contains('skillDismiss')) {
			// can't just remove skillmeta[skillid].groupId because debuffs will have a fake groupId
			const skillId = se.dataset.skillid;
			setState(
				state.set('skills', state.skills.delete(state.skills.findKey(id => id == skillId)))
					.set('forcedSkillPositions', state.forcedSkillPositions.delete(skillId))
			);
		} else if (se.classList.contains('expandedSkill')) {
			setExpanded(expanded.delete(se.dataset.skillid));
		} else {
			setExpanded(expanded.add(se.dataset.skillid));
		}
	}

	function handlePositionChange(skillId: string, value: string) {
		const numValue = parseFloat(value);
		if (value === '' || isNaN(numValue)) {
			// Clear the forced position
			setState(state.set('forcedSkillPositions', state.forcedSkillPositions.delete(skillId)));
		} else {
			// Set the forced position
			setState(state.set('forcedSkillPositions', state.forcedSkillPositions.set(skillId, numValue)));
		}
	}

	useEffect(function () {
		window.requestAnimationFrame(() =>
			document.querySelectorAll('.horseExpandedSkill').forEach(e => {
				(e as HTMLElement).style.gridRow = 'span ' + Math.ceil((e.firstChild as HTMLElement).offsetHeight / 64);
			})
		);
	}, [expanded]);

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
	}, [state.skills]);

	const hasRunawaySkill = state.skills.has('202051');
	useEffect(function () {
		if (hasRunawaySkill && state.strategy !== 'Oonige') {
			setState(state.set('strategy', 'Oonige'));
		}
	}, [hasRunawaySkill, state.strategy]);

	const u = uniqueSkillForUma(umaId);
	const aptitudeVector = useMemo(
		() => buildAptitudeVector(state.distanceAptitude, state.strategyAptitude, state.surfaceAptitude),
		[state.distanceAptitude, state.strategyAptitude, state.surfaceAptitude]
	);
	
	const skillList = useMemo(function () {
		const hasRunData = props.runData != null && props.umaIndex != null;
		return Array.from(state.skills.values()).sort(skillOrder).map(id => {
			const isUnique = id == u;
			return expanded.has(id)
				? <li key={id} class="horseExpandedSkill">
					  <ExpandedSkillDetails 
						  id={id} 
						  distanceFactor={props.courseDistance} 
						  dismissable={id != u}
						  starLevel={state.starLevel || 3}
						  forcedPosition={state.forcedSkillPositions.get(id) || ''}
						  onPositionChange={(value: string) => handlePositionChange(id, value)}
						  runData={hasRunData ? props.runData : null}
						  umaIndex={hasRunData ? props.umaIndex : null}
						  onViewProcData={hasRunData ? () => setProcDataSkillId(id) : null}
						  aptitudes={aptitudeVector}
						  uniqueLevel={isUnique ? (state.uniqueLevel || 0) : undefined}
						  onUniqueLevelChange={isUnique ? ((level: number) => setState(prev => prev.set('uniqueLevel', level))) : undefined}
					  />
				  </li>
				: <li key={id} style="">
					  <div style="display: flex; align-items: center; gap: 8px; position: relative;">
						  <div style={isUnique ? "position: relative; flex: 1;" : ""}>
							  <Skill id={id} selected={false} dismissable={id != u} />
							  {isUnique && (
								  <select 
									  class="uniqueSkillLevelSelect"
									  value={state.uniqueLevel || 0} 
								  onChange={(e) => setState(prev => prev.set('uniqueLevel', parseInt((e.target as HTMLSelectElement).value, 10)))}
									  onClick={(e) => e.stopPropagation()}
								  >
									  <option value={0}>Lv 0</option>
									  {[1, 2, 3, 4, 5, 6].map(lvl => <option key={lvl} value={lvl}>Lv {lvl}</option>)}
								  </select>
							  )}
						  </div>
						  {state.forcedSkillPositions.has(id) && (
							  <span class="forcedPositionLabel inline">
								  @{state.forcedSkillPositions.get(id)}m
							  </span>
						  )}
					  </div>
				  </li>
		});
	}, [state.skills, umaId, expanded, props.courseDistance, state.forcedSkillPositions, state.uniqueLevel, props.runData, props.umaIndex, aptitudeVector]);

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
			<UmaSelector value={umaId} select={setUma} tabindex={tabnext()} onReset={resetThisHorse} onResetAll={props.onResetAll} currentState={state} onLoadProfile={setState} />
			<div class="horseParams">
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_00.png" /><span>Speed</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_01.png" /><span>Stamina</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_02.png" /><span>Power</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_03.png" /><span>Guts</span></div>
				<div class="horseParamHeader"><img src="/uma-tools/icons/status_04.png" /><span>{CC_GLOBAL?'Wit':'Wisdom'}</span></div>
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
					<StrategySelect s={state.strategy} setS={setter('strategy')} disabled={hasRunawaySkill} tabindex={tabnext()} />
				</div>
				<div>
					<span>{CC_GLOBAL ? 'Style aptitude:' : 'Strategy aptitude:'}</span>
					<AptitudeSelect a={state.strategyAptitude} setA={setter('strategyAptitude')} tabindex={tabnext()} />
				</div>
				<div>
					<span>Star Level:</span>
					<select 
						class="horseStrategySelect"
						value={state.starLevel || 3} 
						onChange={(e) => setState(state.set('starLevel', parseInt((e.target as HTMLSelectElement).value, 10)))}
						tabIndex={tabnext()}
					>
						{[1, 2, 3, 4, 5].map(lvl => <option key={lvl} value={lvl}>{lvl}★</option>)}
					</select>
				</div>
			</div>
			<div class="careerRatingDisplay">
				<div class="careerRatingLeftSpacer"></div>
				<div class="careerRatingMain">
					<span class="careerRatingLabel">Career Rating: </span>
					<div 
						class="careerRatingBadge" 
						style={{
							backgroundImage: `url(/uma-tools/icons/rank_badges.png)`,
							backgroundSize: '576px 576px',
							backgroundPosition: `-${ratingBadge.sprite.col * 96}px -${ratingBadge.sprite.row * 96}px`,
							width: '96px',
							height: '96px',
							display: 'inline-block',
							verticalAlign: 'middle',
							marginLeft: '8px',
							marginRight: '8px'
						}}
						title={ratingBadge.label}
					/>
					<span class="careerRatingNumber">{ratingBreakdown.total.toLocaleString()}</span>
				</div>
				<div class="careerRatingBreakdown">
					<span class="careerRatingBreakdownRow">
						<span class="careerRatingBreakdownLabel">Stat Rating:</span>
						<strong class="careerRatingBreakdownValue">{ratingBreakdown.statsScore.toLocaleString()}</strong>
					</span>
					<span class="careerRatingBreakdownRow">
						<span class="careerRatingBreakdownLabel">Skill Contribution:</span>
						<strong class="careerRatingBreakdownValue">{ratingBreakdown.skillScore.toLocaleString()}</strong>
					</span>
					<span class="careerRatingBreakdownRow">
						<span class="careerRatingBreakdownLabel">Unique Bonus:</span>
						<strong class="careerRatingBreakdownValue">{ratingBreakdown.uniqueBonus.toLocaleString()}</strong>
					</span>
				</div>
			</div>
			<div class="horseSkillHeader">Skills</div>
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
			<div class={`horseSkillPickerOverlay ${skillPickerOpen ? "open" : ""}`} onClick={setSkillPickerOpen.bind(null, false)} />
			<div class={`horseSkillPickerWrapper ${skillPickerOpen ? "open" : ""}`}>
				<SkillList ids={selectableSkills} selected={state.skills} setSelected={setSkillsAndClose} isOpen={skillPickerOpen} />
			</div>
			{procDataSkillId && props.runData != null && props.umaIndex != null && (
				<SkillProcDataDialog
					skillId={procDataSkillId}
					compareRunData={props.runData}
					courseDistance={props.courseDistance}
					umaIndex={props.umaIndex}
					onClose={() => setProcDataSkillId(null)}
				/>
			)}
		</div>
	);
}

import { Record, Map as ImmMap } from 'immutable';

import skills from '../uma-skill-tools/data/skill_data.json';
import skillmeta from '../umalator/skill_meta.json';
import { RUNAWAY_STYLE_SKILL_ID } from '../uma-skill-tools/SkillConstants';

export { RUNAWAY_STYLE_SKILL_ID };
export const RUNAWAY_SKILL_GROUP_ID = skillmeta[RUNAWAY_STYLE_SKILL_ID].groupId;

export const RANDOM_MOOD = 99;

function isKnownSkill(id: string) {
	return id in skillmeta && id in skills;
}

export function isDebuffSkill(id: string) {
	if (!isKnownSkill(id)) return false;
	// iconId 3xxxx is the debuff icons
	// i think this basically matches the intuitive behavior of being able to add multiple debuff skills and not other skills;
	// e.g. there are some skills with both a debuff component and a positive component and typically it doesnt make sense to
	// add multiple of those
	return skillmeta[id].iconId[0] == '3';
}

export function SkillSet(ids): ImmMap<(typeof skill_meta)['groupId'], keyof typeof skills> {
	return ImmMap((ids || []).reduce((acc, id) => {
		const {entries, ndebuff} = acc;
		if (!isKnownSkill(id)) return acc;
		const groupId = skillmeta[id].groupId;
		if (isDebuffSkill(id)) {
			entries.push([groupId + '-' + ndebuff, id]);
			return {entries, ndebuff: ndebuff + 1};
		} else {
			entries.push([groupId, id]);
			return {entries, ndebuff};
		}
	}, {entries: [], ndebuff: 0}).entries);
}

export class HorseState extends Record({
	outfitId: '',
	speed:   CC_GLOBAL ? 1600 : 1850,
	stamina: CC_GLOBAL ? 1000 : 1700,
	power:   CC_GLOBAL ? 1200 : 1700,
	guts:    CC_GLOBAL ? 600 : 1200,
	wisdom:  CC_GLOBAL ? 600 : 1300,
	strategy: 'Senkou',
	distanceAptitude: 'S',
	surfaceAptitude: 'A',
	strategyAptitude: 'A',
	mood: 2 as Mood,
	skills: SkillSet([]),
	// Map of skillId -> forced position (in meters). If a skill is in this map, it will be forced to activate at that position.
	forcedSkillPositions: ImmMap(),
	// Career rating related fields
	starLevel: 3 as number,
	uniqueLevel: 4 as number
}) {}

/** Skills map is keyed by groupId, not skill id — use this to test for Runaway. */
export function hasRunawaySkill(skills: HorseState['skills']): boolean {
	return skills.get(RUNAWAY_SKILL_GROUP_ID) === RUNAWAY_STYLE_SKILL_ID;
}

import { h, Fragment, cloneElement, toChildArray, createContext } from 'preact';
import { useState, useContext, useMemo, useEffect, useRef } from 'preact/hooks';
import { IntlProvider, Text, Localizer } from 'preact-i18n';

import { getParser, NodeType } from '../uma-skill-tools/ConditionParser';
import * as Matcher from '../uma-skill-tools/tools/ConditionMatcher';
import { SkillRarity } from '../uma-skill-tools/RaceSolver.ts';

import { useLanguage } from './Language';
import { Tooltip } from './Tooltip';
import { isDebuffSkill } from './HorseDefTypes';
import { getSkillRatingContributionWithAptitude, calcUniqueBonus, Aptitude } from './CareerRating';
import { umaToolsAsset } from './assetPaths';

import './SkillList.css';

import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import skillmeta from '../umalator/skill_meta.json';

const Parser = getParser(Matcher.mockConditions);

export const STRINGS_ja = Object.freeze({
	'skillfilters': Object.freeze({
		'search': '',  // TODO translate
		'reset': 'リセット',
		'addAllVisible': '表示中をすべて追加',
		'white': '白スキル',
		'gold': '金スキル',
		'pink': '進化スキル',
		'unique': '固有スキル',
		'inherit': '継承した固有スキル',
		'nige': '逃げ',
		'senkou': '先行',
		'sasi': '差し',
		'oikomi': '追込',
		'passive': '常時（緑）',
		'stamina': '回復（青）',
		'movement': '加速（黄）',
		'debuffer': 'デバフ（赤）',
		'debuffed': 'デバフ付与（紫）',
		'short': '短距離',
		'mile': 'マイル',
		'medium': '中距離',
		'long': '長距離',
		'turf': '芝',
		'dirt': 'ダート',
		'phase0': '序盤',
		'phase1': '中盤',
		'phase2': '終盤',
		'phase3': 'ラストスパート',
		'finalcorner': '最終コーナー',
		'finalstraight': '最終直線'
	}),
	'skilleffecttypes': Object.freeze({
		'1': 'スピードステータスアップ',
		'2': 'スタミナステータスアップ',
		'3': 'パワーステータスアップ',
		'4': '根性ステータスアップ',
		'5': '賢さステータスアップ',
		'6': '作戦変更',
		'8': '視野拡大',
		'9': 'スタミナ回復',
		'10': 'スタート反応改善',
		'13': '掛かり時間延長',
		'14': 'スタート遅延追加',
		'21': '現在速度（減速なし）',
		'22': '現在速度',
		'27': '目標速度',
		'28': 'レーン移動速度',
		'29': '掛かり確率低下',
		'31': '加速',
		'32': '全ステータスアップ',
		'35': 'レーン移動',
		'37': 'ランダム金スキル発動',
		'41': '全シンパシー発動',
		'42': 'スキル効果時間延長'
	}),
	'skilldetails': Object.freeze({
		'accel': '{{n}}m/s²',
		'basinn': '{{n}}バ身',
		'changestrategy': Object.freeze({
			'runaway': '大逃げ'
		}),
		'effectvalue': Object.freeze({
			'true': '有効',
			'trackpercent': 'コース幅の{{n}}%'
		}),
		'target': '対象',
		'skilltarget': Object.freeze({
			'1': '自分',
			'2': 'シンパシー全体',
			'4': '視野内の全体',
			'7': '{{position}}位より前の全体',
			'7fallback': '順位より前の全体',
			'9': '前方の全体',
			'10': '後方の全体',
			'11': '味方全体',
			'18': '全{{strategy}}',
			'18fallback': '敵全体（作戦）',
			'19': '前方の掛かりウマ',
			'20': '後方の掛かりウマ',
			'21': '掛かり{{strategy}}',
			'21fallback': '掛かり（作戦）',
			'22': 'ウマID',
			'23': '回復スキル発動済み',
			'strategy': Object.freeze({
				'nige': '逃げ',
				'senko': '先行',
				'sashi': '差し',
				'oikomi': '追込'
			})
		}),
		'conditions': '発動条件',
		'distance_type': Object.freeze(['', '短距離', 'マイル', '中距離', '長距離']),
		'baseduration': '基準持続時間',
		'effectiveduration': '効果時間（{{distance}}m）',
		'durationincrease': '{{n}}倍',
		'effects': '効果',
		'grade': Object.freeze({100: 'G1', 200: 'G2', 300: 'G3', 400: 'OP', 700: 'Pre-OP', 800: 'Maiden', 900: 'デビュー', 999: '毎日'}),
		'ground_condition': Object.freeze(['', '良', '稍重', '重', '不良']),
		'ground_type': Object.freeze(['', '芝', 'ダート']),
		'id': 'ID: ',
		'meters': '{{n}}m',
		'motivation': Object.freeze(['', '絶不調', '不調', '普通', '好調', '絶好調']),
		'order_rate': 'チャンミ：{{cm}}、TT/リグヒ：{{loh}}',
		'preconditions': '前提条件',
		'duration': '持続時間',
		'rating': '評価',
		'basecost': '基礎コスト',
		'scorecontribution': 'スコア寄与',
		'rotation': Object.freeze(['', '右回り', '左回り']),
		'running_style': Object.freeze(['', '逃げ', '先行', '差し', '追込']),
		'season': Object.freeze(['', '早春', '夏', '秋', '冬', '春']),
		'seconds': '{{n}}s',
		'slope': Object.freeze(['平地', '上り坂', '下り坂']),
		'speed': '{{n}}m/s',
		'time': Object.freeze(['', '朝', '昼', '夕方', '夜']),
		'weather': Object.freeze(['', '晴れ', '曇り', '雨', '雪'])
	})
});

export const STRINGS_en = Object.freeze({
	'skillfilters': Object.freeze({
		'search': 'Search by name, ID, or condition',
		'reset': 'Reset Filters',
		'addAllVisible': 'Add All Shown Skills',
		'white': 'White Skills',
		'gold': 'Gold Skills',
		'inherit': 'Inherited Uniques',
		'nige': 'Front Runner',
		'senkou': 'Pace Chaser',
		'sasi': 'Late Surger',
		'oikomi': 'End Closer',
		'passive': 'Passive (Green)',
		'stamina': 'Stamina (Blue)',
		'movement': 'Movement (Yellow)',
		'debuffer': 'Debuffer (Red)',
		'debuffed': 'Debuffed (Purple)',
		'short': 'Short',
		'mile': 'Mile',
		'medium': 'Medium',
		'long': 'Long',
		'turf': 'Turf',
		'dirt': 'Dirt',
		'phase0': 'Opening Leg',
		'phase1': 'Middle Leg',
		'phase2': 'Final Leg',
		'phase3': 'Last Spurt',
		'finalcorner': 'Final Corner',
		'finalstraight': 'Final Straight'
	}),
	'skilleffecttypes': Object.freeze({
		'1': 'Speed Stat Up',
		'2': 'Stamina Stat Up',
		'3': 'Power Stat Up',
		'4': 'Guts Stat Up',
		'5': 'Wit Stat Up',
		'6': 'Change Strategy',
		'8': 'Increase Field Of View',
		'9': 'Stamina Recovery',
		'10': 'Improve Start Reaction Time',
		'13': 'Increase Rushed Duration',
		'14': 'Add Start Delay',
		'21': 'Current Speed',
		'22': 'Current Speed With Natural Deceleration',
		'27': 'Target Speed',
		'28': 'Lane Movement Speed',
		'29': 'Decreased Rush Probability',
		'31': 'Acceleration',
		'32': 'All Stats Up',
		'35': 'Change Lane',
		'37': 'Activate Random Gold Skill',
		'41': 'Activate All Other Sympathy',
		'42': 'Increase Skill Duration'
	}),
	'skilldetails': Object.freeze({
		'accel': '{{n}}m/s²',
		'basinn': '{{n}} bashin',
		'changestrategy': Object.freeze({
			'runaway': 'Runaway'
		}),
		'effectvalue': Object.freeze({
			'true': 'True',
			'trackpercent': '{{n}}% of Track'
		}),
		'target': 'Target',
		'skilltarget': Object.freeze({
			'1': 'Self',
			'2': 'All with Sympathy',
			'4': 'All in Field of View',
			'7': 'Ahead of {{position}} Position',
			'7fallback': 'Ahead of Position',
			'9': 'All Ahead',
			'10': 'All Behind',
			'11': 'All Teammates',
			'18': 'All {{strategy}}',
			'18fallback': 'All Enemies (Strategy)',
			'19': 'Rushed Opponents Ahead',
			'20': 'Rushed Opponents Behind',
			'21': 'Rushed {{strategy}}',
			'21fallback': 'Rushed (Strategy)',
			'22': 'Uma ID',
			'23': 'Activated Any Recovery Skill',
			'strategy': Object.freeze({
				'nige': 'Front Runners',
				'senko': 'Pace Chasers',
				'sashi': 'Late Surgers',
				'oikomi': 'End Closers'
			})
		}),
		'conditions': 'Conditions',
		'distance_type': Object.freeze(['', 'Short', 'Mile', 'Medium', 'Long']),
		'baseduration': 'Base duration',
		'effectiveduration': 'Effective duration ({{distance}}m)',
		'durationincrease': '{{n}}×',
		'effects': 'Effects',
		'grade': Object.freeze({100: 'G1', 200: 'G2', 300: 'G3', 400: 'OP', 700: 'Pre-OP', 800: 'Maiden', 900: 'Debut', 999: 'Daily races'}),
		'ground_condition': Object.freeze(['', 'Good', 'Yielding', 'Soft', 'Heavy']),
		'ground_type': Object.freeze(['', 'Turf', 'Dirt']),
		'id': 'ID: ',
		'meters': '{{n}}m',
		'motivation': Object.freeze(['', 'Terrible', 'Bad', 'Normal', 'Good', 'Perfect']),
		'order_rate': 'CM: {{cm}}, TT/LOH: {{loh}}',
		'preconditions': 'Preconditions',
		'duration': 'Duration',
		'rating': 'Rating',
		'basecost': 'Base Cost',
		'scorecontribution': 'Score Contribution',
		'rotation': Object.freeze(['', 'Clockwise', 'Counterclockwise']),
		'running_style': Object.freeze(['', 'Runner', 'Leader', 'Betweener', 'Chaser']),
		'season': Object.freeze(['', 'Early spring', 'Summer', 'Autumn', 'Winter', 'Late spring']),
		'seconds': '{{n}}s',
		'slope': Object.freeze(['Flat', 'Uphill', 'Downhill']),
		'speed': '{{n}}m/s',
		'time': Object.freeze(['', 'Morning', 'Mid day', 'Evening', 'Night']),
		'weather': Object.freeze(['', 'Sunny', 'Cloudy', 'Rainy', 'Snowy'])
	})
});

function C(s: string) {
	return Parser.parseAny(Parser.tokenize(s));
}

const filterOps = Object.freeze({
	'nige': [C('running_style==1')],
	'senkou': [C('running_style==2')],
	'sasi': [C('running_style==3')],
	'oikomi': [C('running_style==4')],
	'short': [C('distance_type==1')],
	'mile': [C('distance_type==2')],
	'medium': [C('distance_type==3')],
	'long': [C('distance_type==4')],
	'turf': [C('ground_type==1')],
	'dirt': [C('ground_type==2')],
	'phase0': [C('phase==0'), C('phase_random==0'), C('phase_firsthalf_random==0'), C('phase_laterhalf_random==0')],
	'phase1': [C('phase==1'), C('phase>=1'), C('phase_random==1'), C('phase_firsthalf_random==1'), C('phase_laterhalf_random==1')],
	'phase2': [C('phase==2'), C('phase>=2'), C('phase_random==2'), C('phase_firsthalf_random==2'), C('phase_laterhalf_random==2'), C('phase_firstquarter_random==2'), C('is_lastspurt==1')],
	'phase3': [C('phase==3'), C('phase_random==3'), C('phase_firsthalf_random==3'), C('phase_laterhalf_random==3')],
	'finalcorner': [C('is_finalcorner==1'), C('is_finalcorner_laterhalf==1'), C('is_finalcorner_random==1')],
	'finalstraight': [C('is_last_straight==1'), C('is_last_straight_onetime==1')]
});

const parsedConditions = {};
Object.keys(skilldata).forEach(id => {
	parsedConditions[id] = skilldata[id].alternatives.map(ef => Parser.parse(Parser.tokenize(ef.condition)));
});

function matchRarity(id, testRarity) {
	const r = skilldata[id].rarity;
	switch (testRarity) {
	case 'white':
		return r == SkillRarity.White && id[0] != '9';
	case 'gold':
		return r == SkillRarity.Gold;
	case 'pink':
		return r == SkillRarity.Evolution;
	case 'unique':
		return r > SkillRarity.Gold && r < SkillRarity.Evolution;
	case 'inherit':
		return id[0] == '9';
	default:
		return true;
	}
}

const classnames = Object.freeze(['', 'skill-white', 'skill-gold', 'skill-unique', 'skill-unique', 'skill-unique', 'skill-pink']);

export function Skill(props) {
	return (
		<div class={`skill ${classnames[skilldata[props.id].rarity]} ${props.selected ? 'selected' : ''}`} data-skillid={props.id}>
			<img class="skillIcon" src={umaToolsAsset(`icons/${skillmeta[props.id].iconId}.png`)} /> 
			<span class="skillName"><Text id={`skillnames.${props.id}`} /></span>
			{props.trailing}
			{props.dismissable && <span class="skillDismiss">✕</span>}
		</div>
	);
}

interface ConditionFormatter {
	name: string
	formatArg(arg: number): any
}

function fmtSeconds(arg: number) {
	return <Text id="skilldetails.seconds" plural={arg} fields={{n: arg}} />;
}

function fmtPercent(arg: number) {
	return `${arg}%`;
}

function fmtMeters(arg: number) {
	return <Text id="skilldetails.meters" plural={arg} fields={{n: arg}} />;
}

function fmtString(strId: string) {
	return function (arg: number) {
		return <Tooltip title={arg.toString()} tall={useLanguage() == 'ja'}><Text id={`skilldetails.${strId}.${arg}`} /></Tooltip>;
	};
}

const conditionFormatters = new Proxy({
	accumulatetime: fmtSeconds,
	bashin_diff_behind(arg: number) {
		return <Localizer><Tooltip title={<Text id="skilldetails.meters" plural={arg * 2.5} fields={{n: arg * 2.5}} />}><Text id="skilldetails.basinn" plural={arg} fields={{n: arg}} /></Tooltip></Localizer>;
	},
	bashin_diff_infront(arg: number) {
		return <Localizer><Tooltip title={<Text id="skilldetails.meters" plural={arg * 2.5} fields={{n: arg * 2.5}} />}><Text id="skilldetails.basinn" plural={arg} fields={{n: arg}} /></Tooltip></Localizer>;
	},
	behind_near_lane_time: fmtSeconds,
	behind_near_lane_time_set1: fmtSeconds,
	blocked_all_continuetime: fmtSeconds,
	blocked_front_continuetime: fmtSeconds,
	blocked_side_continuetime: fmtSeconds,
	course_distance: fmtMeters,
	distance_diff_rate: fmtPercent,
	distance_diff_top(arg: number) {
		return <Localizer><Tooltip title={<Text id="skilldetails.basinn" plural={arg / 2.5} fields={{n: arg / 2.5}} />}><Text id="skilldetails.meters" plural={arg} fields={{n: arg}} /></Tooltip></Localizer>;
	},
	distance_diff_top_float(arg: number) {
		return <Localizer><Tooltip title={<Text id="skilldetails.basinn" plural={arg / 25} fields={{n: arg / 25}} />}><Text id="skilldetails.meters" plural={arg} fields={{n: (arg / 10).toFixed(1)}} /></Tooltip></Localizer>;
	},
	distance_rate: fmtPercent,
	distance_rate_after_random: fmtPercent,
	distance_type: fmtString('distance_type'),
	grade: fmtString('grade'),
	ground_condition: fmtString('ground_condition'),
	ground_type: fmtString('ground_type'),
	hp_per: fmtPercent,
	infront_near_lane_time: fmtSeconds,
	motivation: fmtString('motivation'),
	order_rate(arg: number) {
		return <Localizer><Tooltip title={<Text id="skilldetails.order_rate" fields={{cm: Math.round(arg / 100 * 9), loh: Math.round(arg / 100 * 12)}} />}>{arg}</Tooltip></Localizer>;
	},
	overtake_target_no_order_up_time: fmtSeconds,
	overtake_target_time: fmtSeconds,
	random_lot: fmtPercent,
	remain_distance: fmtMeters,
	rotation: fmtString('rotation'),
	running_style: fmtString('running_style'),
	season: fmtString('season'),
	slope: fmtString('slope'),
	time: fmtString('time'),
	track_id(arg: number) {
		return <Tooltip title={arg} tall={useLanguage() == 'ja'}><Text id={`tracknames.${arg}`} /></Tooltip>;
	},
	weather: fmtString('weather')
}, {
	get(o: object, prop: string) {
		if (o.hasOwnProperty(prop)) {
			return {name: prop, formatArg: o[prop]};
		}
		return {
			name: prop,
			formatArg(arg: number) {
				return arg.toString();
			}
		}; 
	}
});

interface OpFormatter {
	format(): any
}

export type RaceConditionContextValue = {
	distance?: number
	distanceType?: number
	surface?: number
	turn?: number
	trackId?: number
	weather?: number
	season?: number
	time?: number
	groundCondition?: number
	grade?: number
	runningStyle?: number
	hasCorners?: boolean
	hasUphill?: boolean
	hasDownhill?: boolean
};

const RaceConditionContext = createContext<RaceConditionContextValue | null>(null);

function cmpNumber(actual: number, op: string, arg: number) {
	switch (op) {
	case '==': return actual === arg;
	case '!=': return actual !== arg;
	case '<': return actual < arg;
	case '<=': return actual <= arg;
	case '>': return actual > arg;
	case '>=': return actual >= arg;
	default: return true;
	}
}

function rangePossible(min: number, max: number, op: string, arg: number) {
	switch (op) {
	case '==': return arg >= min && arg <= max;
	case '!=': return min !== max || min !== arg;
	case '<': return min < arg;
	case '<=': return min <= arg;
	case '>': return max > arg;
	case '>=': return max >= arg;
	default: return true;
	}
}

function isConditionInvalid(name: string, op: string, arg: number, race: RaceConditionContextValue | null) {
	if (race == null) return false;
	const scalar = (value: number | undefined) => value == null ? false : !cmpNumber(value, op, arg);
	switch (name) {
	case 'distance_type': return scalar(race.distanceType);
	case 'ground_type': return scalar(race.surface);
	case 'weather': return scalar(race.weather);
	case 'season': return scalar(race.season);
	case 'time': return scalar(race.time);
	case 'ground_condition': return scalar(race.groundCondition);
	case 'grade': return scalar(race.grade);
	case 'track_id': return scalar(race.trackId);
	case 'rotation': return scalar(race.turn);
	case 'running_style': return scalar(race.runningStyle);
	case 'course_distance': return scalar(race.distance);
	case 'is_basis_distance':
		return race.distance == null ? false : !cmpNumber(race.distance % 400 == 0 ? 1 : 0, op, arg);
	case 'remain_distance':
		return race.distance == null ? false : !rangePossible(0, race.distance, op, arg);
	case 'is_finalcorner':
		return race.hasCorners === false && ((op == '==' && arg == 1) || (op == '!=' && arg == 0));
	case 'slope':
		if (op != '==') return false;
		if (arg == 1) return race.hasUphill === false;
		if (arg == 2) return race.hasDownhill === false;
		return false;
	default:
		return false;
	}
}

class AndFormatter {
	constructor(readonly left: OpFormatter, readonly right: OpFormatter) {}
	
	format() {
		return (
			<Fragment>
				{this.left.format()}
				<div class="skillConditionLine">
					<span class="operatorAnd">&amp;</span>
					{this.right.format()}
				</div>
			</Fragment>
		);
	}
}

class OrFormatter {
	constructor(readonly left: OpFormatter, readonly right: OpFormatter) {}
	
	format() {
		return (
			<Fragment>
				{this.left.format()}
				<div class="skillConditionLine skillConditionLine--or">
					<span class="operatorOr">@<span class="operatorOrText">or</span></span>
				</div>
				{this.right.format()}
			</Fragment>
		);
	}
}

function ConditionView(props: {name: string, op: string, arg: number, formatArg: (arg: number) => any}) {
	const race = useContext(RaceConditionContext);
	const invalid = isConditionInvalid(props.name, props.op, props.arg, race);
	return (
		<span class={`condition${invalid ? ' condition--invalid' : ''}`}>
			<span class="conditionName">{props.name}</span><span class="conditionOp">{props.op}</span><span class="conditionArg">{props.formatArg(props.arg)}</span>
		</span>
	);
}

function CmpFormatter(op: string) {
	return class {
		constructor(readonly cond: ConditionFormatter, readonly arg: number) {}
		
		format() {
			return (
				<ConditionView name={this.cond.name} op={op} arg={this.arg} formatArg={this.cond.formatArg} />
			);
		}
	};
}

const FormatParser = getParser<ConditionFormatter,OpFormatter>(conditionFormatters, {
	and: AndFormatter,
	or: OrFormatter,
	eq: CmpFormatter('=='),
	neq: CmpFormatter('!='),
	lt: CmpFormatter('<'),
	lte: CmpFormatter('<='),
	gt: CmpFormatter('>'),
	gte: CmpFormatter('>=')
});

function forceSign(n: number) {
	return n <= 0 ? n.toString() : '+' + n;
}

function effectValueClass(n: number) {
	if (n > 0) return 'skillEffectValue--positive';
	if (n < 0) return 'skillEffectValue--negative';
	return '';
}

function effectValueClassForType(effectType: number, value: number) {
	switch (effectType) {
	case 6:
	case 13:
	case 32:
	case 35:
	case 41:
		return 'skillEffectValue--positive';
	case 10:
		if (value < 1) return 'skillEffectValue--positive';
		if (value > 1) return 'skillEffectValue--negative';
		return '';
	case 14:
		return 'skillEffectValue--negative';
	case 8:
		return value >= 0 ? 'skillEffectValue--positive' : 'skillEffectValue--negative';
	case 29:
		return value < 0 ? 'skillEffectValue--positive' : 'skillEffectValue--negative';
	default:
		return effectValueClass(value);
	}
}

function formatPercentSigned(n: number) {
	return `${forceSign(n * 100)}%`;
}

function formatRawScaledNumber(n: number) {
	return forceSign(+formatSigFigs(n));
}

function formatStartReactionMultiplier(n: number) {
	const pct = Math.round((n - 1) * 100);
	const pctStr = pct > 0 ? `+${pct}%` : `${pct}%`;
	return `${pctStr} (${formatSigFigs(n)})`;
}

function formatSecondsSigned(n: number) {
	return `${forceSign(+formatSigFigs(n))}s`;
}

function formatStrategyChangeValue(_value: number) {
	return <Text id="skilldetails.changestrategy.runaway">Runaway</Text>;
}

function formatLaneChangeValue(n: number) {
	return <Text id="skilldetails.effectvalue.trackpercent" fields={{n: Math.round(n * 100)}} />;
}

function formatBooleanTrue() {
	return <Text id="skilldetails.effectvalue.true">True</Text>;
}

function shouldShowEffectTarget(target: number | undefined, effects: Array<{target?: number}>, skillId: string) {
	if (target == null) return false;
	if (target !== 1) return true;
	const uniqueTargets = new Set(effects.map(ef => ef.target ?? 1));
	if (uniqueTargets.size <= 1) return false;
	return !isDebuffSkill(skillId);
}

function ordinalSuffix(n: number) {
	const v = n % 100;
	if (v >= 11 && v <= 13) return 'th';
	switch (n % 10) {
	case 1: return 'st';
	case 2: return 'nd';
	case 3: return 'rd';
	default: return 'th';
	}
}

function formatOrdinalPosition(n: number) {
	return `${n}${ordinalSuffix(n)}`;
}

const TARGET_7_POSITION_BY_SKILL_ID: Record<string, number> = {
	'100851': 4, // Reign Supreme
	'900851': 4
};

function parseOrderPositionFromCondition(condition: string): number | null {
	const eq = condition.match(/(?:^|[&])order==(\d+)/);
	if (eq) return parseInt(eq[1], 10);
	const le = condition.match(/(?:^|[&])order<=(\d+)/);
	if (le) return parseInt(le[1], 10);
	const ge = condition.match(/(?:^|[&])order>=(\d+)/);
	if (ge) return parseInt(ge[1], 10);
	return null;
}

function parseEnemyStrategyKeyFromCondition(condition: string): 'nige' | 'senko' | 'sashi' | 'oikomi' | null {
	if (/nige/.test(condition)) return 'nige';
	if (/senko/.test(condition)) return 'senko';
	if (/sashi/.test(condition)) return 'sashi';
	if (/oikomi/.test(condition)) return 'oikomi';
	return null;
}

function formatStrategyEffectTarget(target: 18 | 21, condition: string, precondition: string | undefined, strings: typeof STRINGS_en) {
	const strategyKey = parseEnemyStrategyKeyFromCondition(condition)
		?? (precondition ? parseEnemyStrategyKeyFromCondition(precondition) : null);
	if (strategyKey) {
		const strategy = strings.skilldetails.skilltarget.strategy[strategyKey];
		return <Text id={`skilldetails.skilltarget.${target}`} fields={{strategy}} />;
	}
	return <Text id={`skilldetails.skilltarget.${target}fallback`} />;
}

function formatEffectTarget(target: number, condition: string, lang: string, skillId?: string, precondition?: string) {
	const strings = lang === 'ja' ? STRINGS_ja : STRINGS_en;
	if (target === 7) {
		const position = parseOrderPositionFromCondition(condition)
			?? (precondition ? parseOrderPositionFromCondition(precondition) : null)
			?? (skillId ? TARGET_7_POSITION_BY_SKILL_ID[skillId] : null);
		if (position != null) {
			return <Text id="skilldetails.skilltarget.7" fields={{position: formatOrdinalPosition(position)}} />;
		}
		return <Text id="skilldetails.skilltarget.7fallback" />;
	}
	if (target === 18 || target === 21) {
		return formatStrategyEffectTarget(target, condition, precondition, strings);
	}
	return <Text id={`skilldetails.skilltarget.${target}`}>{target}</Text>;
}

const formatStat = forceSign;

function formatSpeed(n: number) {
	return <Text id="skilldetails.speed" plural={n} fields={{n: forceSign(n)}} />;
}

function formatSigFigs(n: number, digits: number = 3) {
	if (n === 0) return '0';
	return Number(n.toPrecision(digits)).toString();
}

function uniqueLevelMultiplier(effectType: number, uniqueLevel: number) {
	const level = Math.min(6, Math.max(1, uniqueLevel));
	const TARGET_SPEED_MULT = [0, 1.0, 1.01, 1.04, 1.07, 1.10, 1.13];
	const ACCEL_MULT = [0, 1.0, 1.02, 1.04, 1.06, 1.08, 1.10];
	const STAT_MULT = [0, 1.0, 1.01, 1.02, 1.03, 1.04, 1.05];
	const OTHER_MULT = [0, 1.0, 1.02, 1.04, 1.06, 1.08, 1.10];

	switch (effectType) {
	case 27:
		return TARGET_SPEED_MULT[level];
	case 31:
		return ACCEL_MULT[level];
	case 1:
	case 2:
	case 3:
	case 4:
	case 5:
		return STAT_MULT[level];
	default:
		return OTHER_MULT[level];
	}
}

function formatEffectiveEffectValue(effectType: number, value: number) {
	const n = formatSigFigs(value);
	switch (effectType) {
	case 21:
	case 22:
	case 27:
		return `${forceSign(+n)}m/s`;
	case 31:
		return `${forceSign(+n)}m/s²`;
	case 9:
		return `${formatSigFigs(value * 100)}%`;
	case 42:
		return `${n}×`;
	case 6:
		return 'Runaway';
	case 8:
		return formatRawScaledNumber(value);
	case 10:
		return formatStartReactionMultiplier(value);
	case 29:
	case 32:
		return formatPercentSigned(value);
	case 13:
	case 14:
		return formatSecondsSigned(value);
	case 35:
		return `${Math.round(value * 100)}% of Track`;
	case 41:
		return 'True';
	case 1:
	case 2:
	case 3:
	case 4:
	case 5:
		return forceSign(+n);
	default:
		return forceSign(+n);
	}
}

const formatEffect = Object.freeze({
	1: formatStat,
	2: formatStat,
	3: formatStat,
	4: formatStat,
	5: formatStat,
	6: formatStrategyChangeValue,
	8: formatRawScaledNumber,
	9: n => `${(n * 100).toFixed(1)}%`,
	10: formatStartReactionMultiplier,
	13: formatSecondsSigned,
	14: formatSecondsSigned,
	21: formatSpeed,
	22: formatSpeed,
	27: formatSpeed,
	29: formatPercentSigned,
	31: n => <Text id="skilldetails.accel" plural={n} fields={{n: forceSign(n)}} />,
	32: formatPercentSigned,
	35: formatLaneChangeValue,
	41: formatBooleanTrue,
	42: n => <Text id="skilldetails.durationincrease" plural={n} fields={{n}} />
});

export function ExpandedSkillDetails(props) {
	const skill = skilldata[props.id];
	const lang = useLanguage();
	const isUnique = skill.rarity >= 3 && skill.rarity <= 5;
	const uniqueLevel = props.uniqueLevel || 0;
	const starLevel = props.starLevel || 3;
	const [scoreContribution, setScoreContribution] = useState<number | null>(null);
	
	const meta = skillmeta[props.id];
	const baseCost = meta?.baseCost;
	
	// Calculate total base cost (including lower version for gold/upgraded skills)
	const totalBaseCost = useMemo(() => {
		if (baseCost === undefined) return undefined;
		if (isUnique) return undefined; // Unique skills don't show base cost
		
		// For gold skills (rarity 4) or upgraded skills, find lower version
		if (skill.rarity === 4) {
			const groupId = meta?.groupId;
			if (groupId) {
				// Find the lower version skill in the same group (rarity < 4, typically rarity 2)
				for (const skillId in skillmeta) {
					const otherMeta = (skillmeta as any)[skillId];
					const otherSkill = (skilldata as any)[skillId];
					if (otherMeta && otherMeta.groupId === groupId && otherSkill && otherSkill.rarity < 3) {
						const lowerBaseCost = otherMeta.baseCost || 0;
						return (baseCost || 0) + lowerBaseCost;
					}
				}
			}
		}
		
		return baseCost;
	}, [baseCost, isUnique, skill.rarity, meta?.groupId, props.id]);
	
	useEffect(() => {
		getSkillRatingContributionWithAptitude(props.id, props.aptitudes as Aptitude[] | undefined).then(score => {
			setScoreContribution(score);
		}).catch(err => {
			console.warn('Failed to get skill rating contribution:', err);
			setScoreContribution(0);
		});
	}, [props.id, props.aptitudes]);

	const displayedScoreContribution = useMemo(() => {
		if (isUnique) {
			return calcUniqueBonus(starLevel, uniqueLevel);
		}
		return scoreContribution;
	}, [isUnique, starLevel, uniqueLevel, scoreContribution]);

	function renderRatingDetails() {
		return (
			<Fragment>
				<div class="skillDetailsLabel"><Text id="skilldetails.rating" /></div>
				<div class="skillEffects">
					{!isUnique && totalBaseCost !== undefined && (
						<div class="skillEffect">
							<span class="skillEffectType"><Text id="skilldetails.basecost" /></span>
							<span class="skillEffectValue">{totalBaseCost}</span>
						</div>
					)}
					<div class="skillEffect">
						<span class="skillEffectType"><Text id="skilldetails.scorecontribution" /></span>
						<span class="skillEffectValue">{displayedScoreContribution !== null ? displayedScoreContribution.toLocaleString() : '...'}</span>
					</div>
				</div>
			</Fragment>
		);
	}
	
	return (
		<IntlProvider definition={lang == 'ja' ? STRINGS_ja : STRINGS_en}>
			<RaceConditionContext.Provider value={props.raceContext || null}>
			<div class={`expandedSkill ${classnames[skill.rarity]}`} data-skillid={props.id}>
				<div class="expandedSkillHeader">
					<div class="expandedSkillTitleRow">
						<img class="skillIcon" src={umaToolsAsset(`icons/${skillmeta[props.id].iconId}.png`)} />
						<span class="skillName"><Text id={`skillnames.${props.id}`} /></span>
					</div>
					{props.dismissable && <span class="skillDismiss">✕</span>}
				</div>
				<div class="skillDetails">
					<div class="skillMetaLine skillMetaLine--id">
						<Text id="skilldetails.id" />
						{props.id}
					</div>
					{skill.alternatives.map((alt, altIndex) =>
						<div class="skillDetailsSection" key={altIndex}>
							{alt.precondition.length > 0 && <Fragment>
								<div class="skillDetailsLabel"><Text id="skilldetails.preconditions" /></div>
								<div class="skillConditions">
									{FormatParser.parse(FormatParser.tokenize(alt.precondition)).format()}
								</div>
							</Fragment>}
							<div class="skillDetailsLabel"><Text id="skilldetails.conditions" /></div>
							<div class="skillConditions">
								{FormatParser.parse(FormatParser.tokenize(alt.condition)).format()}
							</div>
							<div class="skillDetailsLabel"><Text id="skilldetails.effects" /></div>
							<div class="skillEffects">
								{alt.effects.map((ef, efIndex) => {
									const rawValue = ef.modifier / 10000;
									const showEffective = isUnique && uniqueLevel > 0;
									const effectiveValue = showEffective ? rawValue * uniqueLevelMultiplier(ef.type, uniqueLevel) : rawValue;
									return (
										<Fragment key={`${altIndex}-${efIndex}-${ef.type}`}>
											<div class="skillEffect">
												<span class="skillEffectType"><Text id={`skilleffecttypes.${ef.type}`}>{ef.type}</Text></span>
												<span class={`skillEffectValue ${effectValueClassForType(ef.type, rawValue)}`}>{ef.type in formatEffect ? formatEffect[ef.type](rawValue) : rawValue}</span>
											</div>
											{shouldShowEffectTarget(ef.target, alt.effects, props.id) && (
												<div class="skillEffect skillEffect--effective">
													<span class="skillEffectType"><Text id="skilldetails.target" /></span>
													<span class="skillEffectValue">{formatEffectTarget(ef.target, alt.condition, lang, props.id, alt.precondition)}</span>
												</div>
											)}
											{showEffective && (
												<div class="skillEffect skillEffect--effective">
													<span class="skillEffectType">Eff. <Text id={`skilleffecttypes.${ef.type}`}>{ef.type}</Text> (Lv{uniqueLevel})</span>
													<span class={`skillEffectValue ${effectValueClassForType(ef.type, effectiveValue)}`}>{formatEffectiveEffectValue(ef.type, effectiveValue)}</span>
												</div>
											)}
										</Fragment>
									);
								})}
							</div>
							{(alt.baseDuration > 0 || (props.distanceFactor && alt.baseDuration > 0)) && (
								<Fragment>
									<div class="skillDetailsLabel"><Text id="skilldetails.duration" /></div>
									<div class="skillEffects">
										{alt.baseDuration > 0 && (
											<div class="skillEffect">
												<span class="skillEffectType"><Text id="skilldetails.baseduration" /></span>
												<span class="skillEffectValue"><Text id="skilldetails.seconds" fields={{n: alt.baseDuration / 10000}} /></span>
											</div>
										)}
										{props.distanceFactor && alt.baseDuration > 0 && (
											<div class="skillEffect skillEffect--effective">
												<span class="skillEffectType"><Text id="skilldetails.effectiveduration" fields={{distance: props.distanceFactor}} /></span>
												<span class="skillEffectValue"><Text id="skilldetails.seconds" fields={{n: +(alt.baseDuration / 10000 * (props.distanceFactor / 1000)).toFixed(2)}} /></span>
											</div>
										)}
									</div>
								</Fragment>
							)}
							{skill.alternatives.length === 1 && renderRatingDetails()}
						</div>
					)}
					{skill.alternatives.length > 1 && (
						<div class="skillDetailsSection skillDetailsSection--rating">
							{renderRatingDetails()}
						</div>
					)}
					{(props.uniqueLevel !== undefined && props.onUniqueLevelChange || props.onPositionChange) && (
						<div class="skillDetailsSection skillDetailsSection--controls">
							{props.uniqueLevel !== undefined && props.onUniqueLevelChange && (
								<div class="skillControlRow">
									<label class="forcedPositionLabel">Unique Level</label>
									<select
										class="forcedPositionInput"
										value={props.uniqueLevel || 0}
										onChange={(e) => props.onUniqueLevelChange(parseInt((e.target as HTMLSelectElement).value, 10))}
										onClick={(e) => e.stopPropagation()}
									>
										<option value={0}>0 (None)</option>
										{[1, 2, 3, 4, 5, 6].map(lvl => <option key={lvl} value={lvl}>{lvl}</option>)}
									</select>
								</div>
							)}
							{props.onPositionChange && (
								<div class="skillControlRow">
									<label class="forcedPositionLabel">Force @ Location (m)</label>
									<input
										type="number"
										class="forcedPositionInput"
										placeholder="Optional"
										value={props.forcedPosition}
										onInput={(e) => props.onPositionChange((e.target as HTMLInputElement).value)}
										onClick={(e) => e.stopPropagation()}
										min="0"
										step="10"
									/>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
			</RaceConditionContext.Provider>
		</IntlProvider>
	);
}

// they really just gave up with the ids for scenario pinks
const iconIdPrefixes = Object.freeze({
	'1001': ['1001'],
	'1002': ['1002', '2018'],
	'1003': ['1003'],
	'1004': ['1004'],
	'1005': ['1005'],
	'1006': ['1006'],
	'2002': ['2002', '2011', '2028'],
	'2001': ['2001', '2010', '2014', '2015', '2016', '2019', '2021', '2022', '2024', '2026', '2029', '2031', '2032', '2033'],
	'2004': ['2004', '2012', '2017', '2020', '2025', '2027', '2030'],
	'2005': ['2005', '2013'],
	'2006': ['2006'],
	'2009': ['2009'],
	'3001': ['3001'],
	'3002': ['3002'],
	'3004': ['3004'],
	'3005': ['3005'],
	'3007': ['3007'],
	'4001': ['4001'],
	'10014': ['10014'],
	'10024': ['10024'],
	'10034': ['10034'],
	'10044': ['10044'],
	'10054': ['10054'],
	'20014': ['20014'],
	'20024': ['20024'],
	'20034': ['20034'],
	'20044': ['20044'],
	'20064': ['20064'],
	'20094': ['20094']
});

const purpleIconFilters = new Set(['10014', '10024', '10034', '10044', '10054', '20014', '20024', '20034', '20044', '20064', '20094']);

function matchIconTypeFilter(iconId: string, filterKey: string) {
	const id = String(iconId);
	const isPurpleIcon = id.length >= 5 && id[id.length - 1] === '4';
	if (purpleIconFilters.has(filterKey)) {
		return iconIdPrefixes[filterKey].some(p => id.startsWith(p));
	}
	if (isPurpleIcon) return false;
	return iconIdPrefixes[filterKey].some(p => id.startsWith(p));
}

/** Skill icon color categories aligned with Team Umalysis skill_icons folders. */
function getSkillIconColor(iconId: string): 'passive' | 'stamina' | 'movement' | 'debuffer' | 'debuffed' | null {
	const id = String(iconId);
	if (!id || id === '0') return null;
	const last = id[id.length - 1];

	// Purple folder: negative/debuffed icons ending in 4.
	if (last === '4') return 'debuffed';

	// Green folder: passive stat icons (100xx) and a few specials.
	if (id.startsWith('100') || id.startsWith('1010')) return 'passive';
	if (id === '20181' || id.startsWith('4001')) return 'passive';

	// Blue folder: stamina recovery icons.
	if ((id.startsWith('2002') || id.startsWith('2003')) && (last === '1' || last === '2')) return 'stamina';
	if (id.startsWith('2011') && (last === '1' || last === '2')) return 'stamina';

	// Red folder: debuff icons applied to opponents (300xx).
	if (id.startsWith('300')) return 'debuffer';

	// Yellow folder: movement/speed icons (200xx / 201xx scenario variants).
	if (id.startsWith('200') || id.startsWith('201') || id.startsWith('202') || id.startsWith('203')) return 'movement';

	return null;
}

function matchSkillColor(id: string, color: string) {
	return getSkillIconColor(String(skillmeta[id]?.iconId ?? '')) === color;
}

function iconFilterImage(type: string) {
	const pngFallbacks = Object.freeze({
		'20034': '20034.webp',
		'20094': '20094.webp'
	});
	const file = pngFallbacks[type] ?? (type.length >= 5 ? `${type}.png` : `${type}1.png`);
	return umaToolsAsset(`icons/${file}`);
}

const groups_filters = Object.freeze({
	'color': ['passive', 'stamina', 'movement', 'debuffer', 'debuffed'],
	'rarity': ['white', 'gold', 'inherit'],
	'icontype': ['1001', '1002', '1003', '1004', '1005', '1006', '4001', '2002', '2001', '2004', '2005', '2006', '2009', '3001', '3002', '3004', '3005', '3007', '10014', '10024', '10034', '10044', '10054', '20014', '20024', '20034', '20044', '20064', '20094'],
	'strategy': ['nige', 'senkou', 'sasi', 'oikomi'],
	'distance': ['short', 'mile', 'medium', 'long'],
	'surface': ['turf', 'dirt'],
	'location': ['phase0', 'phase1', 'phase2', 'phase3', 'finalcorner', 'finalstraight']
});

function parseConditionSearchOp(searchText: string) {
	try {
		const op = C(searchText);
		// Bare integers (e.g. "564") are not valid condition queries and treeMatch throws on them.
		if (op.type == NodeType.Int) return null;
		return op;
	} catch (_) {
		return null;
	}
}

function skillIdMatches(id: string, searchText: string) {
	const query = searchText.trim();
	if (!query || !/^\d+$/.test(query)) return false;
	return id === query || id.includes(query);
}

function textSearch(id: string, searchText: string, searchConditions: boolean, conditionOp: ReturnType<typeof parseConditionSearchOp>) {
	const needle = searchText.toUpperCase();
	if ((skillnames[id] || []).some(s => s.toUpperCase().indexOf(needle) > -1)) {
		return 1;
	}
	if (skillIdMatches(id, searchText)) {
		return 1;
	}
	if (searchConditions && conditionOp) {
		try {
			return parsedConditions[id].some(alt => Matcher.treeMatch(conditionOp, alt)) ? 2 : 0;
		} catch (_) {
			return 0;
		}
	}
	return 0;
}

export const SKILL_ICON_TYPE_FILTERS = groups_filters.icontype;
export const SKILL_RARITY_FILTERS = groups_filters.rarity;
export const SKILL_RARITY_FILTER_LABELS = Object.freeze({
	white: 'Regular Skills',
	gold: 'Gold Skills',
	inherit: 'Inherited Uniques'
});

export type SkillIconTypeFilterState = {[key: string]: boolean};
export type SkillRarityFilterState = {[key: string]: boolean};

export function createInitialIconTypeFilterState(options?: {
	deselectPurple?: boolean;
	deselectIcons?: readonly string[];
}): SkillIconTypeFilterState {
	const deselected = new Set(options?.deselectIcons || []);
	if (options?.deselectPurple) {
		purpleIconFilters.forEach(filter => deselected.add(filter));
	}
	const state: SkillIconTypeFilterState = {};
	SKILL_ICON_TYPE_FILTERS.forEach(filter => {
		state[filter] = !deselected.has(filter);
	});
	return state;
}

export function createInitialRarityFilterState(): SkillRarityFilterState {
	const state: SkillRarityFilterState = {};
	SKILL_RARITY_FILTERS.forEach(filter => {
		state[filter] = true;
	});
	return state;
}

function filterStatesEqual(a: {[key: string]: boolean}, b: {[key: string]: boolean}, keys: readonly string[]) {
	return keys.every(f => !!a[f] === !!b[f]);
}

function toggleMultiFilterState(
	filterActive: {[key: string]: boolean},
	keys: readonly string[],
	filter: string,
	options?: {
		soloWhenAllOn?: boolean;
		soloWhenMatches?: {[key: string]: boolean};
		emptyFallback?: {[key: string]: boolean};
	}
) {
	const next = { ...filterActive };
	const soloWhenAllOn = options?.soloWhenAllOn !== false;
	const isFullSelection = (soloWhenAllOn && keys.every(f => filterActive[f]))
		|| (options?.soloWhenMatches != null && filterStatesEqual(filterActive, options.soloWhenMatches, keys));
	if (isFullSelection) {
		keys.forEach(f => {
			next[f] = f == filter;
		});
		return next;
	}
	next[filter] = !filterActive[filter];
	if (!keys.some(f => next[f])) {
		if (options?.emptyFallback) {
			return { ...options.emptyFallback };
		}
		keys.forEach(f => {
			next[f] = true;
		});
	}
	return next;
}

export function nextIconTypeFilterState(
	filterActive: SkillIconTypeFilterState,
	filter: string,
	options?: {
		soloWhenAllOn?: boolean;
		soloWhenMatches?: SkillIconTypeFilterState;
		emptyFallback?: SkillIconTypeFilterState;
	}
): SkillIconTypeFilterState {
	return toggleMultiFilterState(filterActive, SKILL_ICON_TYPE_FILTERS, filter, options);
}

export function nextRarityFilterState(
	filterActive: SkillRarityFilterState,
	filter: string,
	options?: {
		soloWhenAllOn?: boolean;
		soloWhenMatches?: SkillRarityFilterState;
		emptyFallback?: SkillRarityFilterState;
	}
): SkillRarityFilterState {
	return toggleMultiFilterState(filterActive, SKILL_RARITY_FILTERS, filter, options);
}

/** True when the skill matches the selected icon types. All selected = no filter. */
export function skillPassesIconTypeFilters(id: string, filterActive: SkillIconTypeFilterState) {
	const selected = SKILL_ICON_TYPE_FILTERS.filter(f => filterActive[f]);
	if (selected.length == 0 || selected.length == SKILL_ICON_TYPE_FILTERS.length) {
		return true;
	}
	const iconId = String(skillmeta[id]?.iconId ?? '');
	return selected.some(f => matchIconTypeFilter(iconId, f));
}

/** True when the skill matches the selected rarities. All selected = no filter. */
export function skillPassesRarityFilters(id: string, filterActive: SkillRarityFilterState) {
	const selected = SKILL_RARITY_FILTERS.filter(f => filterActive[f]);
	if (selected.length == 0 || selected.length == SKILL_RARITY_FILTERS.length) {
		return true;
	}
	return selected.some(f => matchRarity(id, f));
}

const SKILL_ICON_TYPE_PURPLE_START = SKILL_ICON_TYPE_FILTERS.findIndex(filter => purpleIconFilters.has(filter));

export function SkillIconTypeFilter(props: {
	value: SkillIconTypeFilterState;
	onChange: (next: SkillIconTypeFilterState) => void;
	class?: string;
	soloWhenAllOn?: boolean;
	soloWhenMatches?: SkillIconTypeFilterState;
	emptyFallback?: SkillIconTypeFilterState;
	groupedWrap?: boolean;
}) {
	const previousBeforeSoloRef = useRef<SkillIconTypeFilterState | null>(null);
	const groupedWrap = props.groupedWrap !== false;
	const purpleStart = SKILL_ICON_TYPE_PURPLE_START < 0 ? SKILL_ICON_TYPE_FILTERS.length : SKILL_ICON_TYPE_PURPLE_START;
	const primaryFilters = groupedWrap ? SKILL_ICON_TYPE_FILTERS.slice(0, purpleStart) : SKILL_ICON_TYPE_FILTERS;
	const purpleFilters = groupedWrap ? SKILL_ICON_TYPE_FILTERS.slice(purpleStart) : [];

	function renderFilterButton(type: string) {
		return (
			<button
				type="button"
				key={type}
				data-filter={type}
				class={`iconFilterButton ${props.value[type] ? 'active' : ''}`}
				style={`background-image:url(${iconFilterImage(type)})`}
				title={type}
				onClick={(e) => {
					e.stopPropagation();
					const selected = SKILL_ICON_TYPE_FILTERS.filter(f => props.value[f]);
					const isFullSelection = (props.soloWhenAllOn !== false && SKILL_ICON_TYPE_FILTERS.every(f => props.value[f]))
						|| (props.soloWhenMatches != null && filterStatesEqual(props.value, props.soloWhenMatches, SKILL_ICON_TYPE_FILTERS));

					if (selected.length === 1 && props.value[type] && previousBeforeSoloRef.current) {
						props.onChange({ ...previousBeforeSoloRef.current });
						previousBeforeSoloRef.current = null;
						return;
					}

					if (isFullSelection) {
						previousBeforeSoloRef.current = { ...props.value };
					} else if (selected.length === 1) {
						previousBeforeSoloRef.current = null;
					}

					props.onChange(nextIconTypeFilterState(props.value, type, {
						soloWhenAllOn: props.soloWhenAllOn,
						soloWhenMatches: props.soloWhenMatches,
						emptyFallback: props.emptyFallback
					}));
				}}
			/>
		);
	}

	if (!groupedWrap) {
		return (
			<div class={`skillIconTypeFilter${props.class ? ` ${props.class}` : ''}`}>
				{primaryFilters.map(renderFilterButton)}
			</div>
		);
	}

	return (
		<div class={`skillIconTypeFilterWrap${props.class ? ` ${props.class}` : ''}`}>
			<div class="skillIconTypeFilter skillIconTypeFilterGroup skillIconTypeFilterGroup--primary">
				{primaryFilters.map(renderFilterButton)}
			</div>
			{purpleFilters.length > 0 && (
				<div class="skillIconTypeFilter skillIconTypeFilterGroup skillIconTypeFilterGroup--purple">
					{purpleFilters.map(renderFilterButton)}
				</div>
			)}
		</div>
	);
}

export function SkillRarityFilter(props: {
	value: SkillRarityFilterState;
	onChange: (next: SkillRarityFilterState) => void;
	class?: string;
	filters?: readonly string[];
	soloWhenAllOn?: boolean;
	soloWhenMatches?: SkillRarityFilterState;
	emptyFallback?: SkillRarityFilterState;
}) {
	const filters = props.filters || SKILL_RARITY_FILTERS;
	return (
		<div class={`skillRarityFilter filterGroup${props.class ? ` ${props.class}` : ''}`} data-filter-group="rarity">
			{filters.map(filter => (
				<button
					type="button"
					key={filter}
					data-filter={filter}
					class={`filterButton app-pill ${props.value[filter] ? 'active' : ''}`}
					onClick={(e) => {
						e.stopPropagation();
						props.onChange(nextRarityFilterState(props.value, filter, {
							soloWhenAllOn: props.soloWhenAllOn,
							soloWhenMatches: props.soloWhenMatches,
							emptyFallback: props.emptyFallback
						}));
					}}
				>
					{SKILL_RARITY_FILTER_LABELS[filter]}
				</button>
			))}
		</div>
	);
}

function createInitialFilterState() {
	const state = {};
	Object.keys(groups_filters).forEach(group => {
		state[group] = {};
		groups_filters[group].forEach(filter => {
			state[group][filter] = group == 'icontype';
		});
	});
	return state;
}

function skillPassesFilters(id: string, filterActive) {
	return Object.keys(groups_filters).every(group => {
		let check = groups_filters[group].filter(f => filterActive[group][f]);
		// All icon types selected = no icon filter (matches initial unfiltered view).
		if (group == 'icontype' && check.length == groups_filters.icontype.length) {
			check = [];
		}
		if (check.length == 0) return true;
		if (group == 'rarity') return check.some(f => matchRarity(id, f));
		if (group == 'color') return check.some(f => matchSkillColor(id, f));
		if (group == 'icontype') {
			return skillPassesIconTypeFilters(id, filterActive.icontype);
		}
		return check.some(f => filterOps[f].some(op => parsedConditions[id].some(alt => Matcher.treeMatch(op, alt))));
	});
}

function computeVisibleIds(ids: readonly string[], searchText: string, filterActive) {
	const filtered = new Set<string>();
	const conditionOp = searchText.length > 0 ? parseConditionSearchOp(searchText) : null;
	let allowConditionSearch = true;
	ids.forEach(id => {
		const passesTextSearch = searchText.length > 0 ? textSearch(id, searchText, allowConditionSearch, conditionOp) : 3;
		if (allowConditionSearch && passesTextSearch == 1) {
			allowConditionSearch = false;
		}
		if (passesTextSearch && skillPassesFilters(id, filterActive)) {
			filtered.add(id);
		}
	});
	return filtered;
}

function nextFilterState(filterActive, group: string, filter: string) {
	const next = { ...filterActive, [group]: { ...filterActive[group] } };
	if (group == 'icontype') {
		next.icontype = nextIconTypeFilterState(filterActive.icontype, filter);
		return next;
	}
	const turnOn = !filterActive[group][filter];
	Object.keys(next[group]).forEach(k => {
		next[group][k] = k == filter ? turnOn : false;
	});
	return next;
}

export function SkillList(props) {
	const lang = useLanguage();
	const strings = lang == 'ja' ? STRINGS_ja : STRINGS_en;
	const allowRelatedSkillCoexistence = props.allowRelatedSkillCoexistence === true;
	const [filterActive, setFilterActive] = useState(createInitialFilterState);
	const searchInput = useRef<HTMLInputElement>(null);
	const [searchText, setSearchText] = useState('');

	const visible = useMemo(
		() => computeVisibleIds(props.ids, searchText, filterActive),
		[props.ids, searchText, filterActive]
	);

	useEffect(function () {
		if (props.isOpen && searchInput.current) {
			searchInput.current.focus();
			searchInput.current.select();
		}
	}, [props.isOpen]);

	function toggleSelected(e) {
		const se = e.target.closest('div.skill');
		if (se == null) return;
		e.stopPropagation();
		let id = se.dataset.skillid;
		const groupId = skillmeta[id].groupId;
		// fake the group ids for debuff skills to allow adding multiple of them. this is because skills are unique per
		// groupId (the keys of the map) and not by skill id, so it's fine to add the same value to multiple keys. groupIds
		// aren't used as keys into anything else (like skill data) so it doesn't really matter what they are, only that
		// they're the same for skills that should be mutually exclusive (which we want for white/gold/pink sets, but not for
		// debuffs)
		let newSelected;
		if (allowRelatedSkillCoexistence) {
			newSelected = props.selected.set(id, id);
		} else if (isDebuffSkill(id)) {
			const ndebuffs = props.selected.count(isDebuffSkill);
			newSelected = props.selected.set(groupId + '-' + ndebuffs, id);
		} else {
			newSelected = props.selected.set(groupId, id);
		}
		props.setSelected(newSelected);
	}

	function handleSearchInput(e) {
		e.stopPropagation();
		setSearchText(e.currentTarget.value);
	}

	function handleFilterClick(group: string, filter: string) {
		setFilterActive(prev => nextFilterState(prev, group, filter));
	}

	function handleResetFilters(e) {
		e.stopPropagation();
		setFilterActive(createInitialFilterState());
		setSearchText('');
	}

	function handleAddAllVisible(e) {
		e.stopPropagation();
		if (visible.size === 0) return;
		let newSelected = props.selected;
		let ndebuffs = props.selected.count(isDebuffSkill);
		visible.forEach(id => {
			if (allowRelatedSkillCoexistence) {
				newSelected = newSelected.set(id, id);
			} else if (isDebuffSkill(id)) {
				newSelected = newSelected.set(skillmeta[id].groupId + '-' + ndebuffs, id);
				ndebuffs++;
			} else {
				newSelected = newSelected.set(skillmeta[id].groupId, id);
			}
		});
		props.setSelected(newSelected);
	}

	function FilterGroup(props) {
		return (
			<div class="filterGroup" data-filter-group={props.group}>
				{toChildArray(props.children).map(child => cloneElement(child, { group: props.group, onFilterClick: handleFilterClick }))}
			</div>
		);
	}

	function FilterButton(props) {
		return (
			<button
				type="button"
				data-filter={props.filter}
				class={`filterButton app-pill ${filterActive[props.group][props.filter] ? 'active' : ''}`}
				onClick={(e) => { e.stopPropagation(); props.onFilterClick(props.group, props.filter); }}
			>
				<Text id={`skillfilters.${props.filter}`} />
			</button>
		);
	}
	
	function IconFilterButton(props) {
		return (
			<button
				type="button"
				data-filter={props.type}
				class={`iconFilterButton ${filterActive[props.group][props.type] ? 'active' : ''}`}
				style={`background-image:url(${iconFilterImage(props.type)})`}
				title={props.type}
				onClick={(e) => { e.stopPropagation(); props.onFilterClick(props.group, props.type); }}
			/>
		);
	}

	const items = useMemo(() => {
		return props.ids
			.filter(id => visible.has(id))
			.map(id => (
				<li key={id}>
					<Skill id={id} selected={allowRelatedSkillCoexistence ? props.selected.has(id) : props.selected.get(skillmeta[id].groupId) == id} />
				</li>
			));
	}, [props.ids, props.selected, visible, allowRelatedSkillCoexistence]);
	
	return (
		<IntlProvider definition={strings}>
			<div class="filterGroups" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
				<div class="filterSearchRow" data-filter-group="search">
					<input
						type="search"
						class="filterSearch"
						value={searchText}
						placeholder={strings.skillfilters.search}
						onInput={handleSearchInput}
						ref={searchInput}
					/>
					{props.showAddAllVisible && (
						<button
							type="button"
							class="filterAddAllVisibleButton app-pill"
							disabled={visible.size === 0}
							onClick={handleAddAllVisible}
						>
							{strings.skillfilters.addAllVisible}
						</button>
					)}
					<button
						type="button"
						class="filterResetButton app-pill"
						onClick={handleResetFilters}
					>
						{strings.skillfilters.reset}
					</button>
				</div>
				<div class="filterIconSection">
					<FilterGroup group="icontype">
						{groups_filters['icontype'].map(t => <IconFilterButton key={t} type={t} />)}
					</FilterGroup>
				</div>
				<div class="filterPillSection">
					<div class="filterPillRow">
						<FilterGroup group="color">
							<FilterButton filter="passive" />
							<FilterButton filter="stamina" />
							<FilterButton filter="movement" />
							<FilterButton filter="debuffer" />
							<FilterButton filter="debuffed" />
						</FilterGroup>
					</div>
					<div class="filterPillRow">
						<FilterGroup group="rarity">
							<FilterButton filter="white" />
							<FilterButton filter="gold" />
							<FilterButton filter="inherit" />
						</FilterGroup>
						<span class="filterGroupDivider" aria-hidden="true" />
						<FilterGroup group="strategy">
							<FilterButton filter="nige" />
							<FilterButton filter="senkou" />
							<FilterButton filter="sasi" />
							<FilterButton filter="oikomi" />
						</FilterGroup>
					</div>
					<div class="filterPillRow">
						<FilterGroup group="distance">
							<FilterButton filter="short" />
							<FilterButton filter="mile" />
							<FilterButton filter="medium" />
							<FilterButton filter="long" />
						</FilterGroup>
						<span class="filterGroupDivider" aria-hidden="true" />
						<FilterGroup group="surface">
							<FilterButton filter="turf" />
							<FilterButton filter="dirt" />
						</FilterGroup>
						<span class="filterGroupDivider" aria-hidden="true" />
						<FilterGroup group="location">
							<FilterButton filter="phase0" />
							<FilterButton filter="phase1" />
							<FilterButton filter="phase2" />
							<FilterButton filter="phase3" />
							<FilterButton filter="finalcorner" />
							<FilterButton filter="finalstraight" />
						</FilterGroup>
					</div>
				</div>
			</div>
			<ul class="skillList" onClick={toggleSelected}>{items}</ul>
		</IntlProvider>
	);
}

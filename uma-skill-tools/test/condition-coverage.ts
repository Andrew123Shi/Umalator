import test from 'tape';

import { Conditions } from '../ActivationConditions';
import jpSkills from '../data/skill_data.json';
import globalSkills from '../../umalator-global/skill_data.json';

function unresolvedConditions(skillData: Record<string, any>) {
	const unresolved = new Set<string>();
	const comparison = /([a-z][a-z0-9_]*)\s*(?:==|!=|<=|>=|<|>)/g;

	Object.values(skillData).forEach((skill: any) => {
		skill.alternatives.forEach((alternative: any) => {
			[alternative.condition, alternative.precondition].forEach(expression => {
				if (!expression) return;
				for (const match of expression.matchAll(comparison)) {
					if (!(match[1] in Conditions)) {
						unresolved.add(match[1]);
					}
				}
			});
		});
	});

	return [...unresolved].sort();
}

test('all JP skill conditions are registered', t => {
	t.deepEqual(unresolvedConditions(jpSkills), []);
	t.end();
});

test('all Global skill conditions are registered', t => {
	t.deepEqual(unresolvedConditions(globalSkills), []);
	t.end();
});

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = path.join(root, 'components', '__fixtures__', 'profile-import-global.fixture.json');
const sourcePath = path.join(root, 'components', 'ProfileScreenshotImportV3.ts');
const tmpOut = path.join(os.tmpdir(), `profile-import-test-${Date.now()}.mjs`);

async function loadModule() {
	await esbuild.build({
		entryPoints: [sourcePath],
		format: 'esm',
		bundle: true,
		platform: 'browser',
		target: ['es2020'],
		outfile: tmpOut,
		logLevel: 'silent'
	});
	return import(pathToFileURL(tmpOut).href);
}

async function run() {
	const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
	const module = await loadModule();
	const { parseStatsFromText, parseStatsFromPositionedTokens, getSkillCandidates, outfitIdForUniqueSkill } = module;

	const stats = parseStatsFromText(fixture.statText);
	assert.equal(stats.speed, 1200, 'speed should parse from stat line');
	assert.equal(stats.stamina, 777, 'stamina should parse from stat line');
	assert.equal(stats.power, 1200, 'power should parse from stat line');
	assert.equal(stats.guts, 500, 'guts should parse from stat line');
	assert.equal(stats.wisdom, 817, 'wit/wisdom should parse from stat line');

	const statsWithMissingSpeed = parseStatsFromPositionedTokens([
		{ text: '500', x0: 260, x1: 300 },
		{ text: '600', x0: 460, x1: 500 },
		{ text: '700', x0: 660, x1: 700 },
		{ text: '900', x0: 860, x1: 900 }
	], { left: 0, width: 1000 });
	assert.equal(statsWithMissingSpeed.speed, undefined, 'missing speed must not be replaced by stamina');
	assert.equal(statsWithMissingSpeed.stamina, 500, 'stamina should remain in its horizontal slot');
	assert.equal(statsWithMissingSpeed.power, 600, 'power should remain in its horizontal slot');
	assert.equal(statsWithMissingSpeed.guts, 700, 'guts should remain in its horizontal slot');
	assert.equal(statsWithMissingSpeed.wisdom, 900, 'wisdom should remain in its horizontal slot');

	for (const skillCase of fixture.skills) {
		const top = getSkillCandidates(skillCase.raw, 1)[0];
		assert.ok(top != null, `expected at least one skill candidate for "${skillCase.raw}"`);
		assert.equal(top.skillId, skillCase.expectedSkillId, `skill "${skillCase.raw}" should resolve to canonical ID`);
	}

	assert.ok(outfitIdForUniqueSkill('110061') != null, 'unique skill should map to a valid outfit');
	console.log('Profile screenshot import parser tests passed.');
}

run()
	.catch(error => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		try {
			await fs.unlink(tmpOut);
		} catch {}
	});

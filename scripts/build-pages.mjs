import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const umalatorGlobalDir = path.join(root, 'umalator-global');
const distPagesDir = path.join(root, 'dist-pages');

const requiredCopies = [
	{
		from: path.join(root, 'icons'),
		to: path.join(distPagesDir, 'uma-tools', 'icons'),
		label: 'icons'
	},
	{
		from: path.join(root, 'fonts'),
		to: path.join(distPagesDir, 'uma-tools', 'fonts'),
		label: 'fonts'
	}
];

const requiredOutputs = [
	path.join(distPagesDir, 'index.html'),
	path.join(distPagesDir, 'bundle.js'),
	path.join(distPagesDir, 'bundle.css'),
	path.join(distPagesDir, 'simulator.worker.js'),
	path.join(distPagesDir, 'uma-tools', 'icons'),
	path.join(distPagesDir, 'uma-tools', 'fonts')
];

function runGlobalBuild() {
	const result = spawnSync(process.execPath, ['build.mjs'], {
		cwd: umalatorGlobalDir,
		stdio: 'inherit',
		env: process.env
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

async function assertPathExists(p, label) {
	try {
		await fs.access(p);
	} catch {
		throw new Error(`Missing required source for ${label}: ${path.relative(root, p)}`);
	}
}

async function copyPath(from, to) {
	await fs.mkdir(path.dirname(to), { recursive: true });
	await fs.cp(from, to, { recursive: true });
}

async function buildPages() {
	console.log('[build:pages] Building umalator-global bundle...');
	runGlobalBuild();

	console.log('[build:pages] Preparing dist-pages output...');
	await fs.rm(distPagesDir, { recursive: true, force: true });
	await fs.mkdir(distPagesDir, { recursive: true });
	await fs.cp(umalatorGlobalDir, distPagesDir, { recursive: true });

	for (const copy of requiredCopies) {
		await assertPathExists(copy.from, copy.label);
		await copyPath(copy.from, copy.to);
	}

	for (const outputPath of requiredOutputs) {
		await assertPathExists(outputPath, 'build output');
	}

	console.log('[build:pages] Completed successfully.');
	console.log('[build:pages] Cloudflare build command: npm run build:pages');
	console.log('[build:pages] Cloudflare output directory: dist-pages');
}

buildPages().catch(error => {
	console.error('[build:pages] Failed:', error.message);
	process.exit(1);
});

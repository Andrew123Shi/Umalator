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
	},
	{
		from: path.join(root, 'icon.ico'),
		to: path.join(distPagesDir, 'icon.ico'),
		label: 'favicon'
	},
	{
		from: path.join(root, 'components', 'ExampleProfile.png'),
		to: path.join(distPagesDir, 'uma-tools', 'components', 'ExampleProfile.png'),
		label: 'example profile screenshot'
	}
];

const appRoutes = JSON.parse(await fs.readFile(path.join(umalatorGlobalDir, 'routes.json'), 'utf8'));

const requiredOutputs = [
	path.join(distPagesDir, 'index.html'),
	path.join(distPagesDir, 'bundle.js'),
	path.join(distPagesDir, 'bundle.css'),
	path.join(distPagesDir, 'simulator.worker.js'),
	path.join(distPagesDir, 'icon.ico'),
	path.join(distPagesDir, 'uma-tools', 'icons'),
	path.join(distPagesDir, 'uma-tools', 'fonts'),
	path.join(distPagesDir, 'uma-tools', 'components', 'ExampleProfile.png')
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

	// Static hosts need a real file at each app URL. Hosts may serve these as route/ with a trailing slash,
	// so relative asset URLs need a <base> pointing back at the app root.
	const indexHtml = await fs.readFile(path.join(distPagesDir, 'index.html'), 'utf8');
	const routeHtml = indexHtml.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n\t\t<base href="../">');
	if (routeHtml === indexHtml) {
		throw new Error('Could not insert <base> into index.html route copies (missing <meta charset="utf-8">)');
	}
	for (const route of appRoutes) {
		const routeDir = path.join(distPagesDir, route);
		await fs.mkdir(routeDir, { recursive: true });
		await fs.writeFile(path.join(routeDir, 'index.html'), routeHtml);
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

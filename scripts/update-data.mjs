import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'umalator-global');

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: dataDir,
    encoding: 'utf8',
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

function writeFileAtomic(filepath, contents) {
  const tmpPath = `${filepath}.tmp`;
  fs.writeFileSync(tmpPath, contents, 'utf8');
  fs.renameSync(tmpPath, filepath);
}

function resolveMasterMdb() {
  if (process.argv[2]) {
    return process.argv[2];
  }
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) {
    throw new Error('USERPROFILE is not set. Pass a master.mdb path as an argument.');
  }
  return path.join(userProfile, 'AppData', 'LocalLow', 'Cygames', 'Umamusume', 'master', 'master.mdb');
}

function resolvePerlExecutable() {
  const probe = spawnSync('perl', ['-v'], { encoding: 'utf8', shell: false });
  if (!probe.error && probe.status === 0) {
    return 'perl';
  }

  const strawberryPerl = 'C:\\Strawberry\\perl\\bin\\perl.exe';
  if (fs.existsSync(strawberryPerl)) {
    return strawberryPerl;
  }

  throw new Error(
    'Perl not found. Install Strawberry Perl or add perl to PATH (expected at C:\\Strawberry\\perl\\bin\\perl.exe).'
  );
}

function main() {
  const masterMdb = resolveMasterMdb();
  if (!fs.existsSync(masterMdb)) {
    throw new Error(`master.mdb not found at: ${masterMdb}`);
  }
  const perl = resolvePerlExecutable();

  const skillData = run(perl, ['../uma-skill-tools/tools/make_skill_data.pl', masterMdb]).stdout;
  const skillNames = run(perl, ['make_global_skillnames.pl', masterMdb]).stdout;
  const skillMeta = run(perl, ['make_global_skill_meta.pl', masterMdb]).stdout;

  writeFileAtomic(path.join(dataDir, 'skill_data.json'), skillData);
  writeFileAtomic(path.join(dataDir, 'skillnames.json'), skillNames);
  writeFileAtomic(path.join(dataDir, 'skill_meta.json'), skillMeta);

  run(perl, ['make_global_uma_info.pl', masterMdb], { stdio: 'inherit' });
}

try {
  main();
  console.log('Game data updated successfully.');
} catch (error) {
  console.error(`Data update failed: ${error.message}`);
  process.exit(1);
}

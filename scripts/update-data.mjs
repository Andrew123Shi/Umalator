import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(rootDir, 'umalator-global');

const DATA_FILES = ['skill_data.json', 'skillnames.json', 'skill_meta.json', 'umas.json'];

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

function readJsonIfExists(filepath) {
  if (!fs.existsSync(filepath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function snapshotData() {
  const snap = {};
  for (const name of DATA_FILES) {
    snap[name] = readJsonIfExists(path.join(dataDir, name));
  }
  return snap;
}

function skillLabel(id, names) {
  const entry = names?.[id];
  const name = Array.isArray(entry) ? entry.find(Boolean) : entry;
  return name ? `${id} (${name})` : String(id);
}

function umaLabel(id, umas) {
  const entry = umas?.[id];
  const name = Array.isArray(entry?.name) ? entry.name.find(Boolean) : entry?.name;
  return name ? `${id} (${name})` : String(id);
}

function outfitLabel(oid, outfits) {
  const epithet = outfits?.[oid]?.epithet;
  return epithet ? `${oid} (${epithet})` : String(oid);
}

function diffKeyedObjects(before, after) {
  const beforeObj = before || {};
  const afterObj = after || {};
  const beforeIds = new Set(Object.keys(beforeObj));
  const afterIds = new Set(Object.keys(afterObj));

  const added = [...afterIds].filter((id) => !beforeIds.has(id)).sort();
  const removed = [...beforeIds].filter((id) => !afterIds.has(id)).sort();
  const changed = [...afterIds]
    .filter((id) => beforeIds.has(id) && JSON.stringify(beforeObj[id]) !== JSON.stringify(afterObj[id]))
    .sort();

  return { added, removed, changed };
}

function printList(title, items, limit = 25) {
  if (items.length === 0) {
    return;
  }
  console.log(`  ${title} (${items.length}):`);
  const shown = items.slice(0, limit);
  for (const item of shown) {
    console.log(`    - ${item}`);
  }
  if (items.length > limit) {
    console.log(`    ... and ${items.length - limit} more`);
  }
}

function summarizeSkillChanges(before, after) {
  const names = after['skillnames.json'] || before['skillnames.json'] || {};
  const dataDiff = diffKeyedObjects(before['skill_data.json'], after['skill_data.json']);
  const nameDiff = diffKeyedObjects(before['skillnames.json'], after['skillnames.json']);
  const metaDiff = diffKeyedObjects(before['skill_meta.json'], after['skill_meta.json']);

  const changedIds = new Set([...dataDiff.changed, ...nameDiff.changed, ...metaDiff.changed]);
  // If something was added/removed in data, don't also list it under changed via meta/names.
  for (const id of [...dataDiff.added, ...dataDiff.removed]) {
    changedIds.delete(id);
  }

  const details = [];
  for (const id of [...changedIds].sort()) {
    const notes = [];
    if (dataDiff.changed.includes(id)) {
      const oldCond = before['skill_data.json']?.[id]?.alternatives?.[0]?.condition;
      const newCond = after['skill_data.json']?.[id]?.alternatives?.[0]?.condition;
      if (oldCond !== newCond) {
        notes.push(`condition: ${oldCond || '(none)'} -> ${newCond || '(none)'}`);
      } else {
        notes.push('skill_data changed');
      }
    }
    if (nameDiff.changed.includes(id)) {
      notes.push('name changed');
    }
    if (metaDiff.changed.includes(id)) {
      notes.push('meta changed');
    }
    details.push(`${skillLabel(id, names)}: ${notes.join('; ')}`);
  }

  return {
    added: dataDiff.added.map((id) => skillLabel(id, names)),
    removed: dataDiff.removed.map((id) => skillLabel(id, before['skillnames.json'] || names)),
    changed: details
  };
}

function summarizeUmaChanges(beforeUmas, afterUmas) {
  const before = beforeUmas || {};
  const after = afterUmas || {};
  const beforeIds = new Set(Object.keys(before));
  const afterIds = new Set(Object.keys(after));

  const added = [...afterIds].filter((id) => !beforeIds.has(id)).sort().map((id) => umaLabel(id, after));
  const removed = [...beforeIds].filter((id) => !afterIds.has(id)).sort().map((id) => umaLabel(id, before));

  const outfitAdded = [];
  const outfitRemoved = [];
  const outfitChanged = [];
  const umaChanged = [];

  for (const id of [...afterIds].filter((x) => beforeIds.has(x)).sort()) {
    const beforeEntry = before[id];
    const afterEntry = after[id];
    if (JSON.stringify(beforeEntry) === JSON.stringify(afterEntry)) {
      continue;
    }

    const beforeOutfits = beforeEntry.outfits || {};
    const afterOutfits = afterEntry.outfits || {};
    const outfitDiff = diffKeyedObjects(beforeOutfits, afterOutfits);

    for (const oid of outfitDiff.added) {
      outfitAdded.push(`${umaLabel(id, after)} / ${outfitLabel(oid, afterOutfits)}`);
    }
    for (const oid of outfitDiff.removed) {
      outfitRemoved.push(`${umaLabel(id, before)} / ${outfitLabel(oid, beforeOutfits)}`);
    }
    for (const oid of outfitDiff.changed) {
      outfitChanged.push(`${umaLabel(id, after)} / ${outfitLabel(oid, afterOutfits)}`);
    }

    const beforeWithoutOutfits = { ...beforeEntry, outfits: undefined };
    const afterWithoutOutfits = { ...afterEntry, outfits: undefined };
    if (
      JSON.stringify(beforeWithoutOutfits) !== JSON.stringify(afterWithoutOutfits) &&
      outfitDiff.added.length === 0 &&
      outfitDiff.removed.length === 0 &&
      outfitDiff.changed.length === 0
    ) {
      umaChanged.push(umaLabel(id, after));
    }
  }

  return { added, removed, outfitAdded, outfitRemoved, outfitChanged, umaChanged };
}

function printUpdateSummary(before, after) {
  console.log('');
  console.log('========== Update summary ==========');

  const fileStatus = DATA_FILES.map((name) => {
    const beforeJson = before[name] == null ? null : JSON.stringify(before[name]);
    const afterJson = after[name] == null ? null : JSON.stringify(after[name]);
    if (beforeJson === afterJson) {
      return `${name}: unchanged`;
    }
    if (beforeJson == null) {
      return `${name}: created`;
    }
    if (afterJson == null) {
      return `${name}: missing after update`;
    }
    return `${name}: updated`;
  });
  console.log('Files:');
  for (const line of fileStatus) {
    console.log(`  - ${line}`);
  }

  const skills = summarizeSkillChanges(before, after);
  console.log('Skills:');
  if (skills.added.length + skills.removed.length + skills.changed.length === 0) {
    console.log('  (no skill additions, removals, or changes)');
  } else {
    printList('Added', skills.added);
    printList('Removed', skills.removed);
    printList('Changed', skills.changed);
  }

  const umas = summarizeUmaChanges(before['umas.json'], after['umas.json']);
  console.log('Umas / outfits:');
  if (
    umas.added.length +
      umas.removed.length +
      umas.outfitAdded.length +
      umas.outfitRemoved.length +
      umas.outfitChanged.length +
      umas.umaChanged.length ===
    0
  ) {
    console.log('  (no uma/outfit additions, removals, or changes)');
  } else {
    printList('Umas added', umas.added);
    printList('Umas removed', umas.removed);
    printList('Outfits added', umas.outfitAdded);
    printList('Outfits removed', umas.outfitRemoved);
    printList('Outfits changed', umas.outfitChanged);
    printList('Uma metadata changed', umas.umaChanged);
  }

  console.log('====================================');
  console.log('');
}

function main() {
  const masterMdb = resolveMasterMdb();
  if (!fs.existsSync(masterMdb)) {
    throw new Error(`master.mdb not found at: ${masterMdb}`);
  }
  const perl = resolvePerlExecutable();

  console.log(`Updating game data from:\n  ${masterMdb}`);
  const before = snapshotData();

  const skillData = run(perl, ['../uma-skill-tools/tools/make_skill_data.pl', masterMdb]).stdout;
  const skillNames = run(perl, ['make_global_skillnames.pl', masterMdb]).stdout;
  const skillMeta = run(perl, ['make_global_skill_meta.pl', masterMdb]).stdout;

  writeFileAtomic(path.join(dataDir, 'skill_data.json'), skillData);
  writeFileAtomic(path.join(dataDir, 'skillnames.json'), skillNames);
  writeFileAtomic(path.join(dataDir, 'skill_meta.json'), skillMeta);

  run(perl, ['make_global_uma_info.pl', masterMdb], { stdio: 'inherit' });

  const after = snapshotData();
  printUpdateSummary(before, after);
  console.log('Game data updated successfully.');
}

try {
  main();
} catch (error) {
  console.error(`Data update failed: ${error.message}`);
  process.exit(1);
}

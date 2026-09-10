import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('config/household.json', 'utf8');
const targetPath = 'public/config/household.json';

mkdirSync('public/config', { recursive: true });

const check = process.argv.includes('--check');
if (check) {
  let existing;
  try {
    existing = readFileSync(targetPath, 'utf8');
  } catch {
    existing = null;
  }
  if (existing !== source) {
    console.error(`${targetPath} is out of date with config/household.json. Run "node scripts/sync-config.mjs" to fix.`);
    process.exit(1);
  }
  console.log('public/config/household.json matches config/household.json.');
  process.exit(0);
}

writeFileSync(targetPath, source);
console.log(`Synced config/household.json -> ${targetPath}`);

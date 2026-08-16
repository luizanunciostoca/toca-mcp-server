import fs from 'node:fs';

const path = 'src/content/runtime.ts';
const source = fs.readFileSync(path, 'utf8');
const before = `      readonly variantKey?: string;\n`;
const after = `      readonly variantKey: string;\n`;
const matches = source.split(before).length - 1;
if (matches !== 1) throw new Error(`R29_REPURPOSE_TYPE_ANCHOR_COUNT:${matches}`);
fs.writeFileSync(path, source.replace(before, after));
console.log('R29 repurpose destination contract aligned');

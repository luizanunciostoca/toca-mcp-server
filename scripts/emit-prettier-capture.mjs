import { readFileSync } from 'node:fs';

const files = [
  'control/creative-standards/templates/sunset-template-master.v1.json',
  'control/creative-standards/templates/sunset-template-master.v2.json',
  'control/creative-standards/templates/sunset-template-master.v4.json',
  'control/creative-standards/templates/sunset-template-master.v5.json',
  'control/creative-standards/templates/sunset-template-master.v6.json',
  'control/creative-standards/templates/sunset-template-master.v7.json',
  'control/creative-standards/templates/sunset-template-master.v8.json',
  'control/creative-standards/templates/sunset-template-master.v9.json',
  'docs/architecture/templates/sunset-template-master-v1.md',
  'docs/architecture/templates/sunset-template-master-v2.md',
  'src/creative/sunset-story-crop-planner.ts',
  'src/creative/sunset-story-image-profile.ts',
  'src/creative/sunset-story-template-selector.ts',
  'test/sunset-story-template-selector.test.ts',
];

for (const file of files) {
  const encoded = Buffer.from(readFileSync(file, 'utf8')).toString('base64');
  console.log(`PRETTIER_FILE_BEGIN:${file}`);
  console.log(encoded);
  console.log(`PRETTIER_FILE_END:${file}`);
}

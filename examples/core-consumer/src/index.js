import { normalizeFilePathCandidates } from '@barok/core';

const candidates = normalizeFilePathCandidates([
  'src/tasks/index.tsstyles.css',
  'src/tasks/index.ts',
]);

process.stdout.write(`${JSON.stringify(candidates, null, 2)}\n`);

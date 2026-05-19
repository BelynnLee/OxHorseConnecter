import assert from 'node:assert/strict';
import { patchStats } from '../apps/web/src/components/agent-workbench/workbench-v2/inspectorPanelUtils.ts';

assert.deepEqual(
  patchStats(['--- a/file.ts', '+++ b/file.ts', '-old', '+new', '+added'].join('\n')),
  { insertions: 2, deletions: 1 }
);

console.log('inspector panel utils tests passed');

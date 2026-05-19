import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;

  while (true) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))
    ) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Unable to locate workspace root from ${startDir}.`);
    }
    dir = parent;
  }
}

export const workspaceRoot = findWorkspaceRoot(currentDir);
export const envPath = path.join(workspaceRoot, '.env');

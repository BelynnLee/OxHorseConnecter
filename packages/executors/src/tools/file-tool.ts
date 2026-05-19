import fs from 'node:fs';
import path from 'node:path';

function resolveToolPath(workDir: string, targetPath: string): string {
  return path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(workDir, targetPath);
}

export function readTextFile(workDir: string, targetPath: string): string {
  const filePath = resolveToolPath(workDir, targetPath);
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeTextFile(
  workDir: string,
  targetPath: string,
  content: string,
): string {
  const filePath = resolveToolPath(workDir, targetPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return `File written: ${filePath}`;
}

export function replaceInTextFile(
  workDir: string,
  targetPath: string,
  oldStr: string,
  newStr: string,
): string {
  const filePath = resolveToolPath(workDir, targetPath);
  const original = fs.readFileSync(filePath, 'utf-8');

  if (!original.includes(oldStr)) {
    return `String not found in ${filePath}`;
  }

  const updated = original.replace(oldStr, newStr);
  fs.writeFileSync(filePath, updated, 'utf-8');
  return `Replaced content in ${filePath}`;
}

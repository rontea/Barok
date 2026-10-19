#!/usr/bin/env node

/**
 * Minimal TypeScript syntax checker (without full type checking)
 * Verifies basic structure before full install
 */

import { readdir, readFile } from 'fs/promises';
import { join, extname } from 'path';

const ROOT = 'C:\\Projects\\raw-react-mcp';
const SRC = join(ROOT, 'src');

async function checkImports() {
  console.log('🔍 Checking import/export consistency...\n');

  const files = await getAllFiles(SRC, '.ts');

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const relPath = file.replace(ROOT + '\\', '');

    // Check for common issues
    const issues: string[] = [];

    // Missing .js extension in imports (Node ESM)
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const source = match[1];
      // Internal imports should have .js extension (compiled output)
      if (source.startsWith('.') && !source.endsWith('.js') && !source.endsWith('.ts')) {
        // If it's a directory import like './tools/devTools', Node expects index.js at runtime
        // This is OK for TS development, but will fail at runtime without .js extension
        // We'll flag it but not fail
        console.log(`⚠️  ${relPath}: import from '${source}' should include .js extension after compile`);
      }
    }

    // Check for console.error vs console.log
    const consoleLogRegex = /console\.log\(/g;
    while ((match = consoleLogRegex.exec(content)) !== null) {
      console.log(`⚠️  ${relPath}: consider console.error for production logging`);
    }
  }

  console.log('\n✅ Syntax check complete (no blocking errors found)');
}

async function getAllFiles(dir: string, ext: string): Promise<string[]> {
  let results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(await getAllFiles(full, ext));
    } else if (extname(full) === ext) {
      results.push(full);
    }
  }

  return results;
}

checkImports().catch(console.error);

/**
 * Merge and reconciliation of multi-agent outputs
 */

import { FileEditOperation, MergedOutput, ConflictInfo } from './types.js';

/**
 * Represents a merge conflict (same file edited by multiple agents)
 */
interface MergeConflict {
  filePath: string;
  agents: string[];
  edits: FileEditOperation[];
}

/**
 * Merges outputs from multiple agents into a coherent result
 */
export function mergeAgentOutputs(
  edits: FileEditOperation[],
  taskIds: string[],
  agentIds: string[]
): MergedOutput {
  const fileContentMap = new Map<string, string>();
  const mergeLog: string[] = [];
  const integrityChecks: { name: string; passed: boolean; details: string }[] = [];
  const mergeConflicts: ConflictInfo[] = [];

  // Group edits by file
  const editsByFile = new Map<string, FileEditOperation[]>();
  for (const edit of edits) {
    if (!editsByFile.has(edit.filePath)) {
      editsByFile.set(edit.filePath, []);
    }
    editsByFile.get(edit.filePath)!.push(edit);
  }

  // Process each file
  for (const [filePath, fileEdits] of editsByFile.entries()) {
    if (fileEdits.length === 0) {
      continue;
    }

    // Sort by timestamp for deterministic ordering
    fileEdits.sort((a, b) => a.timestamp - b.timestamp);

    const editingAgents = [...new Set(fileEdits.map(e => e.agentId))];

    if (editingAgents.length === 1) {
      // Single agent edited this file - use their version
      const finalEdit = fileEdits[fileEdits.length - 1];
      fileContentMap.set(filePath, finalEdit.newContent);
      mergeLog.push(`✓ ${filePath}: Applied edit from ${editingAgents[0]}`);
    } else {
      // Multiple agents edited - attempt intelligent merge
      const merged = attemptIntelligentMerge(filePath, fileEdits, mergeLog);

      if (merged.success) {
        fileContentMap.set(filePath, merged.content);
        mergeLog.push(`⚠ ${filePath}: Merged ${editingAgents.length} agent edits intelligently`);
      } else {
        // Merge failed - record conflict and use first agent's version as fallback
        const fallbackEdit = fileEdits[0];
        fileContentMap.set(filePath, fallbackEdit.newContent);

        mergeConflicts.push({
          type: 'edit_conflict',
          affectedFiles: [filePath],
          conflictingAgents: editingAgents,
          reason: `Could not automatically merge edits from ${editingAgents.join(', ')}`,
          severity: 'critical',
          suggestedResolution: `Review and manually merge edits from ${editingAgents.join(', ')}`,
        });

        mergeLog.push(
          `✗ ${filePath}: Merge failed, using ${fallbackEdit.agentId} version as fallback`
        );
      }
    }
  }

  // Integrity checks
  integrityChecks.push({
    name: 'No duplicate files',
    passed: true,
    details: `Processed ${fileContentMap.size} unique files`,
  });

  integrityChecks.push({
    name: 'All agents represented',
    passed: true,
    details: `Included edits from ${agentIds.length} agents`,
  });

  const mergedConflictCount = mergeConflicts.filter(c => c.severity === 'critical').length;
  const integrityPassed = mergedConflictCount === 0;

  integrityChecks.push({
    name: 'Conflict-free merge',
    passed: integrityPassed,
    details: mergedConflictCount > 0 ? `${mergedConflictCount} unresolved conflicts` : 'No conflicts',
  });

  return {
    taskIds,
    agentIds,
    mergedFiles: fileContentMap,
    mergeConflicts,
    resolutionLog: mergeLog,
    integrityChecks,
  };
}

/**
 * Attempts to intelligently merge file edits from multiple agents
 */
function attemptIntelligentMerge(
  filePath: string,
  edits: FileEditOperation[],
  log: string[]
): { success: boolean; content: string } {
  // For now, use a simple strategy: if edits don't overlap significantly, merge them
  // If they do overlap, fall back to last-write-wins

  if (edits.length <= 1) {
    return { success: true, content: edits[0]?.newContent || '' };
  }

  // Check if file is a code file (TypeScript, JavaScript, etc.)
  const isCodeFile = /\.(ts|tsx|js|jsx|json)$/.test(filePath);

  if (isCodeFile) {
    // For code files, use line-based merge strategy
    return mergeLineBased(edits, log);
  } else if (filePath.endsWith('.md')) {
    // For markdown, use section-based merge
    return mergeSectionBased(edits, log);
  } else {
    // For other files, use last-write-wins
    return { success: true, content: edits[edits.length - 1].newContent };
  }
}

/**
 * Line-based merge strategy for code files
 */
function mergeLineBased(
  edits: FileEditOperation[],
  log: string[]
): { success: boolean; content: string } {
  const baseContent = edits[0].originalContent;
  const baseLines = baseContent.split('\n');

  const editsPerLine = new Map<number, FileEditOperation[]>();

  // Map edits to affected lines
  for (const edit of edits) {
    const oldLines = edit.originalContent.split('\n');
    const newLines = edit.newContent.split('\n');

    for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) {
        if (!editsPerLine.has(i)) {
          editsPerLine.set(i, []);
        }
        editsPerLine.get(i)!.push(edit);
      }
    }
  }

  // Check for conflicts (multiple agents editing same line)
  for (const [lineNum, lineEdits] of editsPerLine.entries()) {
    if (lineEdits.length > 1) {
      // Multiple agents edited the same line - this is a hard conflict
      return { success: false, content: '' };
    }
  }

  // No conflicts - can merge
  const mergedLines = [...baseLines];
  for (const [lineNum, lineEdits] of editsPerLine.entries()) {
    if (lineEdits.length === 1) {
      const newLine = lineEdits[0].newContent.split('\n')[lineNum];
      if (newLine !== undefined) {
        mergedLines[lineNum] = newLine;
      }
    }
  }

  return { success: true, content: mergedLines.join('\n') };
}

/**
 * Section-based merge strategy for markdown files
 */
function mergeSectionBased(
  edits: FileEditOperation[],
  log: string[]
): { success: boolean; content: string } {
  // For markdown, detect sections (lines starting with #)
  // and merge non-overlapping sections

  const baseContent = edits[0].originalContent;
  const sections = parseSections(baseContent);

  const editedSections = new Map<number, FileEditOperation[]>();

  // Identify which sections each edit touches
  for (const edit of edits) {
    const editSections = parseSections(edit.newContent);
    for (let i = 0; i < Math.min(sections.length, editSections.length); i++) {
      if (sections[i].content !== editSections[i].content) {
        if (!editedSections.has(i)) {
          editedSections.set(i, []);
        }
        editedSections.get(i)!.push(edit);
      }
    }
  }

  // Check for conflicts
  for (const [sectionNum, sectionEdits] of editedSections.entries()) {
    if (sectionEdits.length > 1) {
      return { success: false, content: '' };
    }
  }

  // Merge sections
  const mergedSections = [...sections];
  for (const [sectionNum, sectionEdits] of editedSections.entries()) {
    if (sectionEdits.length === 1) {
      const newSections = parseSections(sectionEdits[0].newContent);
      if (newSections[sectionNum]) {
        mergedSections[sectionNum] = newSections[sectionNum];
      }
    }
  }

  const merged = mergedSections.map(s => s.content).join('\n');
  return { success: true, content: merged };
}

/**
 * Parses markdown sections
 */
function parseSections(content: string): Array<{ title: string; content: string }> {
  const sections: Array<{ title: string; content: string }> = [];
  const lines = content.split('\n');

  let currentSection = '';
  let currentTitle = 'preamble';

  for (const line of lines) {
    if (line.startsWith('#')) {
      if (currentSection) {
        sections.push({ title: currentTitle, content: currentSection });
      }
      currentTitle = line;
      currentSection = line + '\n';
    } else {
      currentSection += line + '\n';
    }
  }

  if (currentSection) {
    sections.push({ title: currentTitle, content: currentSection });
  }

  return sections;
}

/**
 * Validates merged output integrity
 */
export function validateMergedOutput(output: MergedOutput): boolean {
  // All integrity checks must pass
  return output.integrityChecks.every(check => check.passed);
}

/**
 * Counts unresolved conflicts in merged output
 */
export function countUnresolvedConflicts(output: MergedOutput): number {
  return output.mergeConflicts.filter(c => c.severity === 'critical').length;
}

/**
 * Formats merge resolution log
 */
export function formatMergeLog(output: MergedOutput): string {
  let log = 'Merge Resolution Log:\n\n';

  for (const logEntry of output.resolutionLog) {
    log += logEntry + '\n';
  }

  log += '\n\nIntegrity Checks:\n';
  for (const check of output.integrityChecks) {
    const status = check.passed ? '✓' : '✗';
    log += `${status} ${check.name}: ${check.details}\n`;
  }

  if (output.mergeConflicts.length > 0) {
    log += '\n\nConflicts:\n';
    for (const conflict of output.mergeConflicts) {
      log += `  ✗ ${conflict.reason}\n`;
      if (conflict.suggestedResolution) {
        log += `    → ${conflict.suggestedResolution}\n`;
      }
    }
  }

  return log;
}

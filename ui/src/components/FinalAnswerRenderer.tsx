import React, { useState, useEffect, useRef } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import hljs from 'highlight.js/lib/core';

// Register the most common languages to keep bundle size small
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml'; // covers html
import markdownLang from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('md', markdownLang);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);

interface FinalAnswerRendererProps {
  content?: string;
  compact?: boolean;
}

// ─── Syntax-highlighted code block ───────────────────────────────────────────

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!codeRef.current) return;
    if (language && hljs.getLanguage(language)) {
      const result = hljs.highlight(code, { language, ignoreIllegals: true });
      codeRef.current.innerHTML = result.value;
    } else {
      // Auto-detect (capped at 10 kB for performance)
      const snippet = code.slice(0, 10_000);
      const result = hljs.highlightAuto(snippet);
      codeRef.current.innerHTML = result.value + (code.length > snippet.length ? '\n…' : '');
    }
  }, [code, language]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-neutral-800 bg-[#0a0a0c] font-mono text-xs shadow-md">
      <div className="flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/80 px-3 py-1.5 text-[11px] text-neutral-400">
        <span className="flex items-center gap-1.5 font-semibold text-neutral-300">
          <Terminal className="h-3.5 w-3.5 text-cyan-400" />
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-100"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="custom-scrollbar max-h-96 overflow-x-auto p-3 leading-relaxed">
        <pre style={{ tabSize: 2 }}>
          {/* hljs injects highlighted HTML via the ref; initial children act as fallback */}
          <code ref={codeRef} className="hljs text-slate-200">{code}</code>
        </pre>
      </div>
    </div>
  );
}

// ─── Inline renderer: bold, italic, inline-code, links ───────────────────────

function renderInline(text: string, keyPrefix = ''): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Links must be matched before bold/italic so [**bold**](url) doesn't misparse
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith('[')) {
      // Markdown link: [label](url)
      const label = match[2];
      const href = match[3];
      parts.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-400 underline hover:text-cyan-300 transition-colors"
        >
          {label}
        </a>,
      );
    } else if (token.startsWith('**')) {
      parts.push(
        <strong key={key} className="font-semibold text-slate-100">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      parts.push(
        <em key={key} className="italic text-slate-300">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      // Inline code
      parts.push(
        <code key={key} className="rounded border border-neutral-800/80 bg-neutral-900 px-1.5 py-0.5 font-mono text-[11px] text-cyan-300">
          {token.slice(1, -1)}
        </code>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// ─── Table renderer ───────────────────────────────────────────────────────────

function isSeparatorRow(row: string): boolean {
  return /^\|[\s:|-]+\|$/.test(row.trim());
}

function parseTableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map(c => c.trim());
}

function TableRenderer({ lines, keyPrefix }: { lines: string[]; keyPrefix: string }) {
  const dataRows = lines.filter(l => !isSeparatorRow(l));
  if (dataRows.length === 0) return null;
  const [headerRow, ...bodyRows] = dataRows.map(parseTableCells);

  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-neutral-800">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-neutral-700 bg-neutral-900/80">
          <tr>
            {headerRow.map((cell, i) => (
              <th key={`${keyPrefix}-th-${i}`} className="px-3 py-1.5 font-mono font-semibold text-cyan-300">
                {renderInline(cell, `${keyPrefix}-th-${i}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={`${keyPrefix}-tr-${ri}`} className={ri % 2 === 0 ? 'bg-neutral-900/30' : 'bg-neutral-900/60'}>
              {row.map((cell, ci) => (
                <td key={`${keyPrefix}-td-${ri}-${ci}`} className="px-3 py-1.5 text-slate-300">
                  {renderInline(cell, `${keyPrefix}-td-${ri}-${ci}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Nested bullet list renderer ─────────────────────────────────────────────

function indentLevel(raw: string): number {
  const leading = raw.match(/^(\s*)/)?.[1] ?? '';
  return Math.floor(leading.replace(/\t/g, '  ').length / 2);
}

function renderBulletList(rawLines: string[], keyPrefix: string): React.ReactNode {
  const items = rawLines.map(raw => ({
    level: indentLevel(raw),
    text: raw.trim().replace(/^[-*]\s+/, ''),
  }));

  function buildTree(start: number, baseLevel: number): { nodes: React.ReactNode[]; consumed: number } {
    const nodes: React.ReactNode[] = [];
    let i = start;
    while (i < items.length) {
      const item = items[i];
      if (item.level < baseLevel) break;
      if (item.level === baseLevel) {
        const childStart = i + 1;
        const childLevel = childStart < items.length ? items[childStart].level : -1;
        if (childLevel > baseLevel) {
          const { nodes: childNodes, consumed } = buildTree(childStart, childLevel);
          nodes.push(
            <li key={`${keyPrefix}-li-${i}`} className="flex flex-col gap-0.5">
              <div className="flex items-start gap-2 text-slate-300">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400" />
                <span className="flex-1">{renderInline(item.text, `${keyPrefix}-${i}`)}</span>
              </div>
              <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-neutral-800 pl-3">{childNodes}</ul>
            </li>,
          );
          i += 1 + consumed;
        } else {
          nodes.push(
            <li key={`${keyPrefix}-li-${i}`} className="flex items-start gap-2 text-slate-300">
              <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400" />
              <span className="flex-1">{renderInline(item.text, `${keyPrefix}-${i}`)}</span>
            </li>,
          );
          i += 1;
        }
      } else {
        i += 1; // unexpected deeper level — skip
      }
    }
    return { nodes, consumed: i - start };
  }

  const { nodes } = buildTree(0, items[0]?.level ?? 0);
  return <ul className="space-y-0.5 pl-1">{nodes}</ul>;
}

// ─── Line group types and grouper ─────────────────────────────────────────────

type GroupType = 'heading' | 'hr' | 'blockquote' | 'bullet' | 'numbered' | 'table' | 'blank' | 'paragraph';

interface LineGroup {
  type: GroupType;
  lines: string[];
  level?: number;
}

function groupLines(lines: string[]): LineGroup[] {
  const groups: LineGroup[] = [];
  let tableAccum: string[] = [];

  const flushTable = () => {
    if (tableAccum.length > 0) {
      groups.push({ type: 'table', lines: [...tableAccum] });
      tableAccum = [];
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();

    // Table row
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      tableAccum.push(raw);
      continue;
    }
    flushTable();

    // Blank
    if (!trimmed) { groups.push({ type: 'blank', lines: [raw] }); continue; }

    // Heading
    if (/^#{1,3}\s/.test(trimmed)) { groups.push({ type: 'heading', lines: [raw] }); continue; }

    // Horizontal rule
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) { groups.push({ type: 'hr', lines: [raw] }); continue; }

    // Blockquote — merge consecutive lines
    if (trimmed.startsWith('> ') || trimmed === '>') {
      const last = groups[groups.length - 1];
      last?.type === 'blockquote' ? last.lines.push(raw) : groups.push({ type: 'blockquote', lines: [raw] });
      continue;
    }

    // Bullet — merge consecutive lines (including indented continuations)
    if (/^[-*]\s/.test(trimmed) || (groups[groups.length - 1]?.type === 'bullet' && /^\s+[-*]\s/.test(raw))) {
      const last = groups[groups.length - 1];
      last?.type === 'bullet' ? last.lines.push(raw) : groups.push({ type: 'bullet', lines: [raw] });
      continue;
    }

    // Numbered list — merge consecutive lines
    if (/^\d+[.)]\s/.test(trimmed)) {
      const last = groups[groups.length - 1];
      last?.type === 'numbered' ? last.lines.push(raw) : groups.push({ type: 'numbered', lines: [raw] });
      continue;
    }

    // Paragraph — merge consecutive lines
    const last = groups[groups.length - 1];
    last?.type === 'paragraph' ? last.lines.push(raw) : groups.push({ type: 'paragraph', lines: [raw] });
  }

  flushTable();
  return groups;
}

// ─── Group → JSX ─────────────────────────────────────────────────────────────

function renderGroup(group: LineGroup, key: number): React.ReactNode {
  const kp = `g-${key}`;

  switch (group.type) {
    case 'blank':
      return <div key={kp} className="h-2" />;

    case 'hr':
      return <hr key={kp} className="my-3 border-neutral-700" />;

    case 'heading': {
      const hm = group.lines[0].trim().match(/^(#{1,3})\s+(.+)$/);
      if (!hm) return null;
      const lvl = hm[1].length;
      return (
        <h4 key={kp} className={`font-semibold tracking-tight text-cyan-300 ${lvl === 1 ? 'mt-3 border-b border-neutral-800 pb-1 text-base' : lvl === 2 ? 'mt-2 text-sm' : 'mt-1.5 text-xs'}`}>
          {renderInline(hm[2], kp)}
        </h4>
      );
    }

    case 'blockquote': {
      const bqLines = group.lines.map(l => l.trim().replace(/^>\s?/, ''));
      return (
        <blockquote key={kp} className="my-1.5 border-l-2 border-cyan-600 pl-3 italic text-slate-400">
          {bqLines.map((bl, i) => <p key={`${kp}-bq-${i}`}>{renderInline(bl, `${kp}-bq-${i}`)}</p>)}
        </blockquote>
      );
    }

    case 'bullet':
      return <div key={kp} className="my-0.5">{renderBulletList(group.lines, kp)}</div>;

    case 'numbered':
      return (
        <ol key={kp} className="space-y-0.5 pl-1">
          {group.lines.map((raw, i) => {
            const nm = raw.trim().match(/^(\d+)[.)]\s+(.+)$/);
            if (!nm) return null;
            return (
              <li key={`${kp}-li-${i}`} className="flex items-start gap-2 text-slate-300">
                <span className="min-w-[16px] text-right font-mono text-xs font-bold text-cyan-400/80">{nm[1]}.</span>
                <span className="flex-1">{renderInline(nm[2], `${kp}-n-${i}`)}</span>
              </li>
            );
          })}
        </ol>
      );

    case 'table':
      return <TableRenderer key={kp} lines={group.lines} keyPrefix={kp} />;

    case 'paragraph':
    default:
      return (
        <p key={kp} className="text-slate-200">
          {group.lines.map((raw, i) => (
            <React.Fragment key={i}>
              {renderInline(raw.trim(), `${kp}-p-${i}`)}
              {i < group.lines.length - 1 && ' '}
            </React.Fragment>
          ))}
        </p>
      );
  }
}

// ─── Public component ─────────────────────────────────────────────────────────

export const FinalAnswerRenderer: React.FC<FinalAnswerRendererProps> = ({ content = '', compact = false }) => {
  if (!content.trim()) {
    return <p className="text-neutral-500 text-xs italic">No final answer was provided.</p>;
  }

  // Split into fenced code blocks vs. text segments
  const segments: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
  const codeBlockRegex = /```([a-zA-Z0-9_+.-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    segments.push({ type: 'code', language: match[1] || 'text', content: match[2].trimEnd() });
    lastIndex = codeBlockRegex.lastIndex;
  }
  if (lastIndex < content.length) segments.push({ type: 'text', content: content.slice(lastIndex) });

  return (
    <div className={compact ? 'space-y-2 text-xs leading-relaxed text-slate-200' : 'space-y-3 text-sm leading-relaxed text-slate-200'}>
      {segments.map((seg, segIdx) => {
        if (seg.type === 'code') {
          return <CodeBlock key={segIdx} code={seg.content} language={seg.language || ''} />;
        }
        const lines = seg.content.split(/\r?\n/);
        const groups = groupLines(lines);
        return (
          <div key={segIdx} className="space-y-1.5">
            {groups.map((group, gi) => renderGroup(group, segIdx * 1000 + gi))}
          </div>
        );
      })}
    </div>
  );
};

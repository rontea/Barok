import { readFile, stat } from 'fs/promises';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 120_000;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx']);

export interface ExtractedDocument {
  text: string;
  format: 'pdf' | 'docx';
  truncated: boolean;
  originalCharacters: number;
  pages?: number;
  warnings: string[];
}

export function isStructuredDocumentPath(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function extractDocumentText(filePath: string): Promise<ExtractedDocument> {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported document type "${extension || 'unknown'}". DocumentRead supports PDF and DOCX files.`);
  }

  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Document is not a file: ${filePath}`);
  if (fileStat.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document is too large (${fileStat.size} bytes); the limit is ${MAX_DOCUMENT_BYTES} bytes.`);
  }

  let text = '';
  let pages: number | undefined;
  const warnings: string[] = [];

  if (extension === '.pdf') {
    const parser = new PDFParse({ data: new Uint8Array(await readFile(filePath)) });
    try {
      const result = await parser.getText();
      text = result.text || '';
      pages = result.total;
    } finally {
      await parser.destroy();
    }
  } else {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value || '';
    warnings.push(...result.messages.map((message) => message.message));
  }

  text = text.split('\0').join('').replace(/\r\n/g, '\n').trim();
  if (!text) {
    throw new Error(`No text could be extracted from ${path.basename(filePath)}. The document may be image-only and require OCR.`);
  }

  const originalCharacters = text.length;
  const truncated = originalCharacters > MAX_EXTRACTED_CHARS;
  if (truncated) text = `${text.slice(0, MAX_EXTRACTED_CHARS)}\n...[document text truncated]`;

  return {
    text,
    format: extension === '.pdf' ? 'pdf' : 'docx',
    truncated,
    originalCharacters,
    pages,
    warnings,
  };
}

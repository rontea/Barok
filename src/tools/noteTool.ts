import * as fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { join, relative } from 'path';

export interface NoteParams {
  operation: 'add' | 'get' | 'list';
  title?: string;
  content?: string;
  note_id?: string;
}

export interface NoteToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

interface StoredNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  path: string;
}

const NOTE_DIRECTORY = join('.react-engine', 'notes');
const NOTE_HEADER_PREFIX = '<!-- react-engine-note:';
const NOTE_HEADER_SUFFIX = ' -->';
const NOTE_REFERENCE_PREFIX = 'note:';

function notesDirectory(workspace: string): string {
  return join(workspace, NOTE_DIRECTORY);
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'note';
}

function normalizeNoteId(reference: string): string | null {
  const id = reference.trim().toLowerCase().replace(/^note:/, '');
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ? id : null;
}

function serializeNote(note: Omit<StoredNote, 'path'>): string {
  const metadata = JSON.stringify({
    id: note.id,
    title: note.title,
    createdAt: note.createdAt,
  });
  return `${NOTE_HEADER_PREFIX}${metadata}${NOTE_HEADER_SUFFIX}\n\n# ${note.title}\n\n${note.content}\n`;
}

function parseNote(source: string, path: string): StoredNote | null {
  const firstLineEnd = source.indexOf('\n');
  const firstLine = (firstLineEnd >= 0 ? source.slice(0, firstLineEnd) : source).replace(/\r$/, '');
  if (!firstLine.startsWith(NOTE_HEADER_PREFIX) || !firstLine.endsWith(NOTE_HEADER_SUFFIX)) {
    return null;
  }

  try {
    const metadata = JSON.parse(
      firstLine.slice(NOTE_HEADER_PREFIX.length, -NOTE_HEADER_SUFFIX.length)
    ) as { id?: unknown; title?: unknown; createdAt?: unknown };
    if (
      typeof metadata.id !== 'string' ||
      typeof metadata.title !== 'string' ||
      typeof metadata.createdAt !== 'string'
    ) {
      return null;
    }

    const heading = `# ${metadata.title}`;
    const bodyStart = source.indexOf(heading, firstLineEnd);
    const contentStart = bodyStart < 0 ? firstLineEnd + 1 : bodyStart + heading.length;
    return {
      id: metadata.id,
      title: metadata.title,
      createdAt: metadata.createdAt,
      content: source.slice(contentStart).replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, ''),
      path,
    };
  } catch {
    return null;
  }
}

async function loadNote(workspace: string, id: string): Promise<StoredNote | null> {
  const path = join(notesDirectory(workspace), `${id}.md`);
  try {
    return parseNote(await fs.readFile(path, 'utf8'), path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function addNote(workspace: string, title: string, content: string): Promise<NoteToolResult> {
  const directory = notesDirectory(workspace);
  await fs.mkdir(directory, { recursive: true });

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = `${slugify(title)}-${randomBytes(4).toString('hex')}`;
    const path = join(directory, `${id}.md`);
    const createdAt = new Date().toISOString();

    try {
      await fs.writeFile(path, serializeNote({ id, title, content, createdAt }), {
        encoding: 'utf8',
        flag: 'wx',
      });
      const projectPath = relative(workspace, path).replace(/\\/g, '/');
      return {
        success: true,
        output: [
          `Saved note "${title}".`,
          `Reference: ${NOTE_REFERENCE_PREFIX}${id}`,
          `Path: ${projectPath}`,
        ].join('\n'),
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        continue;
      }
      throw error;
    }
  }

  return { success: false, error: 'Could not allocate a unique note ID. Please try again.' };
}

async function getNote(workspace: string, reference: string): Promise<NoteToolResult> {
  const id = normalizeNoteId(reference);
  if (!id) {
    return { success: false, error: `Invalid note reference "${reference}". Expected note:<id> or <id>.` };
  }

  const note = await loadNote(workspace, id);
  if (!note) {
    return { success: false, error: `Note ${NOTE_REFERENCE_PREFIX}${id} was not found in this project.` };
  }

  return {
    success: true,
    output: [
      `Reference: ${NOTE_REFERENCE_PREFIX}${note.id}`,
      `Title: ${note.title}`,
      `Created: ${note.createdAt}`,
      `Path: ${relative(workspace, note.path).replace(/\\/g, '/')}`,
      '',
      note.content,
    ].join('\n'),
  };
}

async function listNotes(workspace: string): Promise<NoteToolResult> {
  const directory = notesDirectory(workspace);
  let entries: string[];
  try {
    entries = (await fs.readdir(directory)).filter((entry) => entry.endsWith('.md')).sort();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { success: true, output: 'No project notes have been saved.' };
    }
    throw error;
  }

  const notes = (
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry);
      return parseNote(await fs.readFile(path, 'utf8'), path);
    }))
  )
    .filter((note): note is StoredNote => note !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  if (notes.length === 0) {
    return { success: true, output: 'No project notes have been saved.' };
  }

  return {
    success: true,
    output: notes
      .map((note) => `${NOTE_REFERENCE_PREFIX}${note.id} — ${note.title} (${note.createdAt})`)
      .join('\n'),
  };
}

/** Stores and retrieves durable notes scoped to the active project workspace. */
export async function projectNoteTool(
  workspace: string,
  params: NoteParams
): Promise<NoteToolResult> {
  try {
    if (params.operation === 'add') {
      return await addNote(workspace, params.title!, params.content!);
    }
    if (params.operation === 'get') {
      return await getNote(workspace, params.note_id!);
    }
    return await listNotes(workspace);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown project note error',
    };
  }
}

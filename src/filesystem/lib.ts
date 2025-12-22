import fs from "fs/promises";
import path from "path";
import os from 'os';
import { randomBytes } from 'crypto';
import { diffLines, createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';
import { normalizePath, expandHome } from './path-utils.js';
import { isPathWithinAllowedDirectories } from './path-validation.js';

// Global allowed directories - set by the main module
let allowedDirectories: string[] = [];

// Function to set allowed directories from the main module
export function setAllowedDirectories(directories: string[]): void {
  allowedDirectories = [...directories];
}

// Function to get current allowed directories
export function getAllowedDirectories(): string[] {
  return [...allowedDirectories];
}

// Type definitions
interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

export interface SearchOptions {
  excludePatterns?: string[];
}

export interface SearchResult {
  path: string;
  isDirectory: boolean;
}

// Grep-related interfaces
export interface GrepOptions {
  searchPath: string;
  pattern: string;
  ignoreCase?: boolean;
  recursive?: boolean;
  maxResults?: number;
  context?: number;
  beforeContext?: number;
  afterContext?: number;
  filePattern?: string;
  includeLineNumbers?: boolean;
  excludePatterns?: string[];
  invertMatch?: boolean;
  fixedStrings?: boolean;
}

export interface GrepMatch {
  file: string;
  lineNumber: number;
  content: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface GrepResult {
  file: string;
  matches: GrepMatch[];
  totalMatches: number;
}

// Pure Utility Functions
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  
  if (i < 0 || i === 0) return `${bytes} ${units[0]}`;
  
  const unitIndex = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`;
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function createUnifiedDiff(originalContent: string, newContent: string, filepath: string = 'file'): string {
  // Ensure consistent line endings for diff
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    'original',
    'modified'
  );
}

// Security & Validation Functions
export async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Security: Check if path is within allowed directories before any file operations
  const isAllowed = isPathWithinAllowedDirectories(normalizedRequested, allowedDirectories);
  if (!isAllowed) {
    throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
  }

  // Security: Handle symlinks by checking their real path to prevent symlink attacks
  // This prevents attackers from creating symlinks that point outside allowed directories
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    if (!isPathWithinAllowedDirectories(normalizedReal, allowedDirectories)) {
      throw new Error(`Access denied - symlink target outside allowed directories: ${realPath} not in ${allowedDirectories.join(', ')}`);
    }
    return realPath;
  } catch (error) {
    // Security: For new files that don't exist yet, verify parent directory
    // This ensures we can't create files in unauthorized locations
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const parentDir = path.dirname(absolute);
      try {
        const realParentPath = await fs.realpath(parentDir);
        const normalizedParent = normalizePath(realParentPath);
        if (!isPathWithinAllowedDirectories(normalizedParent, allowedDirectories)) {
          throw new Error(`Access denied - parent directory outside allowed directories: ${realParentPath} not in ${allowedDirectories.join(', ')}`);
        }
        return absolute;
      } catch {
        throw new Error(`Parent directory does not exist: ${parentDir}`);
      }
    }
    throw error;
  }
}


// File Operations
export async function getFileStats(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

export async function readFileContent(filePath: string, encoding: string = 'utf-8'): Promise<string> {
  return await fs.readFile(filePath, encoding as BufferEncoding);
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  try {
    // Security: 'wx' flag ensures exclusive creation - fails if file/symlink exists,
    // preventing writes through pre-existing symlinks
    await fs.writeFile(filePath, content, { encoding: "utf-8", flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // Security: Use atomic rename to prevent race conditions where symlinks
      // could be created between validation and write. Rename operations
      // replace the target file atomically and don't follow symlinks.
      const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
      try {
        await fs.writeFile(tempPath, content, 'utf-8');
        await fs.rename(tempPath, filePath);
      } catch (renameError) {
        try {
          await fs.unlink(tempPath);
        } catch {}
        throw renameError;
      }
    } else {
      throw error;
    }
  }
}


// File Editing Functions
interface FileEdit {
  oldText: string;
  newText: string;
}

export async function applyFileEdits(
  filePath: string,
  edits: FileEdit[],
  dryRun: boolean = false
): Promise<string> {
  // Read file content and normalize line endings
  const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));

  // Apply edits sequentially
  let modifiedContent = content;
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    // If exact match exists, use it
    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }

    // Otherwise, try line-by-line matching with flexibility for whitespace
    const oldLines = normalizedOld.split('\n');
    const contentLines = modifiedContent.split('\n');
    let matchFound = false;

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);

      // Compare lines with normalized whitespace
      const isMatch = oldLines.every((oldLine, j) => {
        const contentLine = potentialMatch[j];
        return oldLine.trim() === contentLine.trim();
      });

      if (isMatch) {
        // Preserve original indentation of first line
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
        const newLines = normalizedNew.split('\n').map((line, j) => {
          if (j === 0) return originalIndent + line.trimStart();
          // For subsequent lines, try to preserve relative indentation
          const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
          const newIndent = line.match(/^\s*/)?.[0] || '';
          if (oldIndent && newIndent) {
            const relativeIndent = newIndent.length - oldIndent.length;
            return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
          }
          return line;
        });

        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join('\n');
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }

  // Create unified diff
  const diff = createUnifiedDiff(content, modifiedContent, filePath);

  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (diff.includes('`'.repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;

  if (!dryRun) {
    // Security: Use atomic rename to prevent race conditions where symlinks
    // could be created between validation and write. Rename operations
    // replace the target file atomically and don't follow symlinks.
    const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tempPath, modifiedContent, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {}
      throw error;
    }
  }

  return formattedDiff;
}

// Memory-efficient implementation to get the last N lines of a file
export async function tailFile(filePath: string, numLines: number): Promise<string> {
  const CHUNK_SIZE = 1024; // Read 1KB at a time
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;
  
  if (fileSize === 0) return '';
  
  // Open file for reading
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const lines: string[] = [];
    let position = fileSize;
    let chunk = Buffer.alloc(CHUNK_SIZE);
    let linesFound = 0;
    let remainingText = '';
    
    // Read chunks from the end of the file until we have enough lines
    while (position > 0 && linesFound < numLines) {
      const size = Math.min(CHUNK_SIZE, position);
      position -= size;
      
      const { bytesRead } = await fileHandle.read(chunk, 0, size, position);
      if (!bytesRead) break;
      
      // Get the chunk as a string and prepend any remaining text from previous iteration
      const readData = chunk.slice(0, bytesRead).toString('utf-8');
      const chunkText = readData + remainingText;
      
      // Split by newlines and count
      const chunkLines = normalizeLineEndings(chunkText).split('\n');
      
      // If this isn't the end of the file, the first line is likely incomplete
      // Save it to prepend to the next chunk
      if (position > 0) {
        remainingText = chunkLines[0];
        chunkLines.shift(); // Remove the first (incomplete) line
      }
      
      // Add lines to our result (up to the number we need)
      for (let i = chunkLines.length - 1; i >= 0 && linesFound < numLines; i--) {
        lines.unshift(chunkLines[i]);
        linesFound++;
      }
    }
    
    return lines.join('\n');
  } finally {
    await fileHandle.close();
  }
}

// New function to get the first N lines of a file
export async function headFile(filePath: string, numLines: number): Promise<string> {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const lines: string[] = [];
    let buffer = '';
    let bytesRead = 0;
    const chunk = Buffer.alloc(1024); // 1KB buffer
    
    // Read chunks and count lines until we have enough or reach EOF
    while (lines.length < numLines) {
      const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break; // End of file
      bytesRead += result.bytesRead;
      buffer += chunk.slice(0, result.bytesRead).toString('utf-8');
      
      const newLineIndex = buffer.lastIndexOf('\n');
      if (newLineIndex !== -1) {
        const completeLines = buffer.slice(0, newLineIndex).split('\n');
        buffer = buffer.slice(newLineIndex + 1);
        for (const line of completeLines) {
          lines.push(line);
          if (lines.length >= numLines) break;
        }
      }
    }
    
    // If there is leftover content and we still need lines, add it
    if (buffer.length > 0 && lines.length < numLines) {
      lines.push(buffer);
    }
    
    return lines.join('\n');
  } finally {
    await fileHandle.close();
  }
}

export async function searchFilesWithValidation(
  rootPath: string,
  pattern: string,
  allowedDirectories: string[],
  options: SearchOptions = {}
): Promise<string[]> {
  const { excludePatterns = [] } = options;
  const results: string[] = [];

  async function search(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      try {
        await validatePath(fullPath);

        const relativePath = path.relative(rootPath, fullPath);
        const shouldExclude = excludePatterns.some(excludePattern =>
          minimatch(relativePath, excludePattern, { dot: true })
        );

        if (shouldExclude) continue;

        // Use glob matching for the search pattern
        if (minimatch(relativePath, pattern, { dot: true })) {
          results.push(fullPath);
        }

        if (entry.isDirectory()) {
          await search(fullPath);
        }
      } catch {
        continue;
      }
    }
  }

  await search(rootPath);
  return results;
}

// Grep Content Search Functions
export async function searchFileContents(options: GrepOptions): Promise<string[]> {
  const {
    searchPath,
    pattern,
    ignoreCase = false,
    recursive = true,
    maxResults = 100,
    context = 0,
    beforeContext,
    afterContext,
    filePattern = '*',
    includeLineNumbers = true,
    excludePatterns = [],
    invertMatch = false,
    fixedStrings = false
  } = options;

  // Handle context parameter properly - if context is provided (and not 0), it overrides beforeContext and afterContext
  // This follows the Python implementation where context parameter takes precedence
  const effectiveBeforeContext = (context !== undefined && context > 0) ? context : (beforeContext !== undefined ? beforeContext : 0);
  const effectiveAfterContext = (context !== undefined && context > 0) ? context : (afterContext !== undefined ? afterContext : 0);

  // Validate the search path
  const validatedSearchPath = await validatePath(searchPath);

  // Handle pattern based on flags (similar to Python implementation)
  let effectivePattern = pattern;
  if (fixedStrings) {
    // For fixed strings, escape the pattern to match it literally
    effectivePattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  let regex: RegExp | null = null;
  try {
    regex = new RegExp(effectivePattern, ignoreCase ? 'gi' : 'g');
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${effectivePattern}. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Helper function to check if a line matches the pattern
  const matchesPattern = (line: string): boolean => {
    let matches: boolean;
    if (regex) {
      // Reset regex for each line to handle global flag correctly
      regex.lastIndex = 0;
      matches = regex.test(line);
      regex.lastIndex = 0; // Reset again for future uses
    } else {
      // Fallback for non-regex matches
      if (ignoreCase) {
        matches = line.toLowerCase().includes(pattern.toLowerCase());
      } else {
        matches = line.includes(pattern);
      }
    }

    // Handle invertMatch - return true if line should be included
    return matches !== invertMatch;
  };

  const results: string[] = [];
  let totalMatches = 0;

  async function searchInFile(filePath: string): Promise<void> {
    if (totalMatches >= maxResults) return;

    try {
      // Additional validation for each file
      await validatePath(filePath);

      // Check if file should be excluded
      const relativePath = path.relative(validatedSearchPath, filePath);
      const shouldExclude = excludePatterns.some(excludePattern =>
        minimatch(relativePath, excludePattern, { dot: true })
      );

      if (shouldExclude) return;

      // Try to read the file as text
      const content = await readFileContent(filePath);
      const lines = normalizeLineEndings(content).split('\n');

      const fileMatches: GrepMatch[] = [];

      for (let i = 0; i < lines.length && totalMatches < maxResults; i++) {
        const line = lines[i];

        if (matchesPattern(line)) {
          const contextBeforeLines = effectiveBeforeContext > 0
            ? lines.slice(Math.max(0, i - effectiveBeforeContext), i)
            : [];
          const contextAfterLines = effectiveAfterContext > 0
            ? lines.slice(i + 1, Math.min(lines.length, i + 1 + effectiveAfterContext))
            : [];

          const match: GrepMatch = {
            file: filePath,
            lineNumber: i + 1,
            content: line,
            contextBefore: contextBeforeLines.length > 0 ? contextBeforeLines : undefined,
            contextAfter: contextAfterLines.length > 0 ? contextAfterLines : undefined
          };

          fileMatches.push(match);
          totalMatches++;

          if (totalMatches >= maxResults) break;
        }
      }

      // Format results for this file
      if (fileMatches.length > 0) {
        let fileResult = `File: ${filePath}\n`;

        for (const match of fileMatches) {
          if (includeLineNumbers) {
            fileResult += `  Line ${match.lineNumber}: ${match.content}\n`;
          } else {
            fileResult += `  ${match.content}\n`;
          }

          if (effectiveBeforeContext > 0 || effectiveAfterContext > 0) {
            if (match.contextBefore && match.contextBefore.length > 0) {
              fileResult += '    Context before:\n';
              match.contextBefore.forEach((line, idx) => {
                const lineNum = match.lineNumber - effectiveBeforeContext + idx;
                fileResult += `      ${includeLineNumbers ? `${lineNum}: ` : ''}${line}\n`;
              });
            }

            if (match.contextAfter && match.contextAfter.length > 0) {
              fileResult += '    Context after:\n';
              match.contextAfter.forEach((line, idx) => {
                const lineNum = match.lineNumber + idx + 1;
                fileResult += `      ${includeLineNumbers ? `${lineNum}: ` : ''}${line}\n`;
              });
            }
          }
        }

        results.push(fileResult.trim());
      }

    } catch (error) {
      // Skip files that can't be read as text or are not accessible
      // Common cases: binary files, permission issues, directories, etc.
      if (error instanceof Error) {
        // Only skip expected errors, throw unexpected ones
        const errorCode = (error as any)?.code;
        if (errorCode === 'EISDIR' ||
            errorCode === 'EACCES' ||
            errorCode === 'ENOENT' ||
            error.message.includes('Access denied')) {
          return; // Skip this file
        }
      }
      // For other errors, we might want to continue but could optionally log
      return;
    }
  }

  async function searchDirectory(dirPath: string): Promise<void> {
    if (totalMatches >= maxResults) return;

    try {
      // Validate directory path
      await validatePath(dirPath);

      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (totalMatches >= maxResults) break;

        const fullPath = path.join(dirPath, entry.name);

        try {
          if (entry.isFile()) {
            // Check if file matches the file pattern
            if (filePattern === '*' || minimatch(entry.name, filePattern)) {
              await searchInFile(fullPath);
            }
          } else if (entry.isDirectory() && recursive) {
            await searchDirectory(fullPath);
          }
        } catch (error) {
          // Skip individual files/directories that can't be accessed
          continue;
        }
      }
    } catch (error) {
      // Handle directory read errors
      if (error instanceof Error) {
        const errorCode = (error as any)?.code;
        if (errorCode === 'EACCES' || errorCode === 'ENOENT') {
          return; // Skip directories we can't access
        }
      }
      throw error; // Re-throw unexpected errors
    }
  }

  // Determine if search path is a file or directory
  const stats = await fs.stat(validatedSearchPath);
  if (stats.isFile()) {
    // Check if single file matches file pattern
    const fileName = path.basename(validatedSearchPath);
    if (filePattern === '*' || minimatch(fileName, filePattern)) {
      await searchInFile(validatedSearchPath);
    }
  } else if (stats.isDirectory()) {
    await searchDirectory(validatedSearchPath);
  } else {
    throw new Error(`Path is neither a file nor a directory: ${validatedSearchPath}`);
  }

  return results;
}

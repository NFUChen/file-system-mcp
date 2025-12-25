import fs from "fs/promises";
import path from "path";
import os from 'os';
import { randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { diffLines, createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';
import { normalizePath, expandHome } from './path-utils.js';
import { isPathWithinAllowedDirectories } from './path-validation.js';

const execFileAsync = promisify(execFile);

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

/**
 * Prepares a glob pattern for plocate.
 * Plocate supports shell glob patterns (*, ?, [chars]) directly and searches recursively by default.
 * We only need to remove ** (since plocate doesn't support it and doesn't need it - it's recursive by default).
 * 
 * @param globPattern - The glob pattern to prepare
 * @returns A pattern ready for plocate, or null if we should skip plocate for this pattern
 */
function preparePatternForPlocate(globPattern: string): string | null {
  // Plocate supports basic shell glob patterns: *, ?, [chars]
  // It does NOT support: ** (recursive), {a,b} (brace expansion), extended glob patterns

  // First, try to convert ** patterns to equivalent plocate patterns
  // **/pattern -> pattern (plocate is recursive by default)
  // pattern/** -> pattern
  // **/pattern/** -> pattern
  let converted = globPattern
    .replace(/^\*\*\/+/, '')      // Remove leading **/
    .replace(/\/+\*\*$/, '')      // Remove trailing /**
    .replace(/\*\*\/+/g, '')      // Remove **/ in the middle
    .replace(/\/+\*\*/g, '');     // Remove /** in the middle

  // Check for patterns that should cause fallback to recursive search
  if (
    converted.includes('**') ||   // Still has ** after conversion
    converted.includes('{') ||    // Brace expansion {a,b}
    converted.includes('!(') ||   // Extended glob !(pattern)
    converted.includes('?(') ||   // Extended glob ?(pattern)
    converted.includes('*(') ||   // Extended glob *(pattern)
    converted.includes('+(') ||   // Extended glob +(pattern)
    converted.includes('@(') ||   // Extended glob @(pattern)
    converted === '' ||           // Empty pattern after conversion
    converted === '/' ||          // Just slash
    converted.startsWith('!') ||  // Negation patterns
    converted.includes('\\')      // Escape sequences (complex)
  ) {
    return null;  // Fall back to recursive search
  }

  // For simple patterns (*.js, file?.txt, [abc]*), return the converted pattern
  return converted;
}

/**
 * Check if plocate is available and database exists
 */
async function isPlocateAvailable(): Promise<boolean> {
  const plocateDb = process.env.PLOCATE_DB || '/var/lib/plocate/plocate.db';
  
  try {
    // Check if database file exists
    await fs.access(plocateDb);
    
    // Try to run plocate --version to check if it's installed
    try {
      await execFileAsync('plocate', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
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

  // Try to use plocate if available
  const usePlocate = await isPlocateAvailable();
  
  if (usePlocate) {
    // Plocate supports shell glob patterns (*, ?, [chars]) directly
    // We only need to remove ** (since plocate is recursive by default)
    // and check for unsupported syntax
    const plocatePattern = preparePatternForPlocate(pattern);
    
    if (plocatePattern !== null) {
      // Build plocate command variables outside try block for error handling
      const plocateDb = process.env.PLOCATE_DB || '/var/lib/plocate/plocate.db';
      const plocateArgs: string[] = ['--database', plocateDb, '--limit', '10000'];
      const searchPattern = plocatePattern;
      plocateArgs.push(searchPattern);

      try {
        
        // Execute plocate
        const { stdout } = await execFileAsync('plocate', plocateArgs, {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          encoding: 'utf-8' as BufferEncoding,
          timeout: 30000 // 30 second timeout
        });
        
        // Parse results - plocate returns one path per line
        const allPaths = stdout.split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0);

        // Normalize root path once for efficient comparison
        const normalizedRoot = normalizePath(rootPath);
        const rootPathWithSlash = normalizedRoot.endsWith('/')
          ? normalizedRoot
          : normalizedRoot + '/';

        // Filter results to be within rootPath and allowed directories
        for (const filePath of allPaths) {
          try {
            // Normalize path for comparison
            const normalizedPath = normalizePath(filePath);

            // Early check: skip if path is not within rootPath
            if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(rootPathWithSlash)) {
              continue;
            }
            
            // Validate path is within allowed directories
            // This may throw, so we catch it below
            try {
              await validatePath(filePath);
            } catch (validationError) {
              // Skip paths that fail validation
              continue;
            }
            
            // Calculate relative path for pattern matching and exclusion
            // Use the original rootPath and filePath (not normalized) for path.relative
            // to ensure correct relative path calculation
            const relativePath = path.relative(rootPath, filePath);
            
            // Apply exclude patterns
            const shouldExclude = excludePatterns.some(excludePattern =>
              minimatch(relativePath, excludePattern, { dot: true })
            );

            if (shouldExclude) continue;

            // Trust plocate's pattern matching for supported patterns
            // Since we've filtered to only send patterns that plocate supports,
            // we don't need to double-check with minimatch
            results.push(filePath);
          } catch {
            // Skip invalid paths
            continue;
          }
        }
        
        return results;
      } catch (error: any) {
        // If plocate returns exit code 1, it means no matches found (this is normal)
        if (error.code === 1) {
          return [];
        }

        // Log detailed error information for debugging
        const errorDetails = {
          message: error.message,
          code: error.code,
          pattern: searchPattern,
          rootPath: rootPath,
          command: `plocate ${plocateArgs.join(' ')}`
        };

        // Different handling based on error type
        if (error.code === 127) {
          // Command not found - plocate not installed
          console.error(`Plocate command not found, falling back to recursive search`);
        } else if (error.message?.includes('timeout')) {
          // Timeout error
          console.error(`Plocate search timed out for pattern "${searchPattern}", falling back to recursive search`);
        } else if (error.message?.includes('database')) {
          // Database-related error
          console.error(`Plocate database error: ${error.message}, falling back to recursive search`);
        } else {
          // General error with more context
          console.error(`Plocate search failed, falling back to recursive search:`, errorDetails);
        }
      }
    }
    // If plocatePattern is null, fall through to recursive search below
  }
  
  // Fallback to original recursive search method (used when plocate is not available
  // or when pattern conversion returns null)
  async function search(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    // Defensive check in case entries is not iterable (e.g., due to mocking issues)
    if (!Array.isArray(entries)) {
      console.warn('fs.readdir returned non-iterable result:', entries);
      return;
    }

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
  const effectiveBeforeContext = (context !== undefined && context > 0) ? context : (beforeContext !== undefined ? beforeContext : 0);
  const effectiveAfterContext = (context !== undefined && context > 0) ? context : (afterContext !== undefined ? afterContext : 0);

  // Validate the search path
  const validatedSearchPath = await validatePath(searchPath);

  // Build ripgrep command arguments
  const rgArgs: string[] = [];

  // Pattern handling
  if (fixedStrings) {
    rgArgs.push('--fixed-strings');
  }
  rgArgs.push(pattern);

  // Search path
  rgArgs.push(validatedSearchPath);

  // Case sensitivity
  if (ignoreCase) {
    rgArgs.push('--ignore-case');
  }

  // Recursive search
  if (!recursive) {
    rgArgs.push('--maxdepth', '1');
  }

  // Context lines
  if (effectiveBeforeContext > 0 || effectiveAfterContext > 0) {
    if (effectiveBeforeContext === effectiveAfterContext) {
      rgArgs.push('--context', effectiveBeforeContext.toString());
    } else {
      if (effectiveBeforeContext > 0) {
        rgArgs.push('--before-context', effectiveBeforeContext.toString());
      }
      if (effectiveAfterContext > 0) {
        rgArgs.push('--after-context', effectiveAfterContext.toString());
      }
    }
  }

  // Line numbers
  if (includeLineNumbers) {
    rgArgs.push('--line-number');
  }

  // Invert match
  if (invertMatch) {
    rgArgs.push('--invert-match');
  }

  // File pattern (glob)
  if (filePattern !== '*') {
    rgArgs.push('--glob', filePattern);
  }

  // Exclude patterns
  for (const excludePattern of excludePatterns) {
    rgArgs.push('--glob', `!${excludePattern}`);
  }

  // Note: ripgrep's --max-count limits per file, not globally
  // We'll handle global maxResults limit in post-processing

  // Output format: file path, line number, and content
  rgArgs.push('--with-filename');
  rgArgs.push('--no-heading');
  rgArgs.push('--no-column');

  // Color output disabled for parsing
  rgArgs.push('--color', 'never');

  try {
    // Execute ripgrep
    const { stdout, stderr } = await execFileAsync('rg', rgArgs, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      encoding: 'utf-8' as BufferEncoding
    });

    if (stderr && !stderr.includes('No matches found')) {
      // ripgrep may output warnings to stderr, but we'll continue if there's stdout
      if (!stdout) {
        throw new Error(`ripgrep error: ${stderr}`);
      }
    }

    if (!stdout || stdout.trim().length === 0) {
      return [];
    }

    // Parse ripgrep output
    // Format: filepath:linenumber:content
    // With context, ripgrep still uses the same format, just includes more lines
    // Separator lines "---" appear between different file matches
    const lines = stdout.split('\n').filter((line: string) => line.trim().length > 0);
    const results: string[] = [];
    const fileResults: Map<string, Array<{ lineNumber: number; content: string }>> = new Map();

    for (const line of lines) {
      // Skip separator lines (appear between files when using context)
      if (line.trim() === '---') {
        continue;
      }

      // Match pattern: filepath:linenumber:content
      // This is the standard ripgrep output format
      const match = line.match(/^(.+?):(\d+):(.*)$/);
      if (match) {
        const [, filePath, lineNum, content] = match;
        if (!fileResults.has(filePath)) {
          fileResults.set(filePath, []);
        }
        fileResults.get(filePath)!.push({
          lineNumber: parseInt(lineNum, 10),
          content: content
        });
      }
    }

    // Format results and limit total matches
    // Note: We count actual matches (not context lines) to respect maxResults
    // Since ripgrep includes context lines, we need to identify actual matches
    // For simplicity, we'll include all lines but limit the number of files processed
    let totalMatches = 0;
    for (const [filePath, matches] of fileResults.entries()) {
      if (totalMatches >= maxResults) break;
      
      // Count matches in this file (approximate - all lines are potential matches)
      // In practice, ripgrep with context will show matching lines and context
      // We'll include all lines up to the limit
      const matchesToInclude = matches.slice(0, maxResults - totalMatches);
      totalMatches += matchesToInclude.length;
      
      if (matchesToInclude.length > 0) {
        let fileResult = `File: ${filePath}\n`;
        for (const match of matchesToInclude) {
          if (includeLineNumbers) {
            fileResult += `  Line ${match.lineNumber}: ${match.content}\n`;
          } else {
            fileResult += `  ${match.content}\n`;
          }
        }
        results.push(fileResult.trim());
      }
    }

    return results;
  } catch (error: any) {
    // Handle ripgrep not found or execution errors
    if (error.code === 'ENOENT') {
      throw new Error('ripgrep (rg) is not installed. Please install ripgrep to use this feature.');
    }
    if (error.code === 1) {
      // ripgrep returns exit code 1 when no matches are found (this is normal)
      return [];
    }
    throw new Error(`ripgrep execution failed: ${error.message || String(error)}`);
  }
}

/**
 * Extract project introduction from common documentation files.
 * Looks for files like CLAUDE.md, README.md, and other common intro files.
 * 
 * @param projectPath - The root path of the project to analyze
 * @param includeAdditionalFiles - Whether to include additional common intro files
 * @returns Object containing the extracted content and metadata about which files were found
 */
export interface ProjectIntroResult {
  content: string;
  filesFound: string[];
  filesChecked: string[];
}

export async function extractProjectIntro(
  projectPath: string,
  includeAdditionalFiles: boolean = true
): Promise<ProjectIntroResult> {
  const validPath = await validatePath(projectPath);
  
  // Priority list of files that typically contain project introductions
  // CLAUDE.md is Claude-specific, README.md is universal
  const priorityFiles = [
    'CLAUDE.md',
    'README.md',
  ];
  
  // Additional files that might contain project information
  // Ordered by commonality: most common first
  const additionalFiles = includeAdditionalFiles ? [
    // Common documentation files (found in many projects)
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    'SECURITY.md',
    'CODE_OF_CONDUCT.md',
    // Architecture and design docs (common in larger projects)
    'ARCHITECTURE.md',
    'DESIGN.md',
    'OVERVIEW.md',
    // Alternative intro files (less common)
    'INTRO.md',
    'ABOUT.md',
    'GETTING_STARTED.md',
    'QUICKSTART.md',
    // Documentation directories
    'docs/README.md',
    'docs/INTRO.md',
    'docs/OVERVIEW.md',
    'docs/GETTING_STARTED.md',
    // GitHub-specific
    '.github/README.md',
    '.github/CONTRIBUTING.md',
  ] : [];
  
  const allFiles = [...priorityFiles, ...additionalFiles];
  const filesFound: string[] = [];
  const contents: Array<{ file: string; content: string }> = [];
  
  // Check each file
  for (const fileName of allFiles) {
    const filePath = path.join(validPath, fileName);
    try {
      // Validate the file path is within allowed directories
      await validatePath(filePath);
      
      // Check if file exists and is readable
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        const content = await readFileContent(filePath);
        filesFound.push(fileName);
        contents.push({ file: fileName, content });
      }
    } catch (error) {
      // File doesn't exist or can't be read - skip it
      continue;
    }
  }
  
  // If no files found, return empty result
  if (contents.length === 0) {
    return {
      content: '',
      filesFound: [],
      filesChecked: allFiles,
    };
  }
  
  // Combine contents with clear separators
  // Priority files first (in order), then additional files
  const priorityContents: Array<{ file: string; content: string }> = [];
  for (const priorityFile of priorityFiles) {
    const found = contents.find(c => c.file === priorityFile);
    if (found) {
      priorityContents.push(found);
    }
  }
  const additionalContents = contents.filter(c => additionalFiles.includes(c.file));
  
  const combinedContents: string[] = [];
  
  // Add priority files in order
  for (const { file, content } of priorityContents) {
    combinedContents.push(`# ${file}\n\n${content}`);
  }
  
  // Add additional files if any
  if (additionalContents.length > 0) {
    combinedContents.push('\n---\n\n## Additional Documentation\n');
    for (const { file, content } of additionalContents) {
      combinedContents.push(`### ${file}\n\n${content}`);
    }
  }
  
  return {
    content: combinedContents.join('\n\n---\n\n'),
    filesFound,
    filesChecked: allFiles,
  };
}

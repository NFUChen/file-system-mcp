import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import {
  // Pure utility functions
  formatSize,
  normalizeLineEndings,
  createUnifiedDiff,
  // Security & validation functions
  validatePath,
  setAllowedDirectories,
  // File operations
  getFileStats,
  readFileContent,
  // Search & filtering functions
  searchFilesWithValidation,
  searchFileContents,
  // File editing functions
  tailFile,
  headFile,
  // Project intro extraction
  extractProjectIntro
} from '../lib.js';

// Mock fs module
vi.mock('fs/promises');
const mockFs = fs as any;

// Mock child_process module
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, options, callback) => {
    // Default implementation that calls callback with success
    if (callback) {
      callback(null, { stdout: '', stderr: '' });
    }
  })
}));
const mockExecFile = vi.mocked(execFile);

describe('Lib Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up allowed directories for tests
    const allowedDirs = process.platform === 'win32' ? ['C:\\Users\\test', 'C:\\temp', 'C:\\allowed'] : ['/home/user', '/tmp', '/allowed'];
    setAllowedDirectories(allowedDirs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clear allowed directories after tests
    setAllowedDirectories([]);
  });

  describe('Pure Utility Functions', () => {
    describe('formatSize', () => {
      it('formats bytes correctly', () => {
        expect(formatSize(0)).toBe('0 B');
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(1024)).toBe('1.00 KB');
        expect(formatSize(1536)).toBe('1.50 KB');
        expect(formatSize(1048576)).toBe('1.00 MB');
        expect(formatSize(1073741824)).toBe('1.00 GB');
        expect(formatSize(1099511627776)).toBe('1.00 TB');
      });

      it('handles edge cases', () => {
        expect(formatSize(1023)).toBe('1023 B');
        expect(formatSize(1025)).toBe('1.00 KB');
        expect(formatSize(1048575)).toBe('1024.00 KB');
      });

      it('handles very large numbers beyond TB', () => {
        // The function only supports up to TB, so very large numbers will show as TB
        expect(formatSize(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1024.00 TB');
        expect(formatSize(Number.MAX_SAFE_INTEGER)).toContain('TB');
      });

      it('handles negative numbers', () => {
        // Negative numbers will result in NaN for the log calculation
        expect(formatSize(-1024)).toContain('NaN');
        expect(formatSize(-0)).toBe('0 B');
      });

      it('handles decimal numbers', () => {
        expect(formatSize(1536.5)).toBe('1.50 KB');
        expect(formatSize(1023.9)).toBe('1023.9 B');
      });

      it('handles very small positive numbers', () => {
        expect(formatSize(1)).toBe('1 B');
        expect(formatSize(0.5)).toBe('0.5 B');
        expect(formatSize(0.1)).toBe('0.1 B');
      });
    });

    describe('normalizeLineEndings', () => {
      it('converts CRLF to LF', () => {
        expect(normalizeLineEndings('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3');
      });

      it('leaves LF unchanged', () => {
        expect(normalizeLineEndings('line1\nline2\nline3')).toBe('line1\nline2\nline3');
      });

      it('handles mixed line endings', () => {
        expect(normalizeLineEndings('line1\r\nline2\nline3\r\n')).toBe('line1\nline2\nline3\n');
      });

      it('handles empty string', () => {
        expect(normalizeLineEndings('')).toBe('');
      });
    });

    describe('createUnifiedDiff', () => {
      it('creates diff for simple changes', () => {
        const original = 'line1\nline2\nline3';
        const modified = 'line1\nmodified line2\nline3';
        const diff = createUnifiedDiff(original, modified, 'test.txt');
        
        expect(diff).toContain('--- test.txt');
        expect(diff).toContain('+++ test.txt');
        expect(diff).toContain('-line2');
        expect(diff).toContain('+modified line2');
      });

      it('handles CRLF normalization', () => {
        const original = 'line1\r\nline2\r\n';
        const modified = 'line1\nmodified line2\n';
        const diff = createUnifiedDiff(original, modified);
        
        expect(diff).toContain('-line2');
        expect(diff).toContain('+modified line2');
      });

      it('handles identical content', () => {
        const content = 'line1\nline2\nline3';
        const diff = createUnifiedDiff(content, content);
        
        // Should not contain any +/- lines for identical content (excluding header lines)
        expect(diff.split('\n').filter((line: string) => line.startsWith('+++') || line.startsWith('---'))).toHaveLength(2);
        expect(diff.split('\n').filter((line: string) => line.startsWith('+') && !line.startsWith('+++'))).toHaveLength(0);
        expect(diff.split('\n').filter((line: string) => line.startsWith('-') && !line.startsWith('---'))).toHaveLength(0);
      });

      it('handles empty content', () => {
        const diff = createUnifiedDiff('', '');
        expect(diff).toContain('--- file');
        expect(diff).toContain('+++ file');
      });

      it('handles default filename parameter', () => {
        const diff = createUnifiedDiff('old', 'new');
        expect(diff).toContain('--- file');
        expect(diff).toContain('+++ file');
      });

      it('handles custom filename', () => {
        const diff = createUnifiedDiff('old', 'new', 'custom.txt');
        expect(diff).toContain('--- custom.txt');
        expect(diff).toContain('+++ custom.txt');
      });
    });
  });

  describe('Security & Validation Functions', () => {
    describe('validatePath', () => {
      // Use Windows-compatible paths for testing
      const allowedDirs = process.platform === 'win32' ? ['C:\\Users\\test', 'C:\\temp'] : ['/home/user', '/tmp'];

      beforeEach(() => {
        mockFs.realpath.mockImplementation(async (path: any) => path.toString());
      });

      it('validates allowed paths', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\Users\\test\\file.txt' : '/home/user/file.txt';
        const result = await validatePath(testPath);
        expect(result).toBe(testPath);
      });

      it('rejects disallowed paths', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\Windows\\System32\\file.txt' : '/etc/passwd';
        await expect(validatePath(testPath))
          .rejects.toThrow('Access denied - path outside allowed directories');
      });

      it('handles non-existent files by checking parent directory', async () => {
        const newFilePath = process.platform === 'win32' ? 'C:\\Users\\test\\newfile.txt' : '/home/user/newfile.txt';
        const parentPath = process.platform === 'win32' ? 'C:\\Users\\test' : '/home/user';
        
        // Create an error with the ENOENT code that the implementation checks for
        const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError.code = 'ENOENT';
        
        mockFs.realpath
          .mockRejectedValueOnce(enoentError)
          .mockResolvedValueOnce(parentPath);
        
        const result = await validatePath(newFilePath);
        expect(result).toBe(path.resolve(newFilePath));
      });

      it('rejects when parent directory does not exist', async () => {
        const newFilePath = process.platform === 'win32' ? 'C:\\Users\\test\\nonexistent\\newfile.txt' : '/home/user/nonexistent/newfile.txt';
        
        // Create errors with the ENOENT code
        const enoentError1 = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError1.code = 'ENOENT';
        const enoentError2 = new Error('ENOENT') as NodeJS.ErrnoException;
        enoentError2.code = 'ENOENT';
        
        mockFs.realpath
          .mockRejectedValueOnce(enoentError1)
          .mockRejectedValueOnce(enoentError2);
        
        await expect(validatePath(newFilePath))
          .rejects.toThrow('Parent directory does not exist');
      });
    });
  });

  describe('File Operations', () => {
    describe('getFileStats', () => {
      it('returns file statistics', async () => {
        const mockStats = {
          size: 1024,
          birthtime: new Date('2023-01-01'),
          mtime: new Date('2023-01-02'),
          atime: new Date('2023-01-03'),
          isDirectory: () => false,
          isFile: () => true,
          mode: 0o644
        };
        
        mockFs.stat.mockResolvedValueOnce(mockStats as any);
        
        const result = await getFileStats('/test/file.txt');
        
        expect(result).toEqual({
          size: 1024,
          created: new Date('2023-01-01'),
          modified: new Date('2023-01-02'),
          accessed: new Date('2023-01-03'),
          isDirectory: false,
          isFile: true,
          permissions: '644'
        });
      });

      it('handles directory statistics', async () => {
        const mockStats = {
          size: 4096,
          birthtime: new Date('2023-01-01'),
          mtime: new Date('2023-01-02'),
          atime: new Date('2023-01-03'),
          isDirectory: () => true,
          isFile: () => false,
          mode: 0o755
        };
        
        mockFs.stat.mockResolvedValueOnce(mockStats as any);
        
        const result = await getFileStats('/test/dir');
        
        expect(result.isDirectory).toBe(true);
        expect(result.isFile).toBe(false);
        expect(result.permissions).toBe('755');
      });
    });

    describe('readFileContent', () => {
      it('reads file with default encoding', async () => {
        mockFs.readFile.mockResolvedValueOnce('file content');
        
        const result = await readFileContent('/test/file.txt');
        
        expect(result).toBe('file content');
        expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt', 'utf-8');
      });

      it('reads file with custom encoding', async () => {
        mockFs.readFile.mockResolvedValueOnce('file content');
        
        const result = await readFileContent('/test/file.txt', 'ascii');
        
        expect(result).toBe('file content');
        expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt', 'ascii');
      });
    });

    // Note: writeFileContent function is not exported from lib.ts
    // describe('writeFileContent', () => {
    //   it('writes file content', async () => {
    //     mockFs.writeFile.mockResolvedValueOnce(undefined);
    //     
    //     await writeFileContent('/test/file.txt', 'new content');
    //     
    //     expect(mockFs.writeFile).toHaveBeenCalledWith('/test/file.txt', 'new content', { encoding: "utf-8", flag: 'wx' });
    //   });
    // });

  });

  describe('Search & Filtering Functions', () => {
    describe('searchFilesWithValidation', () => {
      beforeEach(() => {
        mockFs.realpath.mockImplementation(async (path: any) => path.toString());
        // Ensure plocate is not available by default for non-plocate tests
        // by mocking access to fail for plocate database check
        mockFs.access.mockImplementation(async (path: string) => {
          // Fail if it's checking for plocate database
          if (path.includes('plocate.db') || path.includes('/var/lib/plocate')) {
            throw new Error('ENOENT');
          }
          // Allow other access checks
          return undefined;
        });
      });


      it('excludes files matching exclude patterns', async () => {
        const mockEntries = [
          { name: 'test.txt', isDirectory: () => false },
          { name: 'test.log', isDirectory: () => false },
          { name: 'node_modules', isDirectory: () => true }
        ];
        
        mockFs.readdir.mockResolvedValueOnce(mockEntries as any);
        
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\dir' : '/allowed/dir';
        const allowedDirs = process.platform === 'win32' ? ['C:\\allowed'] : ['/allowed'];
        
        // Mock realpath to return the same path for validation to pass
        mockFs.realpath.mockImplementation(async (inputPath: any) => {
          const pathStr = inputPath.toString();
          // Return the path as-is for validation
          return pathStr;
        });
        
        const result = await searchFilesWithValidation(
          testDir,
          '*test*',
          allowedDirs,
          { excludePatterns: ['*.log', 'node_modules'] }
        );
        
        const expectedResult = process.platform === 'win32' ? 'C:\\allowed\\dir\\test.txt' : '/allowed/dir/test.txt';
        expect(result).toEqual([expectedResult]);
      });

      it('handles validation errors during search', async () => {
        const mockEntries = [
          { name: 'test.txt', isDirectory: () => false },
          { name: 'invalid_file.txt', isDirectory: () => false }
        ];
        
        mockFs.readdir.mockResolvedValueOnce(mockEntries as any);
        
        // Mock validatePath to throw error for invalid_file.txt
        mockFs.realpath.mockImplementation(async (path: any) => {
          if (path.toString().includes('invalid_file.txt')) {
            throw new Error('Access denied');
          }
          return path.toString();
        });
        
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\dir' : '/allowed/dir';
        const allowedDirs = process.platform === 'win32' ? ['C:\\allowed'] : ['/allowed'];
        
        const result = await searchFilesWithValidation(
          testDir,
          '*test*',
          allowedDirs,
          {}
        );
        
        // Should only return the valid file, skipping the invalid one
        const expectedResult = process.platform === 'win32' ? 'C:\\allowed\\dir\\test.txt' : '/allowed/dir/test.txt';
        expect(result).toEqual([expectedResult]);
      });

      it('handles complex exclude patterns with wildcards', async () => {
        const mockEntries = [
          { name: 'test.txt', isDirectory: () => false },
          { name: 'test.backup', isDirectory: () => false },
          { name: 'important_test.js', isDirectory: () => false }
        ];
        
        mockFs.readdir.mockResolvedValueOnce(mockEntries as any);
        
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\dir' : '/allowed/dir';
        const allowedDirs = process.platform === 'win32' ? ['C:\\allowed'] : ['/allowed'];
        
        const result = await searchFilesWithValidation(
          testDir,
          '*test*',
          allowedDirs,
          { excludePatterns: ['*.backup'] }
        );
        
        const expectedResults = process.platform === 'win32' ? [
          'C:\\allowed\\dir\\test.txt',
          'C:\\allowed\\dir\\important_test.js'
        ] : [
          '/allowed/dir/test.txt',
          '/allowed/dir/important_test.js'
        ];
        expect(result).toEqual(expectedResults);
      });

      describe('plocate integration', () => {
        const originalEnv = process.env.PLOCATE_DB;
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\dir' : '/allowed/dir';
        const allowedDirs = process.platform === 'win32' ? ['C:\\allowed'] : ['/allowed'];
        const plocateDb = '/var/lib/plocate/plocate.db';

        beforeEach(() => {
          // Reset environment
          delete process.env.PLOCATE_DB;
          vi.clearAllMocks();
          mockFs.realpath.mockImplementation(async (path: any) => path.toString());
        });

        afterEach(() => {
          // Restore original environment
          if (originalEnv) {
            process.env.PLOCATE_DB = originalEnv;
          } else {
            delete process.env.PLOCATE_DB;
          }
        });

        it('uses plocate when available and database exists', async () => {
          // Mock plocate as available
          process.env.PLOCATE_DB = plocateDb;
          // First call: check database exists, second call: check plocate version
          mockFs.access.mockResolvedValueOnce(undefined); // Database exists
          mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
            if (cmd === 'plocate' && args && args.includes('--version')) {
              // plocate --version check succeeds
              callback(null, { stdout: 'plocate 1.1.18\n', stderr: '' });
            } else if (cmd === 'plocate' && args && args.includes('*.js')) {
              // plocate search returns results
              const results = process.platform === 'win32' 
                ? 'C:\\allowed\\dir\\file1.js\nC:\\allowed\\dir\\subdir\\file2.js\n'
                : '/allowed/dir/file1.js\n/allowed/dir/subdir/file2.js\n';
              callback(null, { stdout: results, stderr: '' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          });
          // Mock realpath for validation
          mockFs.realpath.mockImplementation(async (path: any) => path.toString());

          const result = await searchFilesWithValidation(
            testDir,
            '*.js',
            allowedDirs,
            {}
          );

          // Should use plocate and return filtered results
          expect(mockExecFile).toHaveBeenCalledWith(
            'plocate',
            expect.arrayContaining(['--database', plocateDb]),
            expect.any(Object),
            expect.any(Function)
          );
          
          const expectedResults = process.platform === 'win32' ? [
            'C:\\allowed\\dir\\file1.js',
            'C:\\allowed\\dir\\subdir\\file2.js'
          ] : [
            '/allowed/dir/file1.js',
            '/allowed/dir/subdir/file2.js'
          ];
          expect(result).toEqual(expectedResults);
        });

        it('removes ** from patterns for plocate (plocate is recursive by default)', async () => {
          process.env.PLOCATE_DB = plocateDb;
          mockFs.access.mockResolvedValueOnce(undefined);
          mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
            if (cmd === 'plocate' && args && args.includes('--version')) {
              callback(null, { stdout: 'plocate 1.1.18\n', stderr: '' });
            } else if (cmd === 'plocate' && args) {
              // Check that ** was removed from the pattern
              const patternArg = args[args.length - 1];
              expect(patternArg).not.toContain('**');
              expect(patternArg).toBe('*.js'); // **/*.js should become *.js
              
              const results = process.platform === 'win32'
                ? 'C:\\allowed\\dir\\file.js\n'
                : '/allowed/dir/file.js\n';
              callback(null, { stdout: results, stderr: '' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          });

          await searchFilesWithValidation(
            testDir,
            '**/*.js', // Pattern with **
            allowedDirs,
            {}
          );

          // Verify plocate was called with pattern without **
          expect(mockExecFile).toHaveBeenCalledWith(
            'plocate',
            expect.arrayContaining([expect.not.stringContaining('**')]),
            expect.any(Object),
            expect.any(Function)
          );
        });

        it('filters plocate results by rootPath', async () => {
          process.env.PLOCATE_DB = plocateDb;
          mockFs.access.mockResolvedValueOnce(undefined);
          mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
            if (cmd === 'plocate' && args && args.includes('--version')) {
              callback(null, { stdout: 'plocate 1.1.18\n', stderr: '' });
            } else if (cmd === 'plocate') {
              // Return results from multiple directories, but only some are in rootPath
              const results = process.platform === 'win32'
                ? 'C:\\allowed\\dir\\file1.js\nC:\\allowed\\other\\file2.js\nC:\\allowed\\dir\\subdir\\file3.js\n'
                : '/allowed/dir/file1.js\n/allowed/other/file2.js\n/allowed/dir/subdir/file3.js\n';
              callback(null, { stdout: results, stderr: '' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          });
          // Mock realpath for validation
          mockFs.realpath.mockImplementation(async (path: any) => path.toString());

          const result = await searchFilesWithValidation(
            testDir,
            '*.js',
            allowedDirs,
            {}
          );

          // Should only return files within testDir
          const expectedResults = process.platform === 'win32' ? [
            'C:\\allowed\\dir\\file1.js',
            'C:\\allowed\\dir\\subdir\\file3.js'
          ] : [
            '/allowed/dir/file1.js',
            '/allowed/dir/subdir/file3.js'
          ];
          expect(result).toEqual(expectedResults);
        });

        it('applies excludePatterns to plocate results', async () => {
          process.env.PLOCATE_DB = plocateDb;
          mockFs.access.mockResolvedValueOnce(undefined);
          mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
            if (cmd === 'plocate' && args && args.includes('--version')) {
              callback(null, { stdout: 'plocate 1.1.18\n', stderr: '' });
            } else if (cmd === 'plocate') {
              const results = process.platform === 'win32'
                ? 'C:\\allowed\\dir\\file1.js\nC:\\allowed\\dir\\file1.test.js\nC:\\allowed\\dir\\file2.js\n'
                : '/allowed/dir/file1.js\n/allowed/dir/file1.test.js\n/allowed/dir/file2.js\n';
              callback(null, { stdout: results, stderr: '' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          });
          // Mock realpath for validation
          mockFs.realpath.mockImplementation(async (path: any) => path.toString());

          const result = await searchFilesWithValidation(
            testDir,
            '*.js',
            allowedDirs,
            { excludePatterns: ['*.test.js'] }
          );

          // Should exclude files matching excludePatterns
          const expectedResults = process.platform === 'win32' ? [
            'C:\\allowed\\dir\\file1.js',
            'C:\\allowed\\dir\\file2.js'
          ] : [
            '/allowed/dir/file1.js',
            '/allowed/dir/file2.js'
          ];
          expect(result).toEqual(expectedResults);
        });

        it('falls back to recursive search when plocate database does not exist', async () => {
          // Don't set PLOCATE_DB, or mock access to fail
          mockFs.access.mockRejectedValueOnce(new Error('ENOENT')); // Database doesn't exist
          
          const mockEntries = [
            { name: 'file.js', isDirectory: () => false }
          ];
          mockFs.readdir.mockResolvedValueOnce(mockEntries as any);

          const result = await searchFilesWithValidation(
            testDir,
            '*.js',
            allowedDirs,
            {}
          );

          // Should use recursive search (readdir) instead of plocate
          expect(mockFs.readdir).toHaveBeenCalled();
          const expectedResult = process.platform === 'win32' 
            ? 'C:\\allowed\\dir\\file.js' 
            : '/allowed/dir/file.js';
          expect(result).toEqual([expectedResult]);
        });

        it('falls back to recursive search when plocate command fails', async () => {
          process.env.PLOCATE_DB = plocateDb;
          mockFs.access.mockResolvedValueOnce(undefined);
          mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
            if (cmd === 'plocate' && args && args.includes('--version')) {
              // plocate --version check succeeds
              callback(null, { stdout: 'plocate 1.1.18\n', stderr: '' });
            } else if (cmd === 'plocate') {
              // plocate search fails
              const error = new Error('plocate failed') as any;
              error.code = 2;
              callback(error, { stdout: '', stderr: 'plocate error' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          });

          const mockEntries = [
            { name: 'file.js', isDirectory: () => false }
          ];
          mockFs.readdir.mockResolvedValueOnce(mockEntries as any);

          const result = await searchFilesWithValidation(
            testDir,
            '*.js',
            allowedDirs,
            {}
          );

          // Should fall back to recursive search
          expect(mockFs.readdir).toHaveBeenCalled();
          const expectedResult = process.platform === 'win32' 
            ? 'C:\\allowed\\dir\\file.js' 
            : '/allowed/dir/file.js';
          expect(result).toEqual([expectedResult]);
        });

        it('falls back to recursive search when pattern conversion returns null', async () => {
          process.env.PLOCATE_DB = plocateDb;
          // Mock access for plocate database check
          // isPlocateAvailable calls fs.access(plocateDb) to check if database exists
          // Then it calls execFile for plocate --version
          let accessCallCount = 0;
          mockFs.access.mockImplementation(async (path: string) => {
            accessCallCount++;
            // First call should be for plocate database
            if (path === plocateDb || path.includes('plocate.db')) {
              return undefined; // Database exists
            }
            // For other paths (like validatePath), allow access
            return undefined;
          });
          mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
            if (cmd === 'plocate' && args && args.includes('--version')) {
              // This is called by isPlocateAvailable
              callback(null, { stdout: 'plocate 1.1.18\n', stderr: '' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          });

          const mockEntries = [
            { name: 'file.js', isDirectory: () => false }
          ];
          // Mock readdir to return entries - this should be called when falling back to recursive search
          // Use mockResolvedValue instead of mockResolvedValueOnce to handle potential multiple calls
          mockFs.readdir.mockResolvedValue(mockEntries as any);
          // Mock realpath for validation - called by validatePath
          mockFs.realpath.mockImplementation(async (path: any) => {
            const pathStr = path.toString();
            // Return the path as-is for validation to pass
            return pathStr;
          });

          // Use a pattern that results in null after conversion (empty after removing **)
          // When pattern is '**', preparePatternForPlocate returns null because after removing **, it's empty
          // This should cause the code to skip plocate and use recursive search
          const result = await searchFilesWithValidation(
            testDir,
            '**', // This becomes empty after removing **, so preparePatternForPlocate returns null
            allowedDirs,
            {}
          );

          // Should fall back to recursive search since plocatePattern is null
          // Pattern '**' matches everything, so we should get the file
          // Note: isPlocateAvailable will return true, but preparePatternForPlocate('**') returns null
          // so we should skip plocate and use recursive search
          expect(mockFs.readdir).toHaveBeenCalled();
          const expectedResult = process.platform === 'win32' 
            ? 'C:\\allowed\\dir\\file.js' 
            : '/allowed/dir/file.js';
          // Pattern '**' should match everything, including files in subdirectories
          expect(result.length).toBeGreaterThan(0);
          expect(result).toContain(expectedResult);
        });

        it('handles plocate returning no matches (exit code 1)', async () => {
          process.env.PLOCATE_DB = plocateDb;
          mockFs.access.mockResolvedValueOnce(undefined);
          mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
            if (cmd === 'plocate' && args && args.includes('--version')) {
              callback(null, { stdout: 'plocate 1.1.18\n', stderr: '' });
            } else if (cmd === 'plocate') {
              // plocate returns exit code 1 for no matches (this is normal)
              const error = new Error('No matches') as any;
              error.code = 1;
              callback(error, { stdout: '', stderr: '' });
            } else {
              callback(null, { stdout: '', stderr: '' });
            }
          });
          // Mock realpath for validation (won't be called but good to have)
          mockFs.realpath.mockImplementation(async (path: any) => path.toString());

          const result = await searchFilesWithValidation(
            testDir,
            '*.nonexistent',
            allowedDirs,
            {}
          );

          // Should return empty array, not fall back (exit code 1 is expected for no matches)
          expect(result).toEqual([]);
          // Should not have called readdir (didn't fall back)
          expect(mockFs.readdir).not.toHaveBeenCalled();
        });
      });
    });

    describe('searchFileContents', () => {
      beforeEach(() => {
        mockFs.realpath.mockImplementation(async (path: any) => path.toString());
        mockFs.stat.mockResolvedValue({
          isFile: () => true,
          isDirectory: () => false
        });
        // Reset execFile mock
        vi.clearAllMocks();
      });

      it('finds matches in file content', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:1:Hello world\n${testPath}:3:Hello again\n`;

        // Mock ripgrep execution
        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'Hello'
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('File: ' + testPath);
        expect(result[0]).toContain('Line 1: Hello world');
        expect(result[0]).toContain('Line 3: Hello again');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['Hello', testPath]), expect.any(Object), expect.any(Function));
      });

      it('handles case-insensitive searches', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:1:Hello World\n${testPath}:3:hello again\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'HELLO',
          ignoreCase: true
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('Line 1: Hello World');
        expect(result[0]).toContain('Line 3: hello again');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--ignore-case', 'HELLO']), expect.any(Object), expect.any(Function));
      });

      it('respects maxResults limit', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:1:test\n${testPath}:2:test\n${testPath}:3:test\n${testPath}:4:test\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'test',
          maxResults: 2
        });

        expect(result).toHaveLength(1);
        const resultText = result[0];
        const lineCount = (resultText.match(/Line \d+:/g) || []).length;
        expect(lineCount).toBe(2);
      });

      it('includes context lines when requested', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        // ripgrep with context outputs all lines with line numbers
        const ripgrepOutput = `${testPath}:1:before1\n${testPath}:2:before2\n${testPath}:3:target line\n${testPath}:4:after1\n${testPath}:5:after2\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'target',
          context: 2
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('target line');
        expect(result[0]).toContain('Line 1: before1');
        expect(result[0]).toContain('Line 2: before2');
        expect(result[0]).toContain('Line 4: after1');
        expect(result[0]).toContain('Line 5: after2');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--context', '2']), expect.any(Object), expect.any(Function));
      });

      it('handles directory search recursively', async () => {
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\testdir' : '/allowed/testdir';
        const testFile = process.platform === 'win32' ? 'C:\\allowed\\testdir\\test.txt' : '/allowed/testdir/test.txt';
        const ripgrepOutput = `${testFile}:1:Hello world\n`;

        // Mock directory stats
        mockFs.stat.mockResolvedValueOnce({
          isFile: () => false,
          isDirectory: () => true
        });

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testDir,
          pattern: 'Hello',
          recursive: true
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('File: ' + testFile);
        expect(result[0]).toContain('Hello world');
      });

      it('filters files by pattern', async () => {
        const testDir = process.platform === 'win32' ? 'C:\\allowed\\testdir' : '/allowed/testdir';
        const testFile = process.platform === 'win32' ? 'C:\\allowed\\testdir\\test.txt' : '/allowed/testdir/test.txt';
        const ripgrepOutput = `${testFile}:1:test content\n`;

        // Mock directory stats
        mockFs.stat.mockResolvedValueOnce({
          isFile: () => false,
          isDirectory: () => true
        });

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testDir,
          pattern: 'test',
          filePattern: '*.txt'
        });

        expect(result).toHaveLength(1);
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--glob', '*.txt']), expect.any(Object), expect.any(Function));
      });

      it('returns empty array when no matches found', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';

        // ripgrep returns exit code 1 when no matches found
        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          const error = new Error('No matches found') as any;
          error.code = 1;
          callback(error, { stdout: '', stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'nonexistent'
        });

        expect(result).toHaveLength(0);
      });

      it('handles invalid regex pattern from ripgrep', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';

        // ripgrep will handle invalid regex and return an error
        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          const error = new Error('regex parse error') as any;
          error.code = 2;
          callback(error, { stdout: '', stderr: 'regex parse error' });
        });

        await expect(searchFileContents({
          searchPath: testPath,
          pattern: '['  // Invalid regex
        })).rejects.toThrow('ripgrep execution failed');
      });

      it('handles ripgrep execution errors gracefully', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';

        // ripgrep may fail for permission errors, but we handle it
        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          const error = new Error('Permission denied') as any;
          error.code = 2;
          callback(error, { stdout: '', stderr: 'Permission denied' });
        });

        await expect(searchFileContents({
          searchPath: testPath,
          pattern: 'test'
        })).rejects.toThrow('ripgrep execution failed');
      });

      it('handles invertMatch option', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:2:This is a test\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'world',
          invertMatch: true
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('Line 2: This is a test');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--invert-match']), expect.any(Object), expect.any(Function));
      });

      it('handles fixedStrings option', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:2:file.*\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: '.*',
          fixedStrings: true
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('Line 2: file.*');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--fixed-strings']), expect.any(Object), expect.any(Function));
      });

      it('handles separate beforeContext and afterContext', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:2:line2\n${testPath}:3:target line\n${testPath}:4:line4\n${testPath}:5:line5\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'target',
          beforeContext: 1,
          afterContext: 2
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('target line');
        expect(result[0]).toContain('Line 2: line2');
        expect(result[0]).toContain('Line 4: line4');
        expect(result[0]).toContain('Line 5: line5');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--before-context', '1', '--after-context', '2']), expect.any(Object), expect.any(Function));
      });

      it('handles context parameter overriding beforeContext and afterContext', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:2:line2\n${testPath}:3:target line\n${testPath}:4:line4\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'target',
          context: 1,
          beforeContext: 2, // Should be overridden by context
          afterContext: 2   // Should be overridden by context
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('target line');
        expect(result[0]).toContain('Line 2: line2');
        expect(result[0]).toContain('Line 4: line4');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--context', '1']), expect.any(Object), expect.any(Function));
        // Should not include separate before/after context when context is provided
        expect(mockExecFile).not.toHaveBeenCalledWith('rg', expect.arrayContaining(['--before-context']), expect.any(Object), expect.any(Function));
      });

      it('combines fixedStrings with ignoreCase', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:2:hello.*\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'HELLO.*',
          fixedStrings: true,
          ignoreCase: true
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('Line 2: hello.*');
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--fixed-strings', '--ignore-case']), expect.any(Object), expect.any(Function));
      });

      it('handles excludePatterns', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\testdir' : '/allowed/testdir';
        const testFile = process.platform === 'win32' ? 'C:\\allowed\\testdir\\test.txt' : '/allowed/testdir/test.txt';
        const ripgrepOutput = `${testFile}:1:test content\n`;

        mockFs.stat.mockResolvedValueOnce({
          isFile: () => false,
          isDirectory: () => true
        });

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'test',
          excludePatterns: ['*.log', 'node_modules']
        });

        expect(result).toHaveLength(1);
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--glob', '!*.log', '--glob', '!node_modules']), expect.any(Object), expect.any(Function));
      });

      it('handles non-recursive search', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\testdir' : '/allowed/testdir';
        const ripgrepOutput = '';

        mockFs.stat.mockResolvedValueOnce({
          isFile: () => false,
          isDirectory: () => true
        });

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'test',
          recursive: false
        });

        expect(result).toHaveLength(0);
        expect(mockExecFile).toHaveBeenCalledWith('rg', expect.arrayContaining(['--maxdepth', '1']), expect.any(Object), expect.any(Function));
      });

      it('handles ripgrep not installed error', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          const error = new Error('rg: command not found') as any;
          error.code = 'ENOENT';
          callback(error, { stdout: '', stderr: '' });
        });

        await expect(searchFileContents({
          searchPath: testPath,
          pattern: 'test'
        })).rejects.toThrow('ripgrep (rg) is not installed');
      });

      it('handles includeLineNumbers false', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\test.txt' : '/allowed/test.txt';
        const ripgrepOutput = `${testPath}:1:Hello world\n`;

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'Hello',
          includeLineNumbers: false
        });

        expect(result).toHaveLength(1);
        expect(result[0]).toContain('Hello world');
        expect(result[0]).not.toContain('Line 1:');
        // ripgrep still outputs line numbers, but we format them out
      });

      it('handles multiple files in results', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\testdir' : '/allowed/testdir';
        const file1 = process.platform === 'win32' ? 'C:\\allowed\\testdir\\file1.txt' : '/allowed/testdir/file1.txt';
        const file2 = process.platform === 'win32' ? 'C:\\allowed\\testdir\\file2.txt' : '/allowed/testdir/file2.txt';
        const ripgrepOutput = `${file1}:1:test content\n${file2}:1:test content\n`;

        mockFs.stat.mockResolvedValueOnce({
          isFile: () => false,
          isDirectory: () => true
        });

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'test'
        });

        expect(result).toHaveLength(2);
        expect(result[0]).toContain('File: ' + file1);
        expect(result[1]).toContain('File: ' + file2);
      });

      it('handles separator lines in ripgrep output', async () => {
        const testPath = process.platform === 'win32' ? 'C:\\allowed\\testdir' : '/allowed/testdir';
        const file1 = process.platform === 'win32' ? 'C:\\allowed\\testdir\\file1.txt' : '/allowed/testdir/file1.txt';
        const file2 = process.platform === 'win32' ? 'C:\\allowed\\testdir\\file2.txt' : '/allowed/testdir/file2.txt';
        // ripgrep with context may output separator lines
        const ripgrepOutput = `${file1}:1:test\n---\n${file2}:1:test\n`;

        mockFs.stat.mockResolvedValueOnce({
          isFile: () => false,
          isDirectory: () => true
        });

        mockExecFile.mockImplementation((cmd: string, args: string[], options: any, callback: any) => {
          callback(null, { stdout: ripgrepOutput, stderr: '' });
        });

        const result = await searchFileContents({
          searchPath: testPath,
          pattern: 'test',
          context: 1
        });

        expect(result.length).toBeGreaterThan(0);
        // Separator lines should be skipped
      });
    });
  });

  describe('File Editing Functions', () => {
    // Note: applyFileEdits function is not exported from lib.ts
    // All applyFileEdits tests are commented out below
    /*
    describe('applyFileEdits', () => {
      beforeEach(() => {
        mockFs.readFile.mockResolvedValue('line1\nline2\nline3\n');
        mockFs.writeFile.mockResolvedValue(undefined);
      });

      it('applies simple text replacement', async () => {
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        const result = await applyFileEdits('/test/file.txt', edits, false);
        
        expect(result).toContain('modified line2');
        // Should write to temporary file then rename
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          'line1\nmodified line2\nline3\n',
          'utf-8'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });

      it('handles dry run mode', async () => {
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        const result = await applyFileEdits('/test/file.txt', edits, true);
        
        expect(result).toContain('modified line2');
        expect(mockFs.writeFile).not.toHaveBeenCalled();
      });

      it('applies multiple edits sequentially', async () => {
        const edits = [
          { oldText: 'line1', newText: 'first line' },
          { oldText: 'line3', newText: 'third line' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          'first line\nline2\nthird line\n',
          'utf-8'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });

      it('handles whitespace-flexible matching', async () => {
        mockFs.readFile.mockResolvedValue('  line1\n    line2\n  line3\n');
        
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '  line1\n    modified line2\n  line3\n',
          'utf-8'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });

      it('throws error for non-matching edits', async () => {
        const edits = [
          { oldText: 'nonexistent line', newText: 'replacement' }
        ];
        
        await expect(applyFileEdits('/test/file.txt', edits, false))
          .rejects.toThrow('Could not find exact match for edit');
      });

      it('handles complex multi-line edits with indentation', async () => {
        mockFs.readFile.mockResolvedValue('function test() {\n  console.log("hello");\n  return true;\n}');
        
        const edits = [
          { 
            oldText: '  console.log("hello");\n  return true;', 
            newText: '  console.log("world");\n  console.log("test");\n  return false;' 
          }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.js', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          'function test() {\n  console.log("world");\n  console.log("test");\n  return false;\n}',
          'utf-8'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          '/test/file.js'
        );
      });

      it('handles edits with different indentation patterns', async () => {
        mockFs.readFile.mockResolvedValue('    if (condition) {\n        doSomething();\n    }');
        
        const edits = [
          { 
            oldText: 'doSomething();', 
            newText: 'doSomethingElse();\n        doAnotherThing();' 
          }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.js', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          '    if (condition) {\n        doSomethingElse();\n        doAnotherThing();\n    }',
          'utf-8'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.js\.[a-f0-9]+\.tmp$/),
          '/test/file.js'
        );
      });

      it('handles CRLF line endings in file content', async () => {
        mockFs.readFile.mockResolvedValue('line1\r\nline2\r\nline3\r\n');
        
        const edits = [
          { oldText: 'line2', newText: 'modified line2' }
        ];
        
        mockFs.rename.mockResolvedValueOnce(undefined);
        
        await applyFileEdits('/test/file.txt', edits, false);
        
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          'line1\nmodified line2\nline3\n',
          'utf-8'
        );
        expect(mockFs.rename).toHaveBeenCalledWith(
          expect.stringMatching(/\/test\/file\.txt\.[a-f0-9]+\.tmp$/),
          '/test/file.txt'
        );
      });
    });
    */

    describe('tailFile', () => {
      it('handles empty files', async () => {
        mockFs.stat.mockResolvedValue({ size: 0 } as any);
        
        const result = await tailFile('/test/empty.txt', 5);
        
        expect(result).toBe('');
        expect(mockFs.open).not.toHaveBeenCalled();
      });

      it('calls stat to check file size', async () => {
        mockFs.stat.mockResolvedValue({ size: 100 } as any);
        
        // Mock file handle with proper typing
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        mockFileHandle.read.mockResolvedValue({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        await tailFile('/test/file.txt', 2);
        
        expect(mockFs.stat).toHaveBeenCalledWith('/test/file.txt');
        expect(mockFs.open).toHaveBeenCalledWith('/test/file.txt', 'r');
      });

      it('handles files with content and returns last lines', async () => {
        mockFs.stat.mockResolvedValue({ size: 50 } as any);
        
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading file content in chunks
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 20, buffer: Buffer.from('line3\nline4\nline5\n') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await tailFile('/test/file.txt', 2);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });

      it('handles read errors gracefully', async () => {
        mockFs.stat.mockResolvedValue({ size: 100 } as any);
        
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        mockFileHandle.read.mockResolvedValue({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        await tailFile('/test/file.txt', 5);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });
    });

    describe('headFile', () => {
      it('opens file for reading', async () => {
        // Mock file handle with proper typing
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        mockFileHandle.read.mockResolvedValue({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        await headFile('/test/file.txt', 2);
        
        expect(mockFs.open).toHaveBeenCalledWith('/test/file.txt', 'r');
      });

      it('handles files with content and returns first lines', async () => {
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading file content with newlines
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 20, buffer: Buffer.from('line1\nline2\nline3\n') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await headFile('/test/file.txt', 2);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });

      it('handles files with leftover content', async () => {
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading file content without final newline
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 15, buffer: Buffer.from('line1\nline2\nend') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await headFile('/test/file.txt', 5);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });

      it('handles reaching requested line count', async () => {
        const mockFileHandle = {
          read: vi.fn(),
          close: vi.fn()
        } as any;
        
        // Simulate reading exactly the requested number of lines
        mockFileHandle.read
          .mockResolvedValueOnce({ bytesRead: 12, buffer: Buffer.from('line1\nline2\n') })
          .mockResolvedValueOnce({ bytesRead: 0 });
        mockFileHandle.close.mockResolvedValue(undefined);
        
        mockFs.open.mockResolvedValue(mockFileHandle);
        
        const result = await headFile('/test/file.txt', 2);
        
        expect(mockFileHandle.close).toHaveBeenCalled();
      });
    });
  });

  describe('Project Intro Extraction', () => {
    describe('extractProjectIntro', () => {
      const testProjectPath = process.platform === 'win32' ? 'C:\\Users\\test\\project' : '/home/user/project';

      beforeEach(() => {
        // Mock realpath to return the same path, ensuring it's within allowed directories
        // The path /home/user/project is within /home/user which is in allowed directories
        mockFs.realpath.mockImplementation(async (inputPath: any) => {
          const pathStr = inputPath.toString();
          // Return the path as-is, which should be within allowed directories
          return pathStr;
        });
      });

      it('extracts README.md when it exists', async () => {
        const readmeContent = '# My Project\n\nThis is a test project.';
        const readmePath = path.join(testProjectPath, 'README.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md (doesn't exist, will throw)
        mockFs.realpath.mockRejectedValueOnce(new Error('ENOENT'));
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);

        const result = await extractProjectIntro(testProjectPath);

        expect(result.filesFound).toContain('README.md');
        expect(result.content).toContain('# README.md');
        expect(result.content).toContain('This is a test project');
        expect(result.filesChecked).toContain('README.md');
        expect(result.filesChecked).toContain('CLAUDE.md');
      });

      it('extracts CLAUDE.md when it exists', async () => {
        const claudeContent = '# Project Overview\n\nThis is Claude-specific documentation.';
        const claudePath = path.join(testProjectPath, 'CLAUDE.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md
        mockFs.realpath.mockResolvedValueOnce(claudePath);
        // fs.stat for CLAUDE.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for CLAUDE.md
        mockFs.readFile.mockResolvedValueOnce(claudeContent);
        // validatePath for README.md (doesn't exist)
        mockFs.realpath.mockRejectedValueOnce(new Error('ENOENT'));

        const result = await extractProjectIntro(testProjectPath);

        expect(result.filesFound).toContain('CLAUDE.md');
        expect(result.content).toContain('# CLAUDE.md');
        expect(result.content).toContain('This is Claude-specific documentation');
      });

      it('combines CLAUDE.md and README.md when both exist', async () => {
        const claudeContent = '# Project Overview\n\nClaude-specific info.';
        const readmeContent = '# My Project\n\nGeneral project info.';
        const claudePath = path.join(testProjectPath, 'CLAUDE.md');
        const readmePath = path.join(testProjectPath, 'README.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md
        mockFs.realpath.mockResolvedValueOnce(claudePath);
        // fs.stat for CLAUDE.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for CLAUDE.md
        mockFs.readFile.mockResolvedValueOnce(claudeContent);
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);

        const result = await extractProjectIntro(testProjectPath);

        expect(result.filesFound).toContain('CLAUDE.md');
        expect(result.filesFound).toContain('README.md');
        expect(result.content).toContain('# CLAUDE.md');
        expect(result.content).toContain('Claude-specific info');
        expect(result.content).toContain('# README.md');
        expect(result.content).toContain('General project info');
        // CLAUDE.md should come before README.md
        const claudeIndex = result.content.indexOf('# CLAUDE.md');
        const readmeIndex = result.content.indexOf('# README.md');
        expect(claudeIndex).toBeLessThan(readmeIndex);
      });

      it('includes additional files when includeAdditionalFiles is true', async () => {
        const readmeContent = '# My Project';
        const contributingContent = '# Contributing\n\nHow to contribute.';
        const readmePath = path.join(testProjectPath, 'README.md');
        const contributingPath = path.join(testProjectPath, 'CONTRIBUTING.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md (doesn't exist)
        mockFs.realpath.mockRejectedValueOnce(new Error('ENOENT'));
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);
        // validatePath for CONTRIBUTING.md
        mockFs.realpath.mockResolvedValueOnce(contributingPath);
        // fs.stat for CONTRIBUTING.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for CONTRIBUTING.md
        mockFs.readFile.mockResolvedValueOnce(contributingContent);
        // Mock remaining files as not existing (to avoid too many mocks)
        mockFs.realpath.mockRejectedValue(new Error('ENOENT'));

        const result = await extractProjectIntro(testProjectPath, true);

        expect(result.filesFound).toContain('README.md');
        expect(result.filesFound).toContain('CONTRIBUTING.md');
        expect(result.content).toContain('# README.md');
        expect(result.content).toContain('## Additional Documentation');
        expect(result.content).toContain('### CONTRIBUTING.md');
        expect(result.content).toContain('How to contribute');
      });

      it('excludes additional files when includeAdditionalFiles is false', async () => {
        const readmeContent = '# My Project';
        const readmePath = path.join(testProjectPath, 'README.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md (doesn't exist)
        mockFs.realpath.mockRejectedValueOnce(new Error('ENOENT'));
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);

        const result = await extractProjectIntro(testProjectPath, false);

        expect(result.filesFound).toContain('README.md');
        expect(result.filesFound).not.toContain('CONTRIBUTING.md');
        expect(result.content).toContain('# README.md');
        expect(result.content).not.toContain('## Additional Documentation');
        expect(result.content).not.toContain('CONTRIBUTING.md');
      });

      it('returns empty result when no files are found', async () => {
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // All files don't exist - validatePath will throw for each
        mockFs.realpath.mockRejectedValue(new Error('ENOENT'));

        const result = await extractProjectIntro(testProjectPath);

        expect(result.filesFound).toHaveLength(0);
        expect(result.content).toBe('');
        expect(result.filesChecked.length).toBeGreaterThan(0);
      });

      it('handles files in subdirectories', async () => {
        const readmeContent = '# My Project';
        const docsReadmeContent = '# Documentation\n\nDocs content.';
        const readmePath = path.join(testProjectPath, 'README.md');
        const docsReadmePath = path.join(testProjectPath, 'docs/README.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md (doesn't exist)
        mockFs.realpath.mockRejectedValueOnce(new Error('ENOENT'));
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);
        // Mock other files as not existing
        mockFs.realpath
          .mockRejectedValueOnce(new Error('ENOENT')) // CONTRIBUTING.md
          .mockRejectedValueOnce(new Error('ENOENT')) // CHANGELOG.md
          .mockRejectedValueOnce(new Error('ENOENT')) // SECURITY.md
          .mockRejectedValueOnce(new Error('ENOENT')) // CODE_OF_CONDUCT.md
          .mockRejectedValueOnce(new Error('ENOENT')) // ARCHITECTURE.md
          .mockRejectedValueOnce(new Error('ENOENT')) // DESIGN.md
          .mockRejectedValueOnce(new Error('ENOENT')) // OVERVIEW.md
          .mockRejectedValueOnce(new Error('ENOENT')) // INTRO.md
          .mockRejectedValueOnce(new Error('ENOENT')) // ABOUT.md
          .mockRejectedValueOnce(new Error('ENOENT')) // GETTING_STARTED.md
          .mockRejectedValueOnce(new Error('ENOENT')) // QUICKSTART.md
          .mockResolvedValueOnce(docsReadmePath); // docs/README.md
        // fs.stat for docs/README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for docs/README.md
        mockFs.readFile.mockResolvedValueOnce(docsReadmeContent);
        // Mock remaining files
        mockFs.realpath.mockRejectedValue(new Error('ENOENT'));

        const result = await extractProjectIntro(testProjectPath, true);

        expect(result.filesFound).toContain('README.md');
        expect(result.filesFound).toContain('docs/README.md');
        expect(result.content).toContain('# README.md');
        expect(result.content).toContain('## Additional Documentation');
        expect(result.content).toContain('### docs/README.md');
        expect(result.content).toContain('Docs content');
      });

      it('handles validation errors gracefully', async () => {
        // Mock validatePath to throw error for files outside allowed directories
        mockFs.realpath.mockRejectedValueOnce(new Error('Access denied'));

        await expect(extractProjectIntro(testProjectPath))
          .rejects.toThrow('Access denied');
      });

      it('skips directories and only reads files', async () => {
        const readmeContent = '# My Project';
        const readmePath = path.join(testProjectPath, 'README.md');
        const contributingPath = path.join(testProjectPath, 'CONTRIBUTING.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md (doesn't exist)
        mockFs.realpath.mockRejectedValueOnce(new Error('ENOENT'));
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);
        // validatePath for CONTRIBUTING.md
        mockFs.realpath.mockResolvedValueOnce(contributingPath);
        // fs.stat for CONTRIBUTING.md (it's a directory, not a file)
        mockFs.stat.mockResolvedValueOnce({ isFile: () => false, isDirectory: () => true });
        // Mock remaining files
        mockFs.realpath.mockRejectedValue(new Error('ENOENT'));

        const result = await extractProjectIntro(testProjectPath, true);

        expect(result.filesFound).toContain('README.md');
        expect(result.filesFound).not.toContain('CONTRIBUTING.md');
      });

      it('maintains priority file order', async () => {
        const claudeContent = 'Claude content';
        const readmeContent = 'README content';
        const claudePath = path.join(testProjectPath, 'CLAUDE.md');
        const readmePath = path.join(testProjectPath, 'README.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md
        mockFs.realpath.mockResolvedValueOnce(claudePath);
        // fs.stat for CLAUDE.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for CLAUDE.md
        mockFs.readFile.mockResolvedValueOnce(claudeContent);
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);
        // Mock remaining files
        mockFs.realpath.mockRejectedValue(new Error('ENOENT'));

        const result = await extractProjectIntro(testProjectPath);

        // Verify order: CLAUDE.md comes before README.md
        const content = result.content;
        const claudePos = content.indexOf('# CLAUDE.md');
        const readmePos = content.indexOf('# README.md');
        
        expect(claudePos).toBeGreaterThan(-1);
        expect(readmePos).toBeGreaterThan(-1);
        expect(claudePos).toBeLessThan(readmePos);
      });

      it('includes all checked files in filesChecked array', async () => {
        const readmeContent = '# My Project';
        const readmePath = path.join(testProjectPath, 'README.md');
        
        // validatePath for project root
        mockFs.realpath.mockResolvedValueOnce(testProjectPath);
        // validatePath for CLAUDE.md (doesn't exist)
        mockFs.realpath.mockRejectedValueOnce(new Error('ENOENT'));
        // validatePath for README.md
        mockFs.realpath.mockResolvedValueOnce(readmePath);
        // fs.stat for README.md
        mockFs.stat.mockResolvedValueOnce({ isFile: () => true, isDirectory: () => false });
        // readFileContent for README.md
        mockFs.readFile.mockResolvedValueOnce(readmeContent);
        // Mock remaining files as not existing
        mockFs.realpath.mockRejectedValue(new Error('ENOENT'));

        const result = await extractProjectIntro(testProjectPath, true);

        // Should include priority files
        expect(result.filesChecked).toContain('CLAUDE.md');
        expect(result.filesChecked).toContain('README.md');
        // Should include additional files when includeAdditionalFiles is true
        expect(result.filesChecked).toContain('CONTRIBUTING.md');
        expect(result.filesChecked).toContain('CHANGELOG.md');
      });
    });
  });
});

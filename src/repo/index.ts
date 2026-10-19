/**
 * Repository Module Exports
 * Provides repository structure discovery, caching, and context building
 */

export type {
  PackageFileEntry,
  EntryPoint,
  TestEntry,
  DocEntry,
  ArtifactEntry,
  SourceRoot,
  RepositoryMap,
} from './repositoryMap.js';

export {
  discoverPackageFiles,
  discoverEntryPoints,
  discoverSourceRoots,
  discoverTests,
  discoverDocs,
  discoverArtifacts,
  computeFileHash,
  discoverRepositoryMap,
  isRepositoryMapValid,
} from './repositoryMap.js';

export {
  getCachedRepositoryMap,
  invalidateRepositoryCache,
  invalidateAllRepositoryCaches,
  setRepositoryCacheTtl,
  getRepositoryCacheStats,
} from './repositoryMapCache.js';

export type { ContextPack } from './contextPack.js';

export {
  buildFrontendContextPack,
  buildBackendContextPack,
  buildDataContextPack,
  buildTestContextPack,
  buildReviewerContextPack,
  buildDocumentationContextPack,
  buildContextPack,
  buildAllContextPacks,
} from './contextPack.js';

export type {
  RepositoryContextSnapshot,
  RelevantFile,
  SymbolMatch,
  ReadFileResult,
  RepositoryContextServiceOptions,
} from './repositoryContextService.js';

export {
  RepositoryContextService,
  createRepositoryContextService,
} from './repositoryContextService.js';

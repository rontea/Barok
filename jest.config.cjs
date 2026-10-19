/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/jest-db-setup.cjs'],
  roots: ['<rootDir>/src', '<rootDir>/ui'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/cli.ts',
    '!src/mcp/server.ts',
    '!src/__tests__/**',
  ],
  coverageThreshold: {
    global: {
      branches: 4,
      functions: 15,
      lines: 9,
      statements: 9,
    },
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^@barok/core$': '<rootDir>/packages/core/src/index.ts',
    '^@barok/engine$': '<rootDir>/packages/engine/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'esnext',
        target: 'es2020',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: true,
        strict: false,
        jsx: 'react-jsx',
      },
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testTimeout: 10000,
};

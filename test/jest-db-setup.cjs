const { mkdtempSync } = require('fs');
const os = require('os');
const path = require('path');

// Unit tests must never share the application's persistent SQLite database.
// This also protects tests that obtain the store indirectly through a module
// singleton such as getSQLiteAppStore().
const testDatabaseRoot = mkdtempSync(path.join(os.tmpdir(), 'react-engine-jest-db-'));
process.env.REACT_ENGINE_DB_PATH = path.join(testDatabaseRoot, 'react-engine.sqlite');

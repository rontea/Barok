# Monitoring Commands & Scripts

Quick reference for commands to monitor and track changes in the project.

## Git Commands

### View Recent Changes
```bash
# See last 10 commits with summaries
git log --oneline -10

# See detailed changes in last commit
git show

# See all commits in current branch
git log --graph --oneline --all

# See changes between two commits
git diff commit1..commit2
```

### Track Current Changes
```bash
# Show current git status
git status

# Show modified files only
git diff --name-only

# Show detailed changes
git diff

# Show staged changes only
git diff --staged

# Show untracked files
git ls-files --others --exclude-standard
```

### Analyze Changes
```bash
# Lines added/removed by file
git diff --stat

# Blame - see who changed each line
git blame path/to/file.ts

# History of a specific file
git log -p -- path/to/file.ts

# Count commits by author
git shortlog -sn

# See branches and their commits
git branch -v
```

## NPM Commands

### Code Quality
```bash
# Run linter
npm run lint

# Type checking
npm run type-check

# Run tests
npm test

# Test coverage
npm run test:coverage

# Audit dependencies
npm audit
```

## Useful Aliases (Add to .bashrc or PowerShell profile)

### PowerShell (Add to $PROFILE)
```powershell
function git-status-brief { git status --short }
function git-last-changes { git log --oneline -5 }
function git-diff-stat { git diff --stat }
function git-changes-today { git log --since="today" --oneline }
function git-monitor { git status; git log --oneline -3 }
```

### Bash
```bash
alias git-brief='git status --short'
alias git-recent='git log --oneline -5'
alias git-stat='git diff --stat'
alias git-today='git log --since="today" --oneline'
alias git-monitor='git status; echo "---"; git log --oneline -3'
```

## Monitoring Workflow

### Daily Monitoring Check
```bash
# 1. Check current status
git status

# 2. Review recent changes
git log --oneline -5

# 3. Check for uncommitted changes
git diff --stat

# 4. Run tests
npm test

# 5. Check code quality
npm run lint
```

### Before Committing
```bash
# 1. Review changes
git diff

# 2. Run tests
npm test

# 3. Check types
npm run type-check

# 4. Lint code
npm run lint

# 5. Create commit
git add -A
git commit -m "Type: Description"
```

### Generate Change Report
```bash
# See changes in current session
git log --oneline --since="2 hours ago"

# See file changes
git diff HEAD~5 --stat

# See author contributions
git shortlog --summary --numbered
```

## File Monitoring

### Watch for Changes (using Node if available)
```bash
# Install watch tool
npm install -g watch

# Watch src directory
watch -p 'src/**' 'npm run type-check'
```

## Creating Monitoring Script

Create `scripts/monitor-changes.js`:
```javascript
#!/usr/bin/env node
const { execSync } = require('child_process');

console.log('=== Project Change Monitor ===\n');

// Git status
console.log('📊 Git Status:');
console.log(execSync('git status --short').toString());

// Recent commits
console.log('\n📝 Recent Commits:');
console.log(execSync('git log --oneline -5').toString());

// File changes
console.log('\n📁 File Changes:');
console.log(execSync('git diff --stat').toString());

// Tests
console.log('\n🧪 Running Tests...');
try {
  execSync('npm test', { stdio: 'inherit' });
} catch (e) {
  console.log('❌ Tests failed');
}

console.log('\n✅ Monitoring complete');
```

Run with: `node scripts/monitor-changes.js`

## Commit Message Best Practices

### Format
```
[TYPE] Summary (50 chars max)

Detailed explanation (if needed)
- Point 1
- Point 2

Fixes #123
Relates to #456
```

### Types
- `[FEATURE]` - New functionality
- `[FIX]` - Bug fix
- `[REFACTOR]` - Code restructure
- `[TEST]` - Test changes
- `[DOCS]` - Documentation
- `[PERF]` - Performance
- `[SECURITY]` - Security fix
- `[CHORE]` - Maintenance

### Examples
```
[FEATURE] Add response validation utility

- Validates API responses against schema
- Sanitizes tool outputs
- Includes comprehensive tests

Fixes #234
```

```
[FIX] Handle missing API key in pool

- Check pool size before accessing
- Add fallback to default key
- Add regression test

Relates to #199
```

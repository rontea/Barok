# Monitoring Checklist

Use this checklist before committing changes to ensure quality and proper documentation.

## Pre-Commit Verification

### Code Quality
- [ ] Code follows project style guide
- [ ] No console.log() statements left in production code
- [ ] No commented-out code blocks
- [ ] TypeScript strict mode passes (`npm run type-check`)
- [ ] ESLint passes (`npm run lint`)
- [ ] No security vulnerabilities (run: `npm audit`)

### Testing
- [ ] All tests pass locally (`npm test`)
- [ ] New features have corresponding tests
- [ ] Code coverage maintained or improved
- [ ] No breaking changes to existing APIs

### Documentation
- [ ] Code comments updated for complex logic
- [ ] Function/method signatures documented (JSDoc)
- [ ] README updated if user-facing changes
- [ ] Changes logged in UPDATE_LOG.md
- [ ] CHANGELOG.md updated with summary

### Git Workflow
- [ ] Using meaningful commit message
- [ ] Related commits are grouped together
- [ ] No unintended files staged
- [ ] Git diff reviewed before committing
- [ ] Commit message follows format: `[Type] Description`

### Change Categories
- [ ] Feature
- [ ] Fix
- [ ] Refactor
- [ ] Test
- [ ] Docs
- [ ] Performance
- [ ] Security

### Impact Assessment
- [ ] Changes don't break existing functionality
- [ ] Dependencies updated if needed
- [ ] Version number should be bumped? (check semver)
- [ ] Migration guide needed for breaking changes?
- [ ] API changes documented?

## Post-Commit Actions

- [ ] Push changes to remote repository
- [ ] Create PR if using branch workflow
- [ ] Tag release if version bump occurred
- [ ] Update issue tracker if applicable
- [ ] Notify team of changes if significant

## Quick Commands

```bash
# Check status
git status

# Review changes before committing
git diff

# Lint check
npm run lint

# Type check
npm run type-check

# Run tests
npm test

# See what will be committed
git diff --staged
```

# Agent Commit Message Validation Guide

## Goal

Before creating or approving a commit, the agent must verify that the commit message accurately describes the changes made since the previous commit.

The commit message should be based on the actual diff, not on assumptions or the original task description.

---

## Required Agent Behavior

Before committing, the agent must:

1. Inspect the current Git status.
2. Review all changes since the last commit.
3. Identify the main intent of the changes.
4. Generate or validate a commit message that matches the actual code changes.
5. Reject vague, incorrect, or misleading commit messages.
6. Use a consistent commit format.

---

## Commands the Agent Should Run

The agent should inspect the repository using:

```bash
git status
git diff
git diff --stat
git log -1 --oneline
```

If files are already staged, the agent should also check:

```bash
git diff --cached
git diff --cached --stat
```

The agent must compare the proposed commit message against the actual staged changes.

---

## Commit Message Format

Use this format:

```text
<type>: <short summary>
```

Examples:

```text
feat: add agent-style chat composer
fix: correct message streaming state
refactor: simplify chat panel layout
style: improve chat section spacing
docs: add commit validation guide
chore: update dependencies
test: add chat reducer tests
```

---

## Allowed Commit Types

Use one of the following:

```text
feat
fix
refactor
style
docs
test
chore
perf
build
ci
revert
```

### Type Rules

* Use `feat` for new functionality.
* Use `fix` for bug fixes.
* Use `refactor` for internal code changes that do not change behavior.
* Use `style` for UI, CSS, formatting, or visual-only changes.
* Use `docs` for documentation changes.
* Use `test` for test changes.
* Use `chore` for maintenance tasks.
* Use `perf` for performance improvements.
* Use `build` for build system or dependency configuration.
* Use `ci` for CI/CD workflow changes.
* Use `revert` when reverting a previous commit.

---

## Validation Checklist

Before accepting a commit message, the agent must confirm:

* The message describes what actually changed.
* The message is based on `git diff` or `git diff --cached`.
* The type matches the nature of the change.
* The summary is specific, not generic.
* The summary is written in present tense.
* The summary does not mention unrelated work.
* The message does not exaggerate the scope of the change.
* The message does not say “fix bug” unless the bug is clearly described.
* The message does not say “update files” or “changes” without context.

---

## Bad Commit Messages

Avoid messages like:

```text
update code
fix bugs
changes
work in progress
misc updates
final changes
improve stuff
chat updates
```

These are too vague and do not explain what changed.

---

## Good Commit Messages

Use specific messages like:

```text
feat: add streaming response state to agent chat
fix: prevent duplicate assistant messages during retry
refactor: move chat message rendering into separate component
style: align chat input actions with composer toolbar
docs: document agent commit message validation flow
chore: remove unused design-concept references
```

---

## Agent Instruction

When the user asks to commit changes, the agent must follow this process:

```text
Before committing, inspect the Git diff and staged files. Determine the actual changes made since the last commit. Generate a Conventional Commit-style message that accurately summarizes the primary change. If the proposed commit message does not match the diff, replace it with a better one. Do not commit with vague messages such as "update", "fix", "changes", or "misc". Always explain the selected commit message before committing.
```

---

## Example Agent Flow

1. Run:

```bash
git status
git diff --stat
git diff
```

2. Determine the change category.

Example:

```text
Modified chat layout, added composer action buttons, and improved message spacing.
```

3. Choose the commit type.

```text
style
```

4. Create the commit message.

```text
style: improve agent chat layout and composer actions
```

5. Commit using:

```bash
git add .
git commit -m "style: improve agent chat layout and composer actions"
```

---

## Handling Multiple Change Types

If the diff contains unrelated changes, the agent should split the work into separate commits.

Example:

```text
feat: add agent chat retry action
fix: prevent duplicate chat messages on reload
style: improve chat panel spacing
```

Do not combine unrelated changes into one vague commit.

---

## Final Rule

The commit message must summarize the actual final diff, not the original task request.

The agent should always ask:

```text
Does this commit message accurately describe the staged changes since the last commit?
```

If the answer is no, the agent must revise the commit message before committing.

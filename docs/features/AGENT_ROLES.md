# Agent Roles Reference

This project has several agent role systems. They serve different layers of the application, so the names overlap in a few places but the responsibilities are distinct.

## Role Layers

| Layer | Source | Purpose |
|-------|--------|---------|
| Full-stack orchestration roles | `src/agents/roleMetadata.ts` | Assign bounded work by project area, ownership paths, tools, verification, and escalation rules. |
| Crew coordinator roles | `src/agents/crew.ts` | General-purpose multi-agent task assignment for code, research, testing, review, planning, documentation, and fallback work. |
| Delegated sub-agents | `src/agents/subagents.ts` | Specialized execution agents used by the orchestrator for focused implementation, research, tool, review, and documentation tasks. |

## Full-Stack Orchestration Roles

These are the main production-style roles used for routing bounded work across the repository.

| Role ID | Agent Name | Main Responsibility | Typical Ownership |
|---------|------------|---------------------|-------------------|
| `frontend` | `FrontendAgent` | React UI, components, styling, accessibility, browser behavior | `ui/src/**`, component files, app UI files |
| `backend` | `BackendAgent` | API routes, services, validation, auth boundaries, server-side behavior | `src/**/*.ts`, `server.ts`, backend utilities, React engine internals |
| `data` | `DataAgent` | Schemas, persistence, migrations, seed data, data contracts | `src/data/**`, `src/types/schemas.ts`, migrations, seeds, database files |
| `test` | `TestAgent` | Unit tests, integration tests, smoke tests, Playwright/e2e verification | `**/*.test.ts`, `**/*.spec.ts`, `tests/**`, test configuration |
| `reviewer` | `ReviewerAgent` | Code quality validation, security auditing, best practices, consistency checks | Read-only audit across most project files |
| `documentation` | `DocumentationAgent` | README, API docs, changelog, usage examples, migration notes | `docs/**`, `README.md`, changelog and contribution docs |

### FrontendAgent

Use `frontend` for tasks involving React components, UI state, layout, CSS, responsive behavior, and accessibility.

It commonly collaborates with `backend`, `test`, and `documentation` when API behavior, test coverage, or user-facing docs are involved.

### BackendAgent

Use `backend` for server behavior, routes, validation, service logic, authentication boundaries, logging, model routing, and core engine code.

It commonly escalates to `frontend` when UI changes are required and to `test` when test coverage needs dedicated work.

### DataAgent

Use `data` for schema design, migrations, persistence, seed data, validation schemas, and contracts shared between frontend and backend code.

It commonly collaborates with `backend`, `frontend`, and `test`.

### TestAgent

Use `test` for creating or maintaining tests, improving coverage, setting up fixtures, and validating behavior with unit, integration, smoke, or browser tests.

It escalates failures that indicate product logic problems back to `backend` or `frontend` depending on the affected layer.

### ReviewerAgent

Use `reviewer` for code review, security review, consistency checks, risk assessment, performance review, and final quality gates.

This role is audit-focused and does not own source files for modification.

### DocumentationAgent

Use `documentation` for guides, API reference material, README updates, examples, changelogs, and migration notes.

It can read implementation files for context but focuses its edits on documentation paths.

## Crew Coordinator Roles

These roles are exposed by the CrewCoordinator and are more general-purpose than the full-stack orchestration roles.

| Role | Best For | Typical Tools |
|------|----------|---------------|
| `coder` | Writing, refactoring, and debugging code | `Write`, `Edit`, `Read`, `Bash`, `Glob`, `Grep` |
| `researcher` | Finding and synthesizing information | `WebFetch`, `Glob`, `Grep`, `Read`, `Bash` |
| `tester` | Testing and quality validation | `Bash`, `Read`, `Glob`, `Write` |
| `reviewer` | Code review and improvement suggestions | `Read`, `Grep`, `Bash` |
| `planner` | Breaking complex work into structured subtasks | `Read`, `Bash`, `Glob` |
| `documenter` | Writing user-centric documentation and readmes | `Read`, `Write`, `Edit`, `Glob`, `Bash` |
| `specialist` | Fallback or unusual edge-case work | `Read`, `Write`, `Bash`, `Glob`, `Grep`, `WebFetch` |

The crew system can assign a task directly to a role or auto-select one based on task wording.

## Delegated Sub-Agents

These are focused execution agents used by the primary orchestrator and sub-agent pool.

| Agent | Best For | Common Keywords |
|-------|----------|-----------------|
| `CodeAgent` | Code generation, refactoring, debugging, implementation | code, write, implement, refactor, debug, fix |
| `ResearchAgent` | Research, analysis, summarization, investigation | research, analyze, find, gather, summarize |
| `ToolAgent` | Filesystem operations, shell commands, MCP/tool execution | file, directory, bash, command, shell, execute |
| `ReviewerAgent` | Validation, auditing, quality checks, security review | review, validate, check, audit, verify, test |
| `DocumentationAgent` | Technical writing, API docs, guides, examples | document, readme, guide, changelog, migration |

## How Routing Works

The orchestration layer uses task classification, touched layers, file ownership, workload, and capability matching to select an agent. Examples:

| Task Type | Likely Agent(s) |
|-----------|-----------------|
| Bug fix | `backend`, `frontend`, `test` |
| New feature | `backend`, `frontend`, `data`, `test` |
| Refactor | `backend`, `frontend`, `test` |
| Test-only work | `test` |
| Docs-only work | `documentation` |
| Infrastructure work | `backend`, `data` |
| Generated app work | `frontend`, `backend` |
| Investigation | `reviewer` |

## Related Files

- `src/agents/roleMetadata.ts` - Full-stack role metadata, ownership, tools, verification, and escalation rules.
- `src/agents/roleRegistry.ts` - Role registration, path access checks, ownership conflict detection, and execution ordering.
- `src/orchestration/agentRouter.ts` - Task-to-agent routing profiles and scoring.
- `src/agents/crew.ts` - Crew coordinator roles and task execution.
- `src/agents/subagents.ts` - Delegated sub-agent implementations.
- `docs/features/SUBAGENT_QUICK_REF.md` - Short reference for sub-agent usage patterns.

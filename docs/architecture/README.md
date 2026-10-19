# Architecture & System Design (C4 Model)

This folder contains architectural specifications, component analyses, and design patterns for the Barok autonomous software engineering platform.

Architectural documentation is organized following the **C4 Model** (Context, Containers, Components, Code):

```
┌────────────────────────────────────────────────────────┐
│  Level 1: System Context (Platform & Ecosystem)        │
│  └─ Barok, DeepSeek Harness, Model Providers, Workspaces│
├────────────────────────────────────────────────────────┤
│  Level 2: Containers (Deployable Runtimes)              │
│  └─ Express REST/SSE, Stdio MCP Server, Vite Web UI    │
├────────────────────────────────────────────────────────┤
│  Level 3: Components (Internal Subsystems)             │
│  └─ ReAct Engine, Multi-Key Pool, Tool Router, Security│
├────────────────────────────────────────────────────────┤
│  Level 4: Code & Type Safety                           │
│  └─ Zod Schemas, TypeScript Contracts, DI Wiring       │
└────────────────────────────────────────────────────────┘
```

---

## 🏛️ Level 1 & 2: System Context & Containers

The authoritative Level 1 and Level 2 specifications are maintained in:
- [**Master System Documentation (`../system_documentation/SYSTEM_DOCUMENTATION.md`)**](../system_documentation/SYSTEM_DOCUMENTATION.md): Complete platform overview, high-level C4 container diagrams, monorepo package definitions, and operational modes.
- [**System Harness Overview (`../core/SYSTEM_HARNESS.md`)**](../core/SYSTEM_HARNESS.md): Plain-language explanation of the agent execution harness and provider routing model.

---

## 🧩 Level 3: Components & Subsystems

Detailed analyses and subsystem designs:

| Document | Focus Area | Description |
| :--- | :--- | :--- |
| [**DEPENDENCY_INJECTION_SUMMARY.md**](./DEPENDENCY_INJECTION_SUMMARY.md) | Component Wiring | Dependency injection container design, runtime capability ports, and test mock isolation. |
| [**TOOL_EXECUTION_ANALYSIS.md**](./TOOL_EXECUTION_ANALYSIS.md) | Tool Subsystem | Analysis of guarded tool execution, timeout protection, AST command inspection, and mutation barriers. |
| [**SUBAGENT_ARCHITECTURE.md**](../features/SUBAGENT_ARCHITECTURE.md) | Multi-Agent Coordination | Subtask decomposition, primary orchestrator dispatch, and specialized agent roles (Coder, Reviewer, Tester). |
| [**RETRY_LOGIC_ANALYSIS.md**](../features/RETRY_LOGIC_ANALYSIS.md) | Resilience & Recovery | Multi-key pool rotation, 429 backoff curves, provider cooldowns, and model escalation policies. |
| [**FILESYSTEM_SECURITY.md**](../security/FILESYSTEM_SECURITY.md) | Security Sandboxing | Path canonicalization, directory traversal protection, and symlink detection algorithms. |

---

## 💻 Level 4: Code, Types & UI Architecture

| Document | Focus Area | Description |
| :--- | :--- | :--- |
| [**TYPE_SAFETY_IMPROVEMENTS.md**](./TYPE_SAFETY_IMPROVEMENTS.md) | Type Safety | TypeScript strict mode implementation, discriminating unions, and runtime validation patterns. |
| [**UI_COMPONENT_GUIDE.md**](./UI_COMPONENT_GUIDE.md) | Frontend Components | React component architecture, Tailwind styling system, and state management in the Web UI. |
| [**REFERENCE_UI_MIGRATION.md**](./REFERENCE_UI_MIGRATION.md) | UI Evolution | Historical migration notes from initial prototype to production React dashboard. |
| [**VSCODE_EXTENSION_DESIGN.md**](./VSCODE_EXTENSION_DESIGN.md) | IDE Integration | Architecture design for the Barok VS Code companion extension. |

---

## 📋 Architectural Decisions (ADRs)

For the rationale and history behind major architectural shifts, see the [**Architecture Decision Records (`../adr/`)**](../adr/README.md).


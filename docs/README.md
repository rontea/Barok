# 📚 Barok Documentation Hub

Welcome to the Barok documentation portal. This hub is organized following the **Diátaxis Framework** (Tutorials, How-To Guides, Technical Reference, and Architectural Explanation) and the **C4 Model** for visual system architecture.

---

## 🌟 Master System Architecture & ADRs

| Section | Description |
| :--- | :--- |
| **[System Documentation](./system_documentation/SYSTEM_DOCUMENTATION.md)** | Authoritative master architecture specification covering monorepo packages, ReAct engine, security model, multi-agent orchestration, LLM provider routing, persistence, and verification gates. |
| **[Architecture & C4 Model](./architecture/README.md)** | C4 Context, Containers, Components, and Code-level design analyses. |
| **[Architecture Decision Records (ADRs)](./adr/README.md)** | Immutable record of architectural decisions, context, trade-offs, and consequences. |

---

## 🧭 Diátaxis Navigation

```
                       PRACTICAL (Action-oriented)
                                │
          Tutorials             │          How-To Guides
       (Learn by Doing)         │       (Solve Specific Tasks)
                                │
    • Quickstart Guide          │    • Running the Agent System
    • First User Walkthrough    │    • Multi-Key Pool Setup
                                │    • Test Infrastructure
  ──────────────────────────────┼──────────────────────────────
          Explanation           │           Reference
    (Architectural Context)     │    (Exact Specs & Schemas)
                                │
    • System Harness Concept    │    • API Response Formats
    • ReAct Execution Model     │    • Response Validation Rules
    • Filesystem Security Model │    • Harness Compatibility
    • Dependency Injection      │    • Agent Roles & Capabilities
                                │
                      THEORETICAL (Knowledge-oriented)
```

---

## 🚀 1. Tutorials (Learning-Oriented)
Guided introductions to get you up and running with Barok from scratch:

| Document | Focus | Description |
| :--- | :--- | :--- |
| [**QUICKSTART.md**](./core/QUICKSTART.md) | Setup & First Run | Step-by-step guide to clone, install, configure keys, and launch the system. |
| [**USER_GUIDE.md**](./core/USER_GUIDE.md) | User Workflows | Daily development guide: Coder Chat, Workplan approvals, and diff review. |

---

## 🛠️ 2. How-To Guides (Problem-Oriented)
Practical step-by-step guides for running and configuring specific subsystems:

| Document | Focus | Description |
| :--- | :--- | :--- |
| [**RUN_GUIDE.md**](./core/RUN_GUIDE.md) | Execution Modes | Running the Web dashboard, terminal CLI, offline smoke tests, and background servers. |
| [**MULTI_KEY_POOL_GUIDE.md**](./features/MULTI_KEY_POOL_GUIDE.md) | Provider Keys | Configuring isolated API key rotation pools, rate-limit cooldowns, and fallback routing. |
| [**TESTING_SETUP.md**](./features/TESTING_SETUP.md) | Testing & Mocks | Running Jest unit suites, operating gates, Playwright UI tests, and offline fixtures. |
| [**TOOL_TIMEOUT_PROTECTION.md**](./features/TOOL_TIMEOUT_PROTECTION.md) | Process Safety | Configuring timeouts, handling hanging processes, and resource isolation. |

---

## 📖 3. Technical Reference (Information-Oriented)
Exact specifications, schemas, interfaces, and compatibility matrices:

| Document | Category | Description |
| :--- | :--- | :--- |
| [**API_RESPONSE_FORMATS.md**](./api/API_RESPONSE_FORMATS.md) | API | Standard request/response JSON schemas for Pollinations, Gemini, and OpenAI-compatible routes. |
| [**RESPONSE_VALIDATION.md**](./api/RESPONSE_VALIDATION.md) | API | Runtime validation rules, schema constraints, and error payload structures. |
| [**HARNESS_COMPATIBILITY.md**](./compatibility/HARNESS_COMPATIBILITY.md) | Ecosystem | Tested version matrix and compatibility boundaries for DeepSeek Harness (`dsh`). |
| [**AGENT_ROLES.md**](./features/AGENT_ROLES.md) | Orchestration | Catalog of specialized agent roles (Coder, Reviewer, Tester, Architect) and prompt policies. |
| [**CREDITS.md**](./core/CREDITS.md) | Metadata | Acknowledgments and open-source credits for dependencies and frameworks. |

---

## 🏛️ 4. Explanation & Architecture (Understanding-Oriented)
Deep architectural context and design rationale:

| Document | Category | Description |
| :--- | :--- | :--- |
| [**SYSTEM_DOCUMENTATION.md**](./system_documentation/SYSTEM_DOCUMENTATION.md) | Master Spec | Complete system architecture, monorepo package boundaries, and lifecycle states. |
| [**SYSTEM_HARNESS.md**](./core/SYSTEM_HARNESS.md) | Philosophy | The agent harness paradigm: bounded ReAct loops, safety boundaries, and persistence. |
| [**DEPENDENCY_INJECTION_SUMMARY.md**](./architecture/DEPENDENCY_INJECTION_SUMMARY.md) | Design Pattern | Container architecture, capability ports, and decoupling host implementations. |
| [**TYPE_SAFETY_IMPROVEMENTS.md**](./architecture/TYPE_SAFETY_IMPROVEMENTS.md) | Type System | Discriminating unions, TypeScript strictness, and compile-time contract enforcement. |
| [**TOOL_EXECUTION_ANALYSIS.md**](./architecture/TOOL_EXECUTION_ANALYSIS.md) | Execution | Tool dispatch mechanics, AST shell command validation, and workspace path sandboxing. |
| [**FILESYSTEM_SECURITY.md**](./security/FILESYSTEM_SECURITY.md) | Security | Path canonicalization, directory traversal defense, and symlink protection algorithms. |
| [**RETRY_LOGIC_ANALYSIS.md**](./features/RETRY_LOGIC_ANALYSIS.md) | Resilience | Mathematical analysis of exponential backoff curves, jitter, and cooldown recovery. |
| [**PRIMARY_ORCHESTRATOR.md**](./features/PRIMARY_ORCHESTRATOR.md) | Multi-Agent | Task decomposition algorithms, confidence scoring, and subtask result synthesis. |

---

## 🗂️ Documentation Hierarchy

```
docs/
├── README.md                                    # This master navigation hub
├── adr/                                         # Architecture Decision Records
│   ├── README.md                                # ADR process, template & index
│   ├── 0001-monorepo-extraction.md
│   ├── 0002-node-sqlite-persistence.md
│   └── 0003-version-alignment-experimental.md
├── architecture/                                # C4 design & system analyses
│   ├── README.md                                # C4 model overview & index
│   ├── DEPENDENCY_INJECTION_SUMMARY.md
│   ├── TYPE_SAFETY_IMPROVEMENTS.md
│   ├── UI_COMPONENT_GUIDE.md
│   ├── TOOL_EXECUTION_ANALYSIS.md
│   ├── VSCODE_EXTENSION_DESIGN.md
│   └── REFERENCE_UI_MIGRATION.md
├── system_documentation/                        # Master platform specification
│   ├── README.md
│   └── SYSTEM_DOCUMENTATION.md                  # Authoritative system spec
├── core/                                        # Core manuals & guides
│   ├── QUICKSTART.md
│   ├── USER_GUIDE.md
│   ├── RUN_GUIDE.md
│   ├── SYSTEM_HARNESS.md
│   ├── PROJECT_SUMMARY.md
│   └── CREDITS.md
├── api/                                         # API contracts & validation
│   ├── API_RESPONSE_FORMATS.md
│   └── RESPONSE_VALIDATION.md
├── compatibility/                               # Host ecosystem compatibility
│   └── HARNESS_COMPATIBILITY.md
├── security/                                    # Security controls & threat model
│   ├── FILESYSTEM_SECURITY.md
│   ├── FILESYSTEM_SECURITY_SUMMARY.md
│   └── FILESYSTEM_SECURITY_EXAMPLES.md
└── features/                                    # Specialized subsystem guides
    ├── PRIMARY_ORCHESTRATOR.md
    ├── SUBAGENT_ARCHITECTURE.md
    ├── RETRY_LOGIC_ANALYSIS.md
    ├── MULTI_KEY_POOL_GUIDE.md
    ├── TOOL_TIMEOUT_PROTECTION.md
    ├── TESTING_SETUP.md
    └── AGENT_ROLES.md
```

---

*Last Updated: 2026-10-19 — Aligned to Version 0.0.1-experimental*

# UI Component Architecture

A comprehensive, modular component system for the Raw ReAct MCP UI.

## Directory Structure

```
ui/src/
├── components/           # Reusable UI components
│   ├── ErrorBoundary.tsx    # Error boundary for error handling
│   ├── FormComponents.tsx    # Form inputs & controls (Button, Input, Select, etc.)
│   ├── LoadingComponents.tsx # Loading spinners & skeleton loaders
│   ├── PanelComponents.tsx   # Complex panel components (AppCreatorPanel, etc.)
│   └── index.ts            # Component exports
├── hooks/                # Custom hooks for state management
│   └── index.ts           # useReActExecutor, useStatusCheck, useModal, useForm
├── App.tsx              # Main application component
├── main.tsx            # Application entry point
├── index.css           # Global styles
└── StructureExplorer.tsx # File structure explorer
```

## Component Categories

### 1. Form Components (`FormComponents.tsx`)

Reusable form and UI control components with consistent styling.

#### Button
```tsx
import { Button } from './components';

<Button 
  variant="primary"      // 'primary' | 'secondary' | 'danger' | 'ghost'
  size="md"             // 'sm' | 'md' | 'lg'
  disabled={false}
  icon={<IconComponent />}
  onClick={() => {}}
>
  Click me
</Button>
```

#### Input
```tsx
<Input
  label="API Key"
  type="password"
  placeholder="Enter your key"
  error="Invalid format"
  icon={<LockIcon />}
  onChange={(e) => setApiKey(e.target.value)}
/>
```

#### Textarea
```tsx
<Textarea
  label="Task Description"
  rows={5}
  placeholder="What do you need?"
  error={errors.task}
/>
```

#### Select
```tsx
<Select
  label="Model"
  value={model}
  onChange={(e) => setModel(e.target.value)}
  options={[
    { value: 'gpt4', label: 'GPT-4' },
    { value: 'gpt3', label: 'GPT-3.5' },
  ]}
/>
```

#### Card
```tsx
<Card highlight={isHighlighted} className="custom-class">
  Card content goes here
</Card>
```

#### Badge
```tsx
<Badge variant="success">Active</Badge>
<Badge variant="error">Failed</Badge>
<Badge variant="warning">Pending</Badge>
```

#### Alert
```tsx
<Alert type="success" onClose={() => {}}>
  Operation completed successfully!
</Alert>
```

### 2. Loading Components (`LoadingComponents.tsx`)

Components for loading states and skeleton screens.

#### LoadingSpinner
```tsx
<LoadingSpinner 
  message="Loading your data..."
  size="md"  // 'sm' | 'md' | 'lg'
/>
```

#### Skeleton Loaders
```tsx
<SkeletonCard />
<SkeletonList count={3} />
<SkeletonInput count={2} />
```

### 3. Panel Components (`PanelComponents.tsx`)

Complex, feature-rich components for specific UI sections.

#### AppCreatorPanel
```tsx
<AppCreatorPanel
  appName={appName}
  onAppNameChange={setAppName}
  template={template}
  onTemplateChange={setTemplate}
  loading={isLoading}
  onGenerate={handleGenerate}
/>
```

#### StatusCheckPanel
```tsx
<StatusCheckPanel
  icon={<FlowerIcon />}
  title="Pollen Balance"
  description="Check your account balance"
  loading={checking}
  status={pollenStatus}
  error={error}
  onCheck={checkBalance}
/>
```

#### ResultsPanel
```tsx
<ResultsPanel
  result={executionResult}
  loading={isExecuting}
  liveProgress={progress}
  liveState={currentState}
  onReset={resetResults}
/>
```

#### ModelConfigPanel
```tsx
<ModelConfigPanel
  model={selectedModel}
  onModelChange={setModel}
  workspace={workspace}
  onWorkspaceChange={setWorkspace}
  onSelectFolder={openFolderModal}
/>
```

### 4. Error Boundary

Wrap your app to catch and display React component errors gracefully.

```tsx
import { ErrorBoundary } from './components';

<ErrorBoundary>
  <App />
</ErrorBoundary>
```

## Custom Hooks (`hooks/index.ts`)

Hooks for separating state logic from UI components.

### useReActExecutor

Manages ReAct task execution state and logic.

```tsx
const {
  task,
  setTask,
  model,
  setModel,
  loading,
  liveProgress,
  liveState,
  result,
  error,
  executeTask,
  reset,
} = useReActExecutor();

// Execute a task
await executeTask(taskDescription, modelName, workspace);
```

### useStatusCheck

Generic hook for API status checks with loading/error states.

```tsx
const { status, checking, error, check, reset } = useStatusCheck(
  async () => {
    const res = await fetch('/api/balance');
    return res.json();
  }
);

check(); // Trigger the check
```

### useModal

Simple modal open/close state management.

```tsx
const { isOpen, open, close, toggle } = useModal();

{isOpen && <ModalContent onClose={close} />}
```

### useForm

Form state management with validation support.

```tsx
const { values, errors, touched, setValue, setError, reset } = useForm({
  email: '',
  password: '',
});

<Input
  value={values.email}
  onChange={(e) => setValue('email', e.target.value)}
  error={touched.email && errors.email}
/>
```

## Styling System

All components use Tailwind CSS with a dark theme:

- **Background**: `bg-zinc-900` (cards), `bg-zinc-950` (inputs)
- **Borders**: `border-zinc-800` (default), `border-zinc-700` (hover)
- **Text**: `text-white` (primary), `text-zinc-400` (secondary), `text-zinc-600` (disabled)
- **Accent**: `text-indigo-400` (primary action)
- **Status**:
  - Success: `bg-emerald-500/10` / `text-emerald-400`
  - Error: `bg-red-500/10` / `text-red-400`
  - Warning: `bg-yellow-500/10` / `text-yellow-400`
  - Info: `bg-blue-500/10` / `text-blue-400`

## Best Practices

1. **Use custom hooks** for state logic, keep components presentational
2. **Compose panels** from smaller components for flexibility
3. **Wrap app with ErrorBoundary** to gracefully handle errors
4. **Use skeleton loaders** while data is loading
5. **Leverage Badge component** for status indicators
6. **Keep components prop-driven** for maximum reusability
7. **Use TypeScript interfaces** for type safety
8. **Extract magic strings** to constants

## Migration Guide

When refactoring existing components:

1. Extract state to custom hooks
2. Break large components into smaller, focused ones
3. Use FormComponents for all inputs
4. Replace inline loading states with LoadingSpinner
5. Use ErrorBoundary at appropriate levels
6. Compose UI from reusable panels

## Example: Refactoring a Component

### Before (Monolithic)
```tsx
function MyComponent() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data');
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div>
      {loading && <div>Loading...</div>}
      {error && <div>{error}</div>}
      {data && <div>{data}</div>}
    </div>
  );
}
```

### After (Modular)
```tsx
function MyComponent() {
  const { status, checking, error, check } = useStatusCheck(
    () => fetch('/api/data').then(r => r.json())
  );

  return (
    <StatusCheckPanel
      icon={<DataIcon />}
      title="Data"
      description="Fetch your data"
      loading={checking}
      status={status}
      error={error}
      onCheck={check}
    />
  );
}
```

---

**Version**: 1.0  
**Last Updated**: 2026-06-19  
**Maintainer**: ReAct UI Team

import { useState, useCallback } from 'react';

/**
 * Hook for managing ReAct execution state
 */
export interface ReActStep {
  thought: string;
  action: string;
  action_input: Record<string, unknown>;
  observation?: string;
  is_done?: boolean;
  final_answer?: string;
  pollenCost?: number;
}

export interface ReActResult {
  success: boolean;
  finalAnswer?: string;
  steps: ReActStep[];
  stepCount: number;
  pollenCost?: number;
  error?: string;
}

interface UseReActExecutorReturn {
  task: string;
  setTask: (task: string) => void;
  model: string;
  setModel: (model: string) => void;
  loading: boolean;
  liveProgress: string;
  liveState: any;
  result: ReActResult | null;
  error: string | null;
  executeTask: (task: string, model: string, workspace?: string) => Promise<void>;
  reset: () => void;
}

export const useReActExecutor = (): UseReActExecutorReturn => {
  const [task, setTask] = useState('');
  const [model, setModel] = useState('z-ai/glm-5.2');
  const [loading, setLoading] = useState(false);
  const [liveProgress, setLiveProgress] = useState('');
  const [liveState, setLiveState] = useState<any>(null);
  const [result, setResult] = useState<ReActResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeTask = useCallback(
    async (task: string, model: string, workspace?: string) => {
      setLoading(true);
      setError(null);
      setResult(null);
      setLiveProgress('');
      setLiveState(null);

      try {
        const response = await fetch('/api/react/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task,
            model,
            maxSteps: 30,
            budget: 100,
            workspace: workspace?.trim() || undefined,
          }),
        });

        if (!response.body) throw new Error('No response body');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            const typeMatch = block.match(/event: (.*)\n/);
            const dataMatch = block.match(/data: (.*)/);
            if (typeMatch && dataMatch) {
              const type = typeMatch[1];
              const data = JSON.parse(dataMatch[1]);

              if (type === 'progress') {
                setLiveProgress(data);
              } else if (type === 'state') {
                setLiveState(data);
              } else if (type === 'done') {
                setResult(data);
              } else if (type === 'error') {
                setResult({
                  success: false,
                  error: data.error,
                  steps: [],
                  stepCount: 0,
                });
              }
            }
          }
        }
      } catch (err: any) {
        setError(err.message || 'Execution failed');
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setTask('');
    setLoading(false);
    setLiveProgress('');
    setLiveState(null);
    setResult(null);
    setError(null);
  }, []);

  return {
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
  };
};

/**
 * Hook for managing API status checks
 */
interface StatusCheckResult<T> {
  status: T | null;
  checking: boolean;
  error: string | null;
  check: () => Promise<void>;
  reset: () => void;
}

export const useStatusCheck = <T,>(
  fetchFn: () => Promise<T>,
  initialStatus?: T
): StatusCheckResult<T> => {
  const [status, setStatus] = useState<T | null>(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await fetchFn();
      setStatus(result);
    } catch (err: any) {
      setError(err.message || 'Check failed');
    } finally {
      setChecking(false);
    }
  }, [fetchFn]);

  const reset = useCallback(() => {
    setStatus(initialStatus || null);
    setChecking(false);
    setError(null);
  }, [initialStatus]);

  return { status, checking, error, check, reset };
};

/**
 * Hook for managing modal state
 */
interface UseModalReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useModal = (initialOpen = false): UseModalReturn => {
  const [isOpen, setIsOpen] = useState(initialOpen);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
};

/**
 * Hook for managing form state with validation
 */
interface UseFormReturn<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  setValue: (field: keyof T, value: any) => void;
  setError: (field: keyof T, error: string) => void;
  setTouched: (field: keyof T, touched: boolean) => void;
  reset: (initialValues: T) => void;
}

export const useForm = <T extends Record<string, any>>(
  initialValues: T
): UseFormReturn<T> => {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});

  return {
    values,
    errors,
    touched,
    setValue: (field, value) => {
      setValues((prev) => ({ ...prev, [field]: value }));
      if (errors[field]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    setError: (field, error) => {
      setErrors((prev) => ({ ...prev, [field]: error }));
    },
    setTouched: (field, isTouched) => {
      setTouched((prev) => ({ ...prev, [field]: isTouched }));
    },
    reset: (initialValues) => {
      setValues(initialValues);
      setErrors({});
      setTouched({});
    },
  };
};

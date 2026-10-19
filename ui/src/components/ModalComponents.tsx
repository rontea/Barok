import React, { ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from './FormComponents';

/**
 * Reusable modal dialog component
 */
interface ModalProps {
  isOpen: boolean;
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  icon,
  onClose,
  children,
  footer,
  size = 'md',
}) => {
  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className={`bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col w-full ${sizes[size]} max-h-[90vh]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            {icon && <span className="text-indigo-400">{icon}</span>}
            <h2 className="text-lg font-bold text-white">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-zinc-800 p-6 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Folder selection modal component
 */
interface FolderSelectorModalProps {
  isOpen: boolean;
  currentPath: string;
  directories: string[];
  loading: boolean;
  error?: string;
  parentPath?: string;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export const FolderSelectorModal: React.FC<FolderSelectorModalProps> = ({
  isOpen,
  currentPath,
  directories,
  loading,
  error,
  parentPath,
  onNavigate,
  onSelect,
  onClose,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      title="Local drive"
      icon="📁"
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button
            onClick={() => onSelect(currentPath)}
            variant="primary"
          >
            Select local drive
          </Button>
        </>
      }
    >
      {/* Current Path Display */}
      <div className="text-sm text-zinc-400 font-mono bg-zinc-950 p-3 rounded-lg border border-zinc-800 mb-4 overflow-x-auto truncate">
        {currentPath}
      </div>

      {/* Error Display */}
      {error && (
        <div className="text-sm text-red-400 bg-red-950/20 px-3 py-2 rounded-lg border border-red-900/30 mb-4 truncate">
          Error: {error}
        </div>
      )}

      {/* Directory Listing */}
      <div className="min-h-[200px] border border-zinc-800 rounded-lg bg-zinc-950 p-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-500 gap-3">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-sm">Loading directories...</span>
          </div>
        ) : (
          <ul className="space-y-1">
            {parentPath && (
              <li>
                <button
                  onClick={() => onNavigate(parentPath)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors text-left font-medium"
                >
                  <span>↩</span>
                  <span>..</span>
                </button>
              </li>
            )}
            {directories.length === 0 && !parentPath && (
              <div className="text-center text-zinc-600 py-8 text-sm">
                No directories found
              </div>
            )}
            {directories.map((dir) => (
              <li key={dir}>
                <button
                  onClick={() => {
                    const separator = currentPath.endsWith('/') || currentPath.endsWith('\\') ? '' : '/';
                    const nextPath = currentPath ? `${currentPath}${separator}${dir}` : dir;
                    onNavigate(nextPath);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors text-left"
                >
                  <span>▶</span>
                  <span className="truncate text-sm">{dir}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};

/**
 * Generic confirmation modal
 */
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDangerous = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            variant={isDangerous ? 'danger' : 'primary'}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-300">{message}</p>
    </Modal>
  );
};

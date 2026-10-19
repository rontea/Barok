import React, { ReactNode } from 'react';

/**
 * Reusable button component with variants
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  icon?: ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  children,
  icon,
  disabled,
  className = '',
  ...props
}) => {
  const baseClass = 'rounded-xl font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white',
    secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:bg-zinc-900 disabled:text-zinc-600',
    danger: 'bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white',
    ghost: 'hover:bg-zinc-800 text-zinc-300 disabled:text-zinc-600',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };

  return (
    <button
      disabled={disabled}
      className={`${baseClass} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
};

/**
 * Reusable text input component
 */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  icon,
  className = '',
  ...props
}) => (
  <div className="w-full">
    {label && (
      <label className="block text-sm font-medium text-zinc-300 mb-2">
        {label}
      </label>
    )}
    <div className="flex items-center bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all">
      {icon && <span className="text-zinc-500 mr-2">{icon}</span>}
      <input
        className={`bg-transparent text-sm text-zinc-200 outline-none w-full ${className}`}
        {...props}
      />
    </div>
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

/**
 * Reusable textarea component
 */
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  className = '',
  ...props
}) => (
  <div className="w-full">
    {label && (
      <label className="block text-sm font-medium text-zinc-300 mb-2">
        {label}
      </label>
    )}
    <textarea
      className={`w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none ${className}`}
      {...props}
    />
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

/**
 * Reusable select/dropdown component
 */
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: Array<{ value: string; label: string }>;
  error?: string;
}

export const Select: React.FC<SelectProps> = ({
  label,
  options,
  error,
  className = '',
  ...props
}) => (
  <div className="w-full">
    {label && (
      <label className="block text-sm font-medium text-zinc-300 mb-2">
        {label}
      </label>
    )}
    <select
      className={`w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer transition-all ${className}`}
      {...props}
    >
      {options.map((opt, idx) => (
        <option key={`${opt.value}-${idx}`} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);

/**
 * Reusable card/panel component
 */
interface CardProps {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  highlight = false,
}) => (
  <div
    className={`bg-zinc-900 rounded-2xl p-6 shadow-xl ${
      highlight
        ? 'border border-indigo-500/30 bg-indigo-950/10'
        : 'border border-zinc-800'
    } ${className}`}
  >
    {children}
  </div>
);

/**
 * Reusable badge/tag component
 */
interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default' }) => {
  const variants = {
    default: 'bg-zinc-800 text-zinc-200',
    success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    warning: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    error: 'bg-red-500/10 text-red-400 border border-red-500/20',
    info: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  };

  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
};

/**
 * Reusable alert component
 */
interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'error';
  children: ReactNode;
  onClose?: () => void;
}

export const Alert: React.FC<AlertProps> = ({ type = 'info', children, onClose }) => {
  const styles = {
    info: 'bg-blue-950/20 border-blue-900/30 text-blue-400',
    success: 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400',
    warning: 'bg-yellow-950/20 border-yellow-900/30 text-yellow-400',
    error: 'bg-red-950/20 border-red-900/30 text-red-400',
  };

  return (
    <div className={`text-sm px-4 py-3 rounded-lg border flex items-center justify-between ${styles[type]}`}>
      <span>{children}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="ml-4 text-xs opacity-70 hover:opacity-100 transition-opacity"
        >
          ✕
        </button>
      )}
    </div>
  );
};

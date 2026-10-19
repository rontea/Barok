import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Reusable loading spinner component
 */
interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Loading...',
  size = 'md',
}) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2 className={`${sizes[size]} animate-spin text-indigo-400`} />
      {message && <p className="text-sm text-zinc-400">{message}</p>}
    </div>
  );
};

/**
 * Skeleton loader for card-like content
 */
export const SkeletonCard: React.FC = () => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 animate-pulse">
    <div className="h-6 bg-zinc-800 rounded w-3/4 mb-4"></div>
    <div className="space-y-3">
      <div className="h-4 bg-zinc-800 rounded w-full"></div>
      <div className="h-4 bg-zinc-800 rounded w-5/6"></div>
      <div className="h-4 bg-zinc-800 rounded w-4/6"></div>
    </div>
  </div>
);

/**
 * Skeleton loader for a list of items
 */
interface SkeletonListProps {
  count?: number;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({ count = 3 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="h-12 bg-zinc-800 rounded-lg animate-pulse"></div>
    ))}
  </div>
);

/**
 * Skeleton loader for input fields
 */
interface SkeletonInputProps {
  count?: number;
}

export const SkeletonInput: React.FC<SkeletonInputProps> = ({ count = 1 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="h-10 bg-zinc-800 rounded-xl animate-pulse"></div>
    ))}
  </div>
);

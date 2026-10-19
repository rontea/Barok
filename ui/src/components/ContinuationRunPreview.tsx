import React from 'react';
import type { ContinuationHandoffPreview } from '../../../src/react/continuation';

export const ContinuationRunPreview: React.FC<{ preview: ContinuationHandoffPreview }> = ({ preview }) => (
  <div className="basis-full space-y-1 border-t border-cyan-500/20 pt-2 font-mono text-[10px] text-text-dim">
    <div>
      <span className="text-cyan-200">Remaining:</span>{' '}
      {preview.remainingPlanItem || 'No remaining plan item recorded'}
    </div>
    <div>
      <span className="text-sky-200">Last update:</span>{' '}
      {preview.latestUpdatedFile || 'No file update recorded'}
    </div>
    <div>
      <span className="text-emerald-200">Latest check:</span>{' '}
      {preview.latestVerifiedCheck || 'No verified check recorded'}
    </div>
    <div>
      <span className="text-amber-200">Blocker:</span>{' '}
      {preview.blocker || 'None recorded'}
    </div>
  </div>
);

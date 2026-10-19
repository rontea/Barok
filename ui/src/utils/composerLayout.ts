/**
 * Layout contracts shared by the composer implementation and narrow-screen
 * regression tests. The dock must remain a bounded, independently scrollable
 * region so it cannot cover the console or the mobile safe area.
 */
export const CODER_COMPOSER_DOCK_CLASS = 'max-h-[45vh] shrink-0 min-w-0 overflow-y-auto border-t border-neutral-900 bg-neutral-950/95 px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:px-4';
export const CODER_COMPOSER_FORM_CLASS = 'flex w-full min-w-0 flex-col';

/** Compatibility facade for the host-neutral generated-app specification policy. */
export {
  buildFallbackAppSpec,
  classifyAppType,
  createAppSpec,
  formatAppSpec,
  inferAppName,
  isAppBuildRequest,
  selectOutputMode,
} from '@barok/engine';
export type { AppOutputMode, AppSpec, AppSpecLLMProvider, AppType } from '@barok/engine';

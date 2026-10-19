import { Router } from 'express';
import { PathValidationError } from '@barok/adapter-node';
import { loadKnowledgeSettings, saveKnowledgeSettings } from '../tools/knowledgeSettings.js';
import { loadWorkspaceGuide, saveWorkspaceGuide } from '../tools/workspaceGuide.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';
import { getDelegationRouteOptions, getDelegationSettings, saveDelegationSettings, validateDelegationSettings } from '../config/delegationRouting.js';
import { normalizeExecutionProfilePresets, setExecutionProfilePresets } from '../config/executionProfiles.js';
import { getRuntimeSettings, resolveRuntimeSettings, updateRuntimeSettings, type RuntimeSettings } from '../config/runtimeSettings.js';
import { getSQLiteAppStore } from '../persistence/sqliteStore.js';
import { sanitizeError, isProviderSettingsMutationAuthorized } from './_shared.js';

export interface SettingsRouterDependencies {
  ensureWorkspaceRoot: (workspace?: string) => Promise<string>;
}

export function createRouter({ ensureWorkspaceRoot }: SettingsRouterDependencies) {
  const router = Router();

  router.get('/api/settings', (_req, res) => {
    try {
      res.json({ settings: getSQLiteAppStore().getAllSettings() });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.put('/api/settings/:key', (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Settings changes require same-origin access or an authorized server token.' });
    }
    try {
      getSQLiteAppStore().saveSetting(req.params.key, req.body?.value ?? req.body);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/engine-settings', (_req, res) => {
    try {
      const store = getSQLiteAppStore();
      const saved = store.getSetting<Record<string, any>>('engine_settings') || {};
      // Model selection is owned by the provider/API Settings route. Do not
      // let a legacy DEFAULT_MODEL or planner environment value override it.
      const configuredModel = getConfiguredCoderModelSelection();
      const settings = {
        ...getRuntimeSettings(),
        defaultModel: configuredModel,
        plannerModel: configuredModel,
        pacingProfiles: normalizeExecutionProfilePresets(saved.pacingProfiles),
      };
      res.json({ settings });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.put('/api/engine-settings', (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Engine settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const store = getSQLiteAppStore();
      const input = req.body?.settings && typeof req.body.settings === 'object'
        ? req.body.settings
        : req.body;
      // Keep these compatibility fields aligned with the persisted provider
      // route. They are not read from .env and are not independently stored.
      const configuredModel = getConfiguredCoderModelSelection();
      const settings = {
        ...resolveRuntimeSettings(input as Partial<RuntimeSettings>),
        defaultModel: configuredModel,
        plannerModel: configuredModel,
        pacingProfiles: normalizeExecutionProfilePresets(input?.pacingProfiles),
      };
      store.saveSetting('engine_settings', settings);
      updateRuntimeSettings(settings);
      setExecutionProfilePresets(settings.pacingProfiles);

      res.json({ success: true, settings });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/delegation/settings', (_req, res) => {
    try {
      const settings = getDelegationSettings();
      const validation = validateDelegationSettings(settings);
      res.json({
        settings,
        valid: validation.valid,
        errors: validation.errors,
        routes: getDelegationRouteOptions(),
      });
    } catch (error: any) {
      res.status(500).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.put('/api/delegation/settings', (req, res) => {
    if (!isProviderSettingsMutationAuthorized(req)) {
      return res.status(403).json({ error: 'Delegation settings changes require same-origin access or an authorized server token.' });
    }
    try {
      const settings = saveDelegationSettings(req.body?.settings ?? req.body);
      res.json({
        success: true,
        settings,
        valid: true,
        errors: [],
        routes: getDelegationRouteOptions(),
      });
    } catch (error: any) {
      res.status(400).json({ error: sanitizeError(error.message || String(error)) });
    }
  });

  router.get('/api/knowledge-settings', async (req, res) => {
    try {
      const workspace = await ensureWorkspaceRoot(
        typeof req.query.workspace === 'string' ? req.query.workspace : undefined
      );
      res.json({ settings: await loadKnowledgeSettings(workspace) });
    } catch (error: any) {
      res.status(error instanceof PathValidationError ? 400 : 500).json({
        error: sanitizeError(error.message || String(error)),
      });
    }
  });

  router.put('/api/knowledge-settings', async (req, res) => {
    try {
      const workspace = await ensureWorkspaceRoot(
        typeof req.body?.workspace === 'string' ? req.body.workspace : undefined
      );
      const input = req.body?.settings && typeof req.body.settings === 'object'
        ? req.body.settings
        : req.body;
      const settings = await saveKnowledgeSettings(workspace, {
        sampleLookupEnabled: input?.sampleLookupEnabled,
        sampleFolder: input?.sampleFolder,
        wikiLookupEnabled: input?.wikiLookupEnabled,
        wikiFolder: input?.wikiFolder,
        webSearchEnabled: input?.webSearchEnabled,
      });
      res.json({ success: true, settings });
    } catch (error: any) {
      res.status(error instanceof PathValidationError || error instanceof TypeError ? 400 : 500).json({
        error: sanitizeError(error.message || String(error)),
      });
    }
  });

  router.get('/api/workspace-guide', async (req, res) => {
    try {
      const workspace = await ensureWorkspaceRoot(
        typeof req.query.workspace === 'string' ? req.query.workspace : undefined
      );
      res.json({ guide: await loadWorkspaceGuide(workspace) });
    } catch (error: any) {
      res.status(error instanceof PathValidationError || error instanceof TypeError ? 400 : 500).json({
        error: sanitizeError(error.message || String(error)),
      });
    }
  });

  router.put('/api/workspace-guide', async (req, res) => {
    try {
      const workspace = await ensureWorkspaceRoot(
        typeof req.body?.workspace === 'string' ? req.body.workspace : undefined
      );
      const saved = await saveWorkspaceGuide(workspace, req.body?.content, req.body?.enabled);
      res.json({ success: true, ...saved });
    } catch (error: any) {
      res.status(error instanceof PathValidationError || error instanceof TypeError ? 400 : 500).json({
        error: sanitizeError(error.message || String(error)),
      });
    }
  });

  return router;
}

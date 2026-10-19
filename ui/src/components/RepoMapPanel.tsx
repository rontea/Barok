import React from 'react';
import { FolderOpen, FolderPlus, FileText, Zap, Archive, BookOpen } from 'lucide-react';

interface RepoMapData {
  timestamp?: number;
  workspace?: string;
  frontend?: { path?: string; rootDir?: string; modules?: string[]; components?: string[]; pages?: string[]; utilities?: string[]; configFiles?: string[] };
  backend?: { path?: string; modules?: string[]; apiRoutes?: string[]; services?: string[]; dataLayer?: string[]; tools?: string[]; configFiles?: string[] };
  tests?: { path?: string; modules?: string[]; testFiles?: string[]; testDirs?: string[]; coverage?: boolean };
  docs?: { path?: string; modules?: string[]; readmeFiles?: string[]; docDirs?: string[]; apiDocs?: string[] };
  scripts?: { path?: string; scripts?: string[]; available?: string[]; categories?: Record<string, string[]> };
  generated?: { path?: string; artifacts?: string[] };
  artifacts?: { buildOutputs?: string[]; coverage?: string[]; logs?: string[]; cache?: string[] };
}

interface RepoMapPanelProps {
  repoMap?: RepoMapData;
  loading?: boolean;
}

export const RepoMapPanel: React.FC<RepoMapPanelProps> = ({ repoMap, loading = false }) => {
  if (!repoMap && !loading) return null;

  const flattenItems = (...groups: Array<string[] | undefined>) =>
    groups.flatMap((group) => group || []);

  const sections = [
    {
      title: 'Frontend',
      icon: <FolderPlus className="w-4 h-4" />,
      color: 'blue',
      path: repoMap?.frontend?.path || repoMap?.frontend?.rootDir || 'ui',
      items: flattenItems(
        repoMap?.frontend?.modules,
        repoMap?.frontend?.components,
        repoMap?.frontend?.pages,
        repoMap?.frontend?.utilities,
        repoMap?.frontend?.configFiles
      ),
    },
    {
      title: 'Backend',
      icon: <Zap className="w-4 h-4" />,
      color: 'amber',
      path: repoMap?.backend?.path || 'src',
      items: flattenItems(
        repoMap?.backend?.modules,
        repoMap?.backend?.apiRoutes,
        repoMap?.backend?.services,
        repoMap?.backend?.dataLayer,
        repoMap?.backend?.tools,
        repoMap?.backend?.configFiles
      ),
    },
    {
      title: 'Tests',
      icon: <FileText className="w-4 h-4" />,
      color: 'emerald',
      path: repoMap?.tests?.path || 'tests',
      items: flattenItems(repoMap?.tests?.modules, repoMap?.tests?.testFiles, repoMap?.tests?.testDirs),
    },
    {
      title: 'Docs',
      icon: <BookOpen className="w-4 h-4" />,
      color: 'violet',
      path: repoMap?.docs?.path || 'docs',
      items: flattenItems(repoMap?.docs?.modules, repoMap?.docs?.readmeFiles, repoMap?.docs?.docDirs, repoMap?.docs?.apiDocs),
    },
    {
      title: 'Scripts',
      icon: <FolderOpen className="w-4 h-4" />,
      color: 'cyan',
      path: repoMap?.scripts?.path || 'package.json',
      items: flattenItems(repoMap?.scripts?.scripts, repoMap?.scripts?.available),
    },
    {
      title: 'Generated',
      icon: <Archive className="w-4 h-4" />,
      color: 'slate',
      path: repoMap?.generated?.path || 'artifacts',
      items: flattenItems(
        repoMap?.generated?.artifacts,
        repoMap?.artifacts?.buildOutputs,
        repoMap?.artifacts?.coverage,
        repoMap?.artifacts?.logs,
        repoMap?.artifacts?.cache
      ),
    },
  ];

  const colorClasses: Record<string, string> = {
    blue: 'from-blue-950 to-blue-900 border-blue-700/40 text-blue-300',
    amber: 'from-amber-950 to-amber-900 border-amber-700/40 text-amber-300',
    emerald: 'from-emerald-950 to-emerald-900 border-emerald-700/40 text-emerald-300',
    violet: 'from-violet-950 to-violet-900 border-violet-700/40 text-violet-300',
    cyan: 'from-cyan-950 to-cyan-900 border-cyan-700/40 text-cyan-300',
    slate: 'from-slate-800 to-slate-900 border-slate-700/40 text-slate-300',
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl mb-8">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-700">
        <FolderOpen className="w-5 h-5 text-cyan-400" />
        <h2 className="text-lg font-bold text-white">Repository Map</h2>
        <span className="ml-auto text-xs bg-cyan-500/20 text-cyan-300 px-3 py-1 rounded-full border border-cyan-500/30">
          Project Structure
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-500 border-t-cyan-400"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map((section) => {
            const colorClass = colorClasses[section.color];
            const modules = section.items;
            const path = section.path;

            return (
              <div
                key={section.title}
                className={`bg-gradient-to-br ${colorClass} border rounded-lg p-4 transition-all hover:shadow-lg`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-white/10 rounded">
                    {section.icon}
                  </div>
                  <h3 className="text-sm font-semibold text-white">{section.title}</h3>
                  <span className="ml-auto text-xs font-mono bg-white/10 px-2 py-0.5 rounded">
                    {modules.length}
                  </span>
                </div>

                {path && (
                  <p className="text-xs text-white/60 font-mono mb-2 truncate">
                    {path}
                  </p>
                )}

                {modules.length > 0 ? (
                  <div className="space-y-1">
                    {modules.slice(0, 5).map((module, idx) => (
                      <div key={idx} className="text-xs text-white/70 pl-2 border-l border-white/20 truncate">
                        📄 {module}
                      </div>
                    ))}
                    {modules.length > 5 && (
                      <div className="text-xs text-white/50 pl-2 border-l border-white/20 italic pt-1">
                        +{modules.length - 5} more...
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-white/40 italic">No items</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

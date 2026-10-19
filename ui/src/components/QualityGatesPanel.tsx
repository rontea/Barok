/**
 * Quality Gates Panel - Phase 8.8
 * Displays all quality gates (8.1-8.7) with status, findings, and recommendations
 */

import React, { useState } from 'react';

export interface GateResult {
  gateId: string;
  gateName: string;
  passed: boolean;
  status: 'passed' | 'failed' | 'warning';
  score: number;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  findings: string[];
  recommendations: string[];
  details: Record<string, unknown>;
}

export interface QualityGateAssessment {
  taskId: string;
  timestamp: number;
  gates: GateResult[];
  overallScore: number;
  overallStatus: 'passed' | 'failed' | 'warning' | 'critical';
  passRate: number;
  criticalFindings: string[];
  blockingIssues: string[];
  topRecommendations: string[];
  gatesPassedCount: number;
  gatesWarningCount: number;
  gatesFailedCount: number;
  createdAt: number;
  assessmentId: string;
}

interface QualityGatesPanelProps {
  assessment: QualityGateAssessment;
  onDrillDown?: (gateId: string) => void;
  isLoading?: boolean;
}

interface ExpandedGates {
  [gateId: string]: boolean;
}

/**
 * Get status icon and color based on gate status
 */
function getStatusIndicator(status: string): { icon: string; color: string; label: string } {
  switch (status) {
    case 'passed':
      return { icon: '✅', color: '#10b981', label: 'Passed' };
    case 'warning':
      return { icon: '⚠️', color: '#f59e0b', label: 'Warning' };
    case 'failed':
      return { icon: '❌', color: '#ef4444', label: 'Failed' };
    case 'critical':
      return { icon: '🔴', color: '#dc2626', label: 'Critical' };
    default:
      return { icon: '❓', color: '#6b7280', label: 'Unknown' };
  }
}

/**
 * Get severity badge color
 */
function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return '#dc2626';
    case 'high':
      return '#f97316';
    case 'medium':
      return '#eab308';
    case 'low':
      return '#22c55e';
    case 'info':
      return '#3b82f6';
    default:
      return '#6b7280';
  }
}

/**
 * Quality Gates Panel Component
 */
const QualityGatesPanel: React.FC<QualityGatesPanelProps> = ({
  assessment,
  onDrillDown,
  isLoading
}) => {
  const [expandedGates, setExpandedGates] = useState<ExpandedGates>({});

  const toggleGateExpansion = (gateId: string) => {
    setExpandedGates(prev => ({
      ...prev,
      [gateId]: !prev[gateId]
    }));
  };

  const overallIndicator = getStatusIndicator(assessment.overallStatus);

  if (isLoading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <div>Loading quality gates assessment...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Overall Status Header */}
      <div style={{
        backgroundColor: '#f3f4f6',
        border: `2px solid ${overallIndicator.color}`,
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <span style={{ fontSize: '24px' }}>{overallIndicator.icon}</span>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1f2937' }}>
              Overall Quality: {overallIndicator.label}
            </div>
            <div style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
              Assessment ID: {assessment.assessmentId}
            </div>
          </div>
        </div>

        {/* Score and Pass Rate */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
          <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Overall Score</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: overallIndicator.color }}>
              {assessment.overallScore}/100
            </div>
          </div>
          <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px' }}>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Gates Passed</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>
              {assessment.gatesPassedCount}/{assessment.gates.length}
            </div>
          </div>
        </div>
      </div>

      {/* Critical Issues */}
      {assessment.blockingIssues.length > 0 && (
        <div style={{
          backgroundColor: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#991b1b', marginBottom: '8px' }}>
            🔴 Blocking Issues
          </div>
          <ul style={{ margin: '0', paddingLeft: '20px', fontSize: '13px', color: '#7f1d1d' }}>
            {assessment.blockingIssues.map((issue, idx) => (
              <li key={idx} style={{ marginBottom: '4px' }}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Gates Grid */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1f2937', marginBottom: '12px' }}>
          Quality Gates
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '12px'
        }}>
          {assessment.gates.map(gate => {
            const indicator = getStatusIndicator(gate.status);
            const isExpanded = expandedGates[gate.gateId];

            return (
              <div
                key={gate.gateId}
                style={{
                  border: `1px solid ${indicator.color}`,
                  borderRadius: '6px',
                  overflow: 'hidden',
                  backgroundColor: 'white',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
              >
                {/* Gate Header */}
                <div
                  onClick={() => toggleGateExpansion(gate.gateId)}
                  style={{
                    padding: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#f9fafb',
                    borderBottom: isExpanded ? `1px solid ${indicator.color}` : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{indicator.icon}</span>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#1f2937', fontSize: '14px' }}>
                        {gate.gateName}
                      </div>
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        Score: {gate.score}/100
                      </div>
                    </div>
                  </div>
                  <span style={{ color: '#999', fontSize: '12px' }}>
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </div>

                {/* Gate Details (Expanded) */}
                {isExpanded && (
                  <div style={{ padding: '12px', borderTop: `1px solid #e5e7eb`, fontSize: '13px' }}>
                    {/* Severity Badge */}
                    <div style={{ marginBottom: '8px' }}>
                      <span style={{
                        display: 'inline-block',
                        backgroundColor: getSeverityColor(gate.severity),
                        color: 'white',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        textTransform: 'uppercase'
                      }}>
                        {gate.severity}
                      </span>
                    </div>

                    {/* Findings */}
                    {gate.findings.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontWeight: 'bold', color: '#1f2937', marginBottom: '4px' }}>
                          Findings:
                        </div>
                        <ul style={{ margin: '0', paddingLeft: '16px', color: '#4b5563' }}>
                          {gate.findings.map((finding, idx) => (
                            <li key={idx} style={{ marginBottom: '2px' }}>{finding}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Recommendations */}
                    {gate.recommendations.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontWeight: 'bold', color: '#1f2937', marginBottom: '4px' }}>
                          Recommendations:
                        </div>
                        <ul style={{ margin: '0', paddingLeft: '16px', color: '#4b5563' }}>
                          {gate.recommendations.slice(0, 3).map((rec, idx) => (
                            <li key={idx} style={{ marginBottom: '2px' }}>{rec}</li>
                          ))}
                          {gate.recommendations.length > 3 && (
                            <li style={{ color: '#999', fontStyle: 'italic' }}>
                              +{gate.recommendations.length - 3} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Drill-Down Button */}
                    {onDrillDown && (
                      <button
                        onClick={() => onDrillDown(gate.gateId)}
                        style={{
                          marginTop: '8px',
                          padding: '6px 12px',
                          backgroundColor: indicator.color,
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}
                      >
                        View Details
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Recommendations Section */}
      {assessment.topRecommendations.length > 0 && (
        <div style={{
          backgroundColor: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '6px',
          padding: '12px'
        }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#1e40af', marginBottom: '8px' }}>
            💡 Top Recommendations
          </div>
          <ol style={{ margin: '0', paddingLeft: '20px', fontSize: '13px', color: '#1e3a8a' }}>
            {assessment.topRecommendations.map((rec, idx) => (
              <li key={idx} style={{ marginBottom: '4px' }}>{rec}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Gate Summary Stats */}
      <div style={{
        marginTop: '16px',
        paddingTop: '12px',
        borderTop: '1px solid #e5e7eb',
        fontSize: '12px',
        color: '#666'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto', gap: '24px' }}>
          <div>
            <span style={{ color: '#10b981', fontWeight: 'bold' }}>✅</span> {assessment.gatesPassedCount} Passed
          </div>
          <div>
            <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>⚠️</span> {assessment.gatesWarningCount} Warnings
          </div>
          <div>
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>❌</span> {assessment.gatesFailedCount} Failed
          </div>
        </div>
      </div>
    </div>
  );
};

export default QualityGatesPanel;

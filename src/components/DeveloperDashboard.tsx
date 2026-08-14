import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, limit, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchDeveloperMetrics, recordDeveloperActivity, runDeveloperDiagnostics, setDeveloperMaintenanceMode } from '../utils/developerToolsApi';
import { formatDateTime } from '../utils';
import { 
  Cpu, HardDrive, RefreshCw, Trash2, ShieldAlert, CheckCircle, Database, 
  Users, Calendar, Clock, ClipboardList, Server,
  ToggleLeft, ToggleRight, AlertCircle, RefreshCw as SpinnerIcon
} from 'lucide-react';

export type DevTab = 
  | 'system_overview'
  | 'app_version'
  | 'firebase_status'
  | 'storage_monitor'
  | 'user_count'
  | 'patient_count'
  | 'appointment_count'
  | 'visit_count'
  | 'audit_logs'
  | 'error_logs'
  | 'refresh_settings'
  | 'clear_cache'
  | 'maintenance_mode';

interface DeveloperDashboardProps {
  currentTab: DevTab;
  onTabChange: (tab: DevTab) => void;
  branding: any;
  onRefreshBranding: () => Promise<void>;
}

export default function DeveloperDashboard({ 
  currentTab, 
  onTabChange, 
  branding,
  onRefreshBranding
}: DeveloperDashboardProps) {
  // Collection counts states
  const [userCount, setUserCount] = useState<number | null>(null);
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [appointmentCount, setAppointmentCount] = useState<number | null>(null);
  const [visitCount, setVisitCount] = useState<number | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Firestore & Firebase logs / testing states
  const [latency, setLatency] = useState<number | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [recentAuditLogs, setRecentAuditLogs] = useState<any[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [auditLogsError, setAuditLogsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessionErrors, setSessionErrors] = useState<string[]>([]);
  const [isTogglingMaintenance, setIsTogglingMaintenance] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ action: () => Promise<void> | void; title: string; message: string; confirmLabel: string } | null>(null);

  const confirmAction = (action: () => Promise<void> | void, title: string, message: string, confirmLabel: string) => {
    setPendingAction({ action, title, message, confirmLabel });
  };

  const handleConfirm = async () => {
    if (pendingAction) {
      await pendingAction.action();
    }
    setPendingAction(null);
  };

  // Fetch trusted server-side collection counts without downloading records.
  const fetchCounts = async () => {
    setLoadingStats(true);
    setMetricsError(null);
    try {
      const metrics = await fetchDeveloperMetrics();
      setUserCount(metrics.users);
      setPatientCount(metrics.patients);
      setAppointmentCount(metrics.appointments);
      setVisitCount(metrics.visits);
    } catch (error) {
      console.error("Error fetching telemetry counts", error);
      setMetricsError(error instanceof Error ? error.message : 'Unable to load collection metrics.');
    } finally {
      setLoadingStats(false);
    }
  };

  // Test Firebase connection latency
  const testConnection = async () => {
    setTestingConnection(true);
    setDiagnosticError(null);
    try {
      const result = await runDeveloperDiagnostics();
      setLatency(result.firestoreLatencyMs);
      setServerTime(result.serverTime);
      setNotice(`Firestore diagnostic completed in ${result.firestoreLatencyMs} ms.`);
    } catch (error) {
      console.error("Firebase Diagnostic Test failed", error);
      setLatency(-1);
      setDiagnosticError(error instanceof Error ? error.message : 'The diagnostic request failed.');
    } finally {
      setTestingConnection(false);
    }
  };

  // Fetch recent audit logs for Support view
  const fetchAuditLogs = async () => {
    setLoadingAuditLogs(true);
    setAuditLogsError(null);
    try {
      const qLogs = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(15));
      const snap = await getDocs(qLogs);
      setRecentAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      
    } catch (error) {
      console.error("Failed to load audit logs", error);
      setAuditLogsError(error instanceof Error ? error.message : 'Unable to load recent audit entries.');
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  // Capture browser errors for this Developer Tools session. These are local
  // diagnostics, not a replacement for production error monitoring.
  useEffect(() => {
    const recordError = (message: string) => setSessionErrors(previous => [
      `${new Date().toISOString()} — ${message.slice(0, 500)}`,
      ...previous,
    ].slice(0, 50));
    const onError = (event: ErrorEvent) => recordError(event.message || 'Unknown browser error');
    const onRejection = (event: PromiseRejectionEvent) => recordError(
      event.reason instanceof Error ? event.reason.message : 'Unhandled promise rejection'
    );
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // Handle Maintenance mode toggle
  const toggleMaintenanceMode = async () => {
    setIsTogglingMaintenance(true);
    const targetStatus = !branding.maintenanceMode;
    try {
      await setDeveloperMaintenanceMode(targetStatus);
      await onRefreshBranding();
      setNotice(`Maintenance mode is now ${targetStatus ? 'enabled' : 'disabled'}.`);
    } catch (error: any) {
      setNotice(`Maintenance mode was not changed: ${error.message}`);
    } finally {
      setIsTogglingMaintenance(false);
    }
  };

  // Refresh App Settings
  const triggerRefreshSettings = async () => {
    try {
      await onRefreshBranding();
      setNotice('Application settings were refreshed.');
    } catch (error: any) {
      setNotice(`Settings refresh was unsuccessful: ${error.message}`);
      return;
    }
    try {
      await recordDeveloperActivity('developer_settings_refreshed');
    } catch (error) {
      console.error('Developer settings refresh audit failed', error);
      setNotice('Application settings were refreshed, but the audit entry could not be saved.');
    }
  };

  // Clear Session & cache
  const triggerClearCache = async () => {
    try {
      const removableLocalKeys = Object.keys(localStorage).filter(key => key.startsWith('vine-'));
      const removableSessionKeys = Object.keys(sessionStorage).filter(key => key.startsWith('vine-'));
      removableLocalKeys.forEach(key => localStorage.removeItem(key));
      removableSessionKeys.forEach(key => sessionStorage.removeItem(key));
      setNotice(`Cleared ${removableLocalKeys.length + removableSessionKeys.length} Vine browser-storage entries. Authentication and unrelated browser data were left intact.`);
      try {
        await recordDeveloperActivity('developer_cache_cleared');
      } catch (error) {
        console.error('Developer cache clear audit failed', error);
        setNotice(`Cleared ${removableLocalKeys.length + removableSessionKeys.length} Vine browser-storage entries, but the audit entry could not be saved.`);
      }
    } catch (error: any) {
      setNotice(`Browser storage was not cleared: ${error.message}`);
    }
  };

  // Simulate exception for troubleshooting testing
  const triggerSimulateError = async () => {
    const errorMsg = `Manual error-capture test at ${new Date().toISOString()}`;
    setSessionErrors(prev => [errorMsg, ...prev]);
    try {
      await recordDeveloperActivity('developer_fault_simulated');
      setNotice('A local error-capture test was added to this browser session.');
    } catch (error) {
      setNotice(`The local test ran, but its audit entry could not be saved: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Helper menu values
  const menuItems: { id: DevTab; label: string; icon: any; description: string }[] = [
    { id: 'system_overview', label: 'System Overview', icon: Cpu, description: 'Runtime and browser context' },
    { id: 'app_version', label: 'App Version', icon: ClipboardList, description: 'Build and configuration metadata' },
    { id: 'firebase_status', label: 'Firebase Status', icon: Server, description: 'Trusted Firestore diagnostics' },
    { id: 'storage_monitor', label: 'Storage Monitor', icon: HardDrive, description: 'Vine-owned browser storage only' },
    { id: 'user_count', label: 'User Count', icon: Users, description: 'All user-profile documents' },
    { id: 'patient_count', label: 'Patient Count', icon: Users, description: 'All patient documents' },
    { id: 'appointment_count', label: 'Appointment Count', icon: Calendar, description: 'All appointment documents' },
    { id: 'visit_count', label: 'Visit Count', icon: Clock, description: 'All visit documents' },
    { id: 'audit_logs', label: 'Audit Logs', icon: Database, description: 'Latest audit-entry preview' },
    { id: 'error_logs', label: 'Error Logs', icon: ShieldAlert, description: 'Current browser-session errors' },
    { id: 'refresh_settings', label: 'Refresh Settings', icon: RefreshCw, description: 'Reload current branding configuration' },
    { id: 'clear_cache', label: 'Clear Cache', icon: Trash2, description: 'Remove Vine-owned browser storage' },
    { id: 'maintenance_mode', label: 'Maintenance Mode', icon: ShieldAlert, description: 'Restrict access during service work' }
  ];

  return (
    <div className="bg-slate-50 min-h-screen p-6 space-y-6">
      {/* Page Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-[10px] uppercase tracking-wider font-bold text-teal-650 bg-teal-50 border border-teal-100 px-2 py-1 rounded">
            Technical Support Space
          </span>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight mt-1">Developer Tools</h2>
          <p className="text-slate-500 text-xs">Diagnostic access suite for system health mapping & maintenance.</p>
        </div>
        <div className="flex gap-2">
          {branding.maintenanceMode && (
            <span className="bg-amber-100 text-amber-800 border border-amber-200 px-3 py-1.5 rounded-xl text-xs font-bold animate-pulse flex items-center gap-1.5">
              <AlertCircle size={14} /> Systems Under Maintenance
            </span>
          )}
          <button 
            onClick={fetchCounts} 
            className="px-3.5 py-2 bg-slate-100 text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-200 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <RefreshCw size={14} className={loadingStats ? "animate-spin" : ""} /> Refresh Telemetry
          </button>
        </div>
      </div>
      {notice && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs text-teal-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold text-teal-700 hover:text-teal-900" aria-label="Dismiss status message">Dismiss</button>
        </div>
      )}

      {/* Main Grid: Nav on side, Panel on right */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Nav List */}
        <div className="lg:col-span-1 bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm h-fit space-y-1.5">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block px-3 mb-2">Diagnostic Modules</span>
          <div className="space-y-1">
            {menuItems.map(item => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-start gap-3 w-full text-left px-3 py-2.5 rounded-xl transition group ${
                    isActive 
                      ? 'bg-slate-850 text-white shadow-sm font-semibold' 
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                  style={isActive ? { backgroundColor: branding.primaryColor || '#0d9488' } : undefined}
                >
                  <Icon size={16} className={`shrink-0 mt-0.5 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-650'}`} />
                  <div>
                    <p className="text-xs font-semibold leading-none">{item.label}</p>
                    <p className={`text-[10px] mt-0.5 truncate max-w-[170px] ${isActive ? 'text-teal-100' : 'text-slate-400'}`}>{item.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* View Layout */}
        <div className="lg:col-span-3 bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm min-h-[460px]">
          
          {/* Module 1: System Overview */}
          {currentTab === 'system_overview' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">System Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Framework Runtime</span>
                  <p className="font-mono text-xs text-slate-800 mt-2">React application • Vite build • Tailwind CSS</p>
                </div>
                <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Local System Time</span>
                  <p className="font-mono text-xs text-slate-800 mt-2">{formatDateTime(new Date())}</p>
                </div>
                <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Platform Context</span>
                  <p className="font-mono text-xs text-slate-800 mt-2 truncate">{typeof navigator !== 'undefined' ? navigator.platform : 'Unknown platform'}</p>
                </div>
                <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">User Language & Agent</span>
                  <p className="font-mono text-xs text-slate-800 mt-2 truncate">{typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown Node Runtime'}</p>
                </div>
              </div>
            </div>
          )}

          {/* Module 2: App Version */}
          {currentTab === 'app_version' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">App Version</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 py-2">
                  <span className="text-xs font-semibold text-slate-500">Application Build</span>
                  <span className="font-mono text-xs text-slate-800">Current deployment</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-2">
                  <span className="text-xs font-semibold text-slate-500">Support Access</span>
                  <span className="bg-teal-50 text-teal-700 text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded border border-teal-100">SUPPORT DEVELOPER</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-2">
                  <span className="text-xs font-semibold text-slate-500">Build Pipeline</span>
                  <span className="font-mono text-xs text-slate-800">Vite-managed web build</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-2">
                  <span className="text-xs font-semibold text-slate-500">Branding Status</span>
                  <span className="font-mono text-xs text-slate-850 font-bold">{branding.appShortName || branding.appName} (White Label Layer active)</span>
                </div>
              </div>
            </div>
          )}

          {/* Module 3: Firebase Status */}
          {currentTab === 'firebase_status' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">Firebase Connection Diagnostics</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Database Target</span>
                    <p className="font-mono text-xs text-slate-800 mt-2 truncate">Configured Firestore database</p>
                  </div>
                  <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Authentication Mode</span>
                    <p className="font-mono text-xs text-slate-800 mt-2">Sign-In with Google Popup Integration</p>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-slate-700">Trusted Firestore Read Latency</p>
                    <p className="text-xs text-slate-500 mt-0.5">Measured from the application server to Firestore.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {testingConnection ? (
                      <span className="text-xs text-slate-400 font-semibold flex items-center gap-1"><SpinnerIcon size={12} className="animate-spin" /> Measuring...</span>
                    ) : latency === -1 ? (
                      <span className="text-red-500 font-bold text-xs">Failed</span>
                    ) : latency !== null ? (
                      <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-1 rounded border border-teal-150">{latency} ms</span>
                    ) : (
                      <span className="text-xs text-slate-400">Not Measured</span>
                    )}
                  </div>
                </div>
                {serverTime && (
                  <p className="text-[11px] text-slate-400">Last server response: {formatDateTime(serverTime)}</p>
                )}
                {diagnosticError && (
                  <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{diagnosticError}</p>
                )}

                <button 
                  onClick={testConnection}
                  disabled={testingConnection}
                  className="px-4 py-2 bg-teal-650 hover:bg-teal-750 text-white rounded-lg text-xs font-semibold flex items-center gap-1 pb-2 pt-2"
                  style={{ backgroundColor: branding.primaryColor || '#0d9488' }}
                >
                  <SpinnerIcon size={12} className={testingConnection ? "animate-spin" : ""} /> Run Ping Diagnostics
                </button>
              </div>
            </div>
          )}

          {/* Module 4: Storage Monitor */}
          {currentTab === 'storage_monitor' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">Vine Browser Storage</h3>
              <div className="space-y-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Vine-owned Cached Keys</span>
                <div className="divide-y divide-slate-100">
                  {typeof window !== 'undefined' && Object.keys(localStorage).filter(key => key.startsWith('vine-')).length > 0 ? (
                    Object.keys(localStorage).filter(key => key.startsWith('vine-')).map(key => (
                      <div key={key} className="flex justify-between items-center py-2 text-xs">
                        <span className="font-mono text-slate-600">{key}</span>
                        <span className="text-slate-400 font-mono">{(localStorage.getItem(key)?.length || 0)} chars</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-400 text-xs py-2">No Vine-owned keys found in browser storage.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Module 5-8: Real Collection Document Telemetries */}
          {(['user_count', 'patient_count', 'appointment_count', 'visit_count'].includes(currentTab)) && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2 capitalize">{currentTab.replace('_', ' ')} Diagnostics</h3>
              <p className="text-xs text-slate-500">Counts are aggregated server-side and include all documents in the selected collection.</p>
              
              <div className="bg-slate-50 p-6 rounded-2xl flex flex-col justify-center items-center py-10 border border-slate-150 select-none">
                {loadingStats ? (
                  <div className="flex flex-col items-center gap-2">
                    <SpinnerIcon size={24} className="text-teal-600 animate-spin" style={{ color: branding.primaryColor || '#0d9488' }} />
                    <p className="text-xs text-slate-400 font-bold uppercase">Fetching aggregate metrics...</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-5xl font-mono font-extrabold text-slate-800">
                      {currentTab === 'user_count' && (userCount ?? 'N/A')}
                      {currentTab === 'patient_count' && (patientCount ?? 'N/A')}
                      {currentTab === 'appointment_count' && (appointmentCount ?? 'N/A')}
                      {currentTab === 'visit_count' && (visitCount ?? 'N/A')}
                    </p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Documents Registered</p>
                  </div>
                )}
              </div>
              {metricsError && (
                <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{metricsError}</p>
              )}
            </div>
          )}

          {/* Module 9: Audit Logs */}
          {currentTab === 'audit_logs' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="text-md font-bold text-slate-800">Latest Audit Entries</h3>
                <button 
                  onClick={fetchAuditLogs} 
                  disabled={loadingAuditLogs} 
                  className="px-2.5 py-1 text-[10px] uppercase font-bold text-teal-650 bg-teal-50 border border-teal-100 rounded hover:bg-teal-100 transition"
                  style={{ color: branding.primaryColor || '#0d9488' }}
                >
                  Fetch Fresh Log Entries
                </button>
              </div>

              {loadingAuditLogs ? (
                <div className="flex flex-col py-20 items-center justify-center gap-2">
                  <SpinnerIcon size={20} className="text-teal-600 animate-spin" style={{ color: branding.primaryColor || '#0d9488' }} />
                  <p className="text-xs text-slate-400 font-bold uppercase">Loading active trial ledger...</p>
                </div>
              ) : recentAuditLogs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-50 text-slate-400">
                      <tr>
                        <th className="px-2 py-1.5 uppercase font-bold">Time</th>
                        <th className="px-2 py-1.5 uppercase font-bold">User</th>
                        <th className="px-2 py-1.5 uppercase font-bold">Action</th>
                        <th className="px-2 py-1.5 uppercase font-bold">Resource</th>
                        <th className="px-2 py-1.5 uppercase font-bold">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentAuditLogs.map(log => (
                        <tr key={log.id} className="hover:bg-slate-50/50 py-1.5 text-[10px] text-slate-700">
                          <td className="px-2 py-1.5 truncate max-w-[140px]" title={log.timestamp}>{formatDateTime(log.timestamp)}</td>
                          <td className="px-2 py-1.5 truncate max-w-[80px]" title={log.userEmail}>{log.userEmail}</td>
                          <td className="px-2 py-1.5 font-bold"><span className={log.action === 'DELETE' ? 'text-red-500' : 'text-teal-750'}>{log.action}</span></td>
                          <td className="px-2 py-1.5">{log.resource}</td>
                          <td className="px-2 py-1.5 truncate max-w-[200px]" title={log.details}>{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-slate-400 text-xs py-10 text-center select-none">No audit entries loaded. Use the main Audit Trail for full search and export.</p>
              )}
              {auditLogsError && (
                <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{auditLogsError}</p>
              )}
            </div>
          )}

          {/* Module 10: Error Logs */}
          {currentTab === 'error_logs' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="text-md font-bold text-slate-800">Support Session Error Capture</h3>
                <button 
                  onClick={triggerSimulateError}
                  className="px-2.5 py-1 text-[10px] uppercase font-bold text-teal-650 bg-teal-50 border border-teal-100 rounded hover:bg-teal-100 transition"
                  style={{ color: branding.primaryColor || '#0d9488' }}
                >
                  Trigger Fault simulation
                </button>
              </div>
              <p className="text-xs text-slate-500">Captures browser errors and unhandled promise rejections during this open support session. It is not persistent production error monitoring.</p>

              {sessionErrors.length > 0 ? (
                <div className="space-y-2">
                  {sessionErrors.map((err, i) => (
                    <div key={i} className="bg-red-50 text-red-700 border border-red-150 p-3 rounded-lg text-xs font-mono break-all font-semibold select-all">
                      {err}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center">
                  <div className="h-8 w-8 bg-teal-50 border border-teal-100 text-teal-600 rounded-full flex items-center justify-center mx-auto mb-2 select-none">
                    <CheckCircle size={14} />
                  </div>
                  <p className="text-slate-500 font-bold text-xs uppercase tracking-wider">Session Stable</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">No browser errors or unhandled promise rejections captured in this session.</p>
                </div>
              )}
            </div>
          )}

          {/* Module 11: Refresh App Settings */}
          {currentTab === 'refresh_settings' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">Sync App Branding</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Loads the global whitelist configuration, design specifications, branding elements (App short names, logo urls, themes, footer legal blocks) from Firestore directly. Use this module to override temporary UI lags.</p>
              <button 
                onClick={triggerRefreshSettings}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 select-none"
                style={{ backgroundColor: branding.primaryColor || '#0d9488' }}
              >
                <SpinnerIcon size={14} /> Pull Global Configurations
              </button>
            </div>
          )}

          {/* Module 12: Clear Cache */}
          {currentTab === 'clear_cache' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">Purge Client Cache</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Removes only browser-storage entries whose key begins with <span className="font-mono">vine-</span>. Authentication and unrelated browser data are not changed; Firestore records are unaffected.</p>
              <button 
                onClick={() => confirmAction(
                  triggerClearCache,
                  'Clear Vine browser storage?',
                  'Only browser-storage keys that belong to Vine will be removed. Authentication and server records are not affected.',
                  'Clear storage'
                )}
                className="px-4 py-2 bg-red-650 hover:bg-red-750 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 select-none"
              >
                <Trash2 size={14} /> Clear Vine Browser Storage
              </button>
            </div>
          )}

          {/* Module 13: Maintenance Mode */}
          {currentTab === 'maintenance_mode' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">Global Maintenance Gate Changer</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Activating this restricts access to {branding.appName || 'the patient records app'}. Only Administrators and Support users can continue; staff, doctors, and managers are redirected to the maintenance notice to prevent active form submissions.</p>
              
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-150 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-800 uppercase tracking-wide">Maintenance Mode Gate Status</p>
                  <p className="text-xs text-slate-500 mt-1">Status changes write instantly and trigger synchronous web state lockdown.</p>
                </div>
                <button 
                  onClick={() => confirmAction(
                    toggleMaintenanceMode,
                    branding.maintenanceMode ? 'Disable maintenance mode?' : 'Enable maintenance mode?',
                    branding.maintenanceMode
                      ? 'Normal access will be restored for clinic users.'
                      : 'Clinic users other than administrators and support developers will be shown the maintenance notice.',
                    branding.maintenanceMode ? 'Disable maintenance' : 'Enable maintenance'
                  )}
                  disabled={isTogglingMaintenance}
                  className={`px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm flex items-center gap-1.5 transition ${
                    branding.maintenanceMode 
                      ? 'bg-amber-600 text-white hover:bg-amber-700' 
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                  }`}
                >
                  {isTogglingMaintenance ? (
                    <SpinnerIcon size={14} className="animate-spin" />
                  ) : branding.maintenanceMode ? (
                    <>
                      <ToggleRight size={18} className="text-white" /> Enabled (Lockdown On)
                    </>
                  ) : (
                    <>
                      <ToggleLeft size={18} className="text-slate-500" /> Disabled (Live Open)
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
      
      {pendingAction && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="text-lg font-bold text-slate-800">{pendingAction.title}</h3>
            <p className="text-sm text-slate-600">
              {pendingAction.message}
            </p>
            <div className="flex gap-2 justify-end">
              <button 
                onClick={() => setPendingAction(null)}
                className="px-4 py-2 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirm}
                className="px-4 py-2 bg-teal-650 rounded-lg text-xs font-semibold text-white hover:bg-teal-750"
                  style={{ backgroundColor: branding.primaryColor || '#0d9488' }}
              >
                {pendingAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, writeBatch, query, limit, orderBy } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { logActivity } from '../utils/auditLogger';
import { handleFirestoreError, OperationType } from '../utils';
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
  userRole: string | null;
}

export default function DeveloperDashboard({ 
  currentTab, 
  onTabChange, 
  branding, 
  onRefreshBranding,
  userRole
}: DeveloperDashboardProps) {
  // Collection counts states
  const [userCount, setUserCount] = useState<number | null>(null);
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [appointmentCount, setAppointmentCount] = useState<number | null>(null);
  const [visitCount, setVisitCount] = useState<number | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Firestore & Firebase logs / testing states
  const [latency, setLatency] = useState<number | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [recentAuditLogs, setRecentAuditLogs] = useState<any[]>([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);
  const [sessionErrors, setSessionErrors] = useState<string[]>([]);
  const [isTogglingMaintenance, setIsTogglingMaintenance] = useState(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void> | void) | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const confirmAction = (action: () => Promise<void> | void) => {
    setPendingAction(() => action);
    setShowConfirmation(true);
  };

  const handleConfirm = async () => {
    if (pendingAction) {
      await pendingAction();
    }
    setPendingAction(null);
    setShowConfirmation(false);
  };

  // Fetch counts from Firestore
  const fetchCounts = async () => {
    setLoadingStats(true);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const patientsSnap = await getDocs(collection(db, 'patients'));
      const appointmentsSnap = await getDocs(collection(db, 'appointments'));
      const visitsSnap = await getDocs(collection(db, 'visits'));

      setUserCount(usersSnap.size);
      setPatientCount(patientsSnap.size);
      setAppointmentCount(appointmentsSnap.size);
      setVisitCount(visitsSnap.size);

      // Log Support / Developer View Actions
      await logActivity({
        action: 'VIEW',
        resource: 'Settings',
        resourceId: 'developer_statistics',
        details: 'Developer Read Access: Viewed System Overview / Counts',
        userProfile: { role: userRole || 'staff' }
      });
    } catch (error) {
      console.error("Error fetching telemetry counts", error);
    } finally {
      setLoadingStats(false);
    }
  };

  // Test Firebase connection latency
  const testConnection = async () => {
    setTestingConnection(true);
    const start = performance.now();
    try {
      // Small read test
      await getDocs(query(collection(db, 'settings'), limit(1)));
      const end = performance.now();
      setLatency(Math.round(end - start));
      await logActivity({
        action: 'VIEW',
        resource: 'Settings',
        resourceId: 'firebase_diagnostics',
        details: `Developer Tools Access: Run Database Diagnostics (Latency: ${Math.round(end - start)}ms)`,
        userProfile: { role: userRole || 'staff' }
      });
    } catch (error) {
      console.error("Firebase Diagnostic Test failed", error);
      setLatency(-1);
    } finally {
      setTestingConnection(false);
    }
  };

  // Fetch recent audit logs for Support view
  const fetchAuditLogs = async () => {
    setLoadingAuditLogs(true);
    try {
      const qLogs = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(15));
      const snap = await getDocs(qLogs);
      setRecentAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      
      await logActivity({
        action: 'VIEW',
        resource: 'Settings',
        resourceId: 'developer_audit_logs',
        details: 'Developer Read Access: Viewed Audit Logs',
        userProfile: { role: userRole || 'staff' }
      });
    } catch (error) {
      console.error("Failed to load audit logs", error);
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  // Run on tab changes & session management
  useEffect(() => {
    logActivity({
      action: 'VIEW',
      resource: 'Settings',
      resourceId: 'developer_tools_session',
      details: 'Developer Tools Session Started',
      userProfile: { role: userRole || 'staff', fullName: auth.currentUser?.displayName || 'Unknown' }
    });

    return () => {
      logActivity({
        action: 'VIEW',
        resource: 'Settings',
        resourceId: 'developer_tools_session',
        details: 'Developer Tools Session Ended',
        userProfile: { role: userRole || 'staff', fullName: auth.currentUser?.displayName || 'Unknown' }
      });
    };
  }, []);

  // Handle Maintenance mode toggle
  const toggleMaintenanceMode = async () => {
    setIsTogglingMaintenance(true);
    const targetStatus = !branding.maintenanceMode;
    try {
      await updateDoc(doc(db, 'settings', 'branding'), {
        maintenanceMode: targetStatus
      });
      await logActivity({
        action: 'UPDATE',
        resource: 'Settings',
        resourceId: 'maintenance_status',
        details: `Developer Tools Access: ${targetStatus ? 'Enabled' : 'Disabled'} Maintenance Mode`,
        userProfile: { role: userRole || 'staff' }
      });
      alert(`Systems maintenance mode of Lumina Patient Portal set to: ${targetStatus ? 'ACTIVE' : 'DEACTIVATED'}`);
      await onRefreshBranding();
    } catch (error: any) {
      alert("Failed to change Maintenance control. Error: " + error.message);
    } finally {
      setIsTogglingMaintenance(false);
    }
  };

  // Refresh App Settings
  const triggerRefreshSettings = async () => {
    try {
      await onRefreshBranding();
      await logActivity({
        action: 'UPDATE',
        resource: 'Settings',
        resourceId: 'reload_white_label',
        details: 'Developer Tools Access: Refreshed App Settings',
        userProfile: { role: userRole || 'staff' }
      });
      alert("Application environment branding variables successfully synced from database.");
    } catch (error: any) {
      alert("Refresh unsuccessful. Error: " + error.message);
    }
  };

  // Clear Session & cache
  const triggerClearCache = async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      await logActivity({
        action: 'DELETE',
        resource: 'Settings',
        resourceId: 'developer_cleanup_cache',
        details: 'Developer Tools Access: Purged Browser Cache',
        userProfile: { role: userRole || 'staff' }
      });
      alert("Client session directories, cached form values & system local variables cleared cleanly.");
    } catch (error: any) {
      alert("Purge failed. Error: " + error.message);
    }
  };

  // Simulate exception for troubleshooting testing
  const triggerSimulateError = async () => {
    const errorMsg = `Exception: Manual Diagnostic Trigger - Test instance at ${new Date().toISOString()}`;
    setSessionErrors(prev => [errorMsg, ...prev]);
    await logActivity({
      action: 'CREATE',
      resource: 'Settings',
      resourceId: 'simulate_error',
      details: 'Developer Read Access: Triggered Fault Simulation',
      userProfile: { role: userRole || 'staff' }
    });
    alert("Test exceptions populated in session ledger.");
  };

  // Helper menu values
  const menuItems: { id: DevTab; label: string; icon: any; description: string }[] = [
    { id: 'system_overview', label: 'System Overview', icon: Cpu, description: 'Diagnostic parameters & environment indicators' },
    { id: 'app_version', label: 'App Version', icon: ClipboardList, description: 'Module versions and build identifiers' },
    { id: 'firebase_status', label: 'Firebase Status', icon: Server, description: 'Firestore connectivity and real-time pings' },
    { id: 'storage_monitor', label: 'Storage Monitor', icon: HardDrive, description: 'Browser local variable mapping & index sizes' },
    { id: 'user_count', label: 'User Count', icon: Users, description: 'Active clinical team logs registered' },
    { id: 'patient_count', label: 'Patient Count', icon: Users, description: 'Registered database patient items size' },
    { id: 'appointment_count', label: 'Appointment Count', icon: Calendar, description: 'Clinic booking events registry sizes' },
    { id: 'visit_count', label: 'Visit Count', icon: Clock, description: 'Logged clinical checkup session sums' },
    { id: 'audit_logs', label: 'Audit Logs', icon: Database, description: 'Complete system HIPAA compliance telemetry ledger' },
    { id: 'error_logs', label: 'Error Logs', icon: ShieldAlert, description: 'Active session diagnostics failure log catcher' },
    { id: 'refresh_settings', label: 'Refresh Settings', icon: RefreshCw, description: 'Sync white-label branding details from Cloud' },
    { id: 'clear_cache', label: 'Clear Cache', icon: Trash2, description: 'Purge browser states and temporal local variables' },
    { id: 'maintenance_mode', label: 'Maintenance Mode', icon: ShieldAlert, description: 'Safe access restriction to stop client inputs' }
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
                  onClick={() => {
                    const sensitiveTabs = ['refresh_settings', 'clear_cache', 'maintenance_mode'];
                    if (sensitiveTabs.includes(item.id)) {
                      confirmAction(() => onTabChange(item.id));
                    } else {
                      onTabChange(item.id);
                    }
                  }}
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
                  <p className="font-mono text-xs text-slate-800 mt-2">Vite 6.2.3 • React 19.0.1 • Tailwind v4.1.14</p>
                </div>
                <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Local System Time</span>
                  <p className="font-mono text-xs text-slate-800 mt-2">{new Date().toLocaleString()}</p>
                </div>
                <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Platform Context</span>
                  <p className="font-mono text-xs text-slate-800 mt-2 truncate">Chrome Webkit / Cloud Run Container</p>
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
                  <span className="text-xs font-semibold text-slate-500">Major Core Version</span>
                  <span className="font-mono text-xs text-slate-800">v1.2.4</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-2">
                  <span className="text-xs font-semibold text-slate-500">Stability Tier</span>
                  <span className="bg-teal-50 text-teal-700 text-[10px] font-extrabold tracking-wider px-2 py-0.5 rounded border border-teal-100">STABLE SUPPORT</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-100 py-2">
                  <span className="text-xs font-semibold text-slate-500">Build Channel</span>
                  <span className="font-mono text-xs text-slate-800">Production Build CJS Bundled</span>
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
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Database Instance</span>
                    <p className="font-mono text-xs text-slate-800 mt-2 truncate">ai-studio-76c2b271-46ac-4092-87c1-929bb4ca2fa3</p>
                  </div>
                  <div className="border border-slate-150 p-4 rounded-xl bg-slate-50/50">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Authentication Mode</span>
                    <p className="font-mono text-xs text-slate-800 mt-2">Sign-In with Google Popup Integration</p>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-50 p-4 rounded-xl">
                  <div>
                    <p className="text-xs font-bold text-slate-700">Firestore Read Ping Latency</p>
                    <p className="text-xs text-slate-500 mt-0.5">Calculated end-to-end communication response rate.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {testingConnection ? (
                      <span className="text-xs text-slate-400 font-semibold flex items-center gap-1"><SpinnerIcon size={12} className="animate-spin" /> Measuring...</span>
                    ) : latency === -1 ? (
                      <span className="text-red-500 font-bold text-xs">Failed</span>
                    ) : latency ? (
                      <span className="text-xs font-bold text-teal-700 bg-teal-50 px-2 py-1 rounded border border-teal-150">{latency} ms (Excellent)</span>
                    ) : (
                      <span className="text-xs text-slate-40s0">Not Measured</span>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => confirmAction(testConnection)}
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
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">Local Storage Monitor</h3>
              <div className="space-y-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase block">Cached Key Allocation</span>
                <div className="divide-y divide-slate-100">
                  {typeof window !== 'undefined' && Object.keys(localStorage).length > 0 ? (
                    Object.keys(localStorage).map(key => (
                      <div key={key} className="flex justify-between items-center py-2 text-xs">
                        <span className="font-mono text-slate-600">{key}</span>
                        <span className="text-slate-400 font-mono">{(localStorage.getItem(key)?.length || 0)} chars</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-400 text-xs py-2">No key allocations found in local storage cache.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Module 5-8: Real Collection Document Telemetries */}
          {(['user_count', 'patient_count', 'appointment_count', 'visit_count'].includes(currentTab)) && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2 capitalize">{currentTab.replace('_', ' ')} Diagnostics</h3>
              <p className="text-xs text-slate-500">Below is the registered collection telemetry count mapped in Firestore database.</p>
              
              <div className="bg-slate-50 p-6 rounded-2xl flex flex-col justify-center items-center py-10 border border-slate-150 select-none">
                {loadingStats ? (
                  <div className="flex flex-col items-center gap-2">
                    <SpinnerIcon size={24} className="text-teal-600 animate-spin" style={{ color: branding.primaryColor || '#0d9488' }} />
                    <p className="text-xs text-slate-400 font-bold uppercase">Fetching active ledger metrics...</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-5xl font-mono font-extrabold text-slate-800">
                      {currentTab === 'user_count' && (userCount ?? 'N/A')}
                      {currentTab === 'patient_count' && (patientCount ?? 'N/A')}
                      {currentTab === 'appointment_count' && (appointmentCount ?? 'N/A')}
                      {currentTab === 'visit_count' && (visitCount ?? 'N/A')}
                    </p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">Active Documents Registered</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Module 9: Audit Logs */}
          {currentTab === 'audit_logs' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="text-md font-bold text-slate-800">Administrative Logs Trail</h3>
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
                          <td className="px-2 py-1.5 truncate max-w-[100px]" title={log.timestamp}>{new Date(log.timestamp).toLocaleTimeString()}</td>
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
                <p className="text-slate-400 text-xs py-10 text-center select-none">No administrative audit entries mapped in local collection.</p>
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
              <p className="text-xs text-slate-500">Catches unhandled errors or missing/insufficient permission exceptions recorded during the active logged session.</p>

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
                  <p className="text-[10px] text-slate-400 mt-0.5">0 faults or missing permissions registered recursively since application initialization.</p>
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
                onClick={() => confirmAction(triggerRefreshSettings)} 
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
              <p className="text-xs text-slate-500 leading-relaxed">Flushes the entire storage mappings locally inside the browser. It resets current search indexes, browser states, draft record forms, and temporary diagnostic caches safely, keeping core Firestore collections persistent.</p>
              <button 
                onClick={() => confirmAction(triggerClearCache)} 
                className="px-4 py-2 bg-red-650 hover:bg-red-750 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 select-none"
              >
                <Trash2 size={14} /> Flush Browser Storage
              </button>
            </div>
          )}

          {/* Module 13: Maintenance Mode */}
          {currentTab === 'maintenance_mode' && (
            <div className="space-y-6">
              <h3 className="text-md font-bold text-slate-800 border-b pb-2">Global Maintenance Gate Changer</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Setting this to **Active** will restrict client access to Lumina Patient Records. Only Administrators and Support users will pass. Staff, doctor, and manager roles get beautifully redirected to a system upkeep page to prevent active form submittals during upgrades.</p>
              
              <div className="bg-slate-50 p-6 rounded-2xl border border-slate-150 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-800 uppercase tracking-wide">Maintenance Mode Gate Status</p>
                  <p className="text-xs text-slate-500 mt-1">Status changes write instantly and trigger synchronous web state lockdown.</p>
                </div>
                <button 
                  onClick={() => confirmAction(toggleMaintenanceMode)}
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
      
      {showConfirmation && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-sm w-full space-y-4">
            <h3 className="text-lg font-bold text-slate-800">Confirm Action</h3>
            <p className="text-sm text-slate-600">
              You are about to fetch system data. This action will be recorded in the Audit Trail. Do you want to continue?
            </p>
            <div className="flex gap-2 justify-end">
              <button 
                onClick={() => { setPendingAction(null); setShowConfirmation(false); }}
                className="px-4 py-2 bg-slate-100 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirm}
                className="px-4 py-2 bg-teal-650 rounded-lg text-xs font-semibold text-white hover:bg-teal-750"
                  style={{ backgroundColor: branding.primaryColor || '#0d9488' }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

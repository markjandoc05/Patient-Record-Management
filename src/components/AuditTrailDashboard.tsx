import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { formatInTimeZone } from 'date-fns-tz';
import {
  Activity,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileClock,
  FilterX,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Trash2,
  UserCog,
} from 'lucide-react';
import { AUDIT_QUERY_LIMIT } from '../auditPolicy';
import { useTimezone } from '../contexts/TimezoneContext';
import { db } from '../firebase';
import { getActiveDatePrefix } from '../utils/timezone';
import { formatTimezone } from '../utils/timezone';
import ConfirmationModal from './ConfirmationModal';

interface AuditTrailDashboardProps {
  role: string | null;
}

interface AuditLog {
  id: string;
  timestamp?: unknown;
  userId?: string;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  resourceName?: string;
  details?: string;
  eventType?: string;
}

const itemsPerPage = 12;

function asDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  const parsed = value instanceof Date ? value : new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function titleCase(value?: string) {
  return (value || 'staff')
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function csvCell(value: unknown) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export default function AuditTrailDashboard({ role }: AuditTrailDashboardProps) {
  const timezone = useTimezone();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [resourceFilter, setResourceFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const canViewAuditTrail = ['admin', 'support_developer'].includes(role || '');

  const loadLogs = useCallback(async (isRefresh = false) => {
    if (!canViewAuditTrail) {
      setLoading(false);
      return;
    }

    isRefresh ? setRefreshing(true) : setLoading(true);
    setLoadError('');
    try {
      const snapshot = await getDocs(query(
        collection(db, 'audit_logs'),
        orderBy('timestamp', 'desc'),
        limit(AUDIT_QUERY_LIMIT),
      ));
      setLogs(snapshot.docs
        .map(document => ({ id: document.id, ...document.data() } as AuditLog)));
    } catch (error) {
      console.error('Failed to load audit trail:', error);
      setLoadError('The audit trail could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canViewAuditTrail]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return logs.filter(log => {
      const searchable = [
        log.userEmail,
        log.userName,
        log.userId,
        log.resourceId,
        log.resourceName,
        log.details,
      ].filter(Boolean).join(' ').toLowerCase();
      const date = asDate(log.timestamp);
      const localDay = date ? formatInTimeZone(date, timezone.timezone, 'yyyy-MM-dd') : '';

      return (!normalizedSearch || searchable.includes(normalizedSearch))
        && (actionFilter === 'ALL' || log.action === actionFilter)
        && (resourceFilter === 'ALL' || log.resource === resourceFilter)
        && (!startDate || localDay >= startDate)
        && (!endDate || localDay <= endDate);
    });
  }, [actionFilter, endDate, logs, resourceFilter, searchQuery, startDate, timezone.timezone]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const firstIndex = (safeCurrentPage - 1) * itemsPerPage;
  const currentLogs = filteredLogs.slice(firstIndex, firstIndex + itemsPerPage);
  const hasFilters = Boolean(searchQuery || startDate || endDate || actionFilter !== 'ALL' || resourceFilter !== 'ALL');

  const resetFilters = () => {
    setSearchQuery('');
    setActionFilter('ALL');
    setResourceFilter('ALL');
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  const performExport = () => {
    setIsExportModalOpen(false);
    const headers = ['Timestamp', 'Actor', 'Actor email', 'Role', 'Action', 'Resource', 'Resource ID', 'Resource identifier', 'Details'];
    const rows = filteredLogs.map(log => [
      asDate(log.timestamp)?.toISOString() || '',
      log.userName || '',
      log.userEmail || '',
      titleCase(log.userRole),
      log.action || '',
      log.resource || '',
      log.resourceId || '',
      log.resourceName || '',
      log.details || '',
    ].map(csvCell).join(','));
    const blob = new Blob([[headers.map(csvCell).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const appSlug = (document.documentElement.dataset.appName || 'clinic_app')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    link.href = url;
    link.download = `${appSlug}_audit_trail_${getActiveDatePrefix()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const actionBadge = (action?: string) => {
    const styles: Record<string, string> = {
      CREATE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      UPDATE: 'border-blue-200 bg-blue-50 text-blue-700',
      DELETE: 'border-rose-200 bg-rose-50 text-rose-700',
      AUTH: 'border-violet-200 bg-violet-50 text-violet-700',
    };
    return (
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${styles[action || ''] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
        {action || 'EVENT'}
      </span>
    );
  };

  if (!canViewAuditTrail) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Shield className="mx-auto mb-4 h-11 w-11 text-rose-500" />
        <h2 className="text-xl font-bold text-slate-900">Audit trail access restricted</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Only Clinic Administrators and Support / Developers can review this workspace history.</p>
      </div>
    );
  }

  const destructiveCount = filteredLogs.filter(log => log.action === 'DELETE' || log.eventType === 'attachment_deleted').length;
  const clinicalCount = filteredLogs.filter(log => ['Patient', 'Appointment', 'Visit'].includes(log.resource || '')).length;
  const accessAndConfigCount = filteredLogs.filter(log => ['User', 'Settings', 'Branch'].includes(log.resource || '')).length;

  return (
    <div className="space-y-5">
      <ConfirmationModal
        isOpen={isExportModalOpen}
        title="Export audit trail"
        message="Export the currently filtered audit entries? The file may contain sensitive operational information and should be handled securely."
        onConfirm={performExport}
        onCancel={() => setIsExportModalOpen(false)}
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col items-start gap-3 sm:flex-row">
            <div className="rounded-xl bg-slate-900 p-2.5 text-white"><Shield className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Selective audit policy</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Records important clinical, access, archive/delete, and configuration changes. Routine views and attachment uploads are excluded, and Support / Developer activity is never recorded.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">Latest {AUDIT_QUERY_LIMIT} entries</span>
            <button type="button" onClick={() => void loadLogs(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Matching events', value: filteredLogs.length, icon: FileClock, tone: 'bg-slate-100 text-slate-700' },
          { label: 'Clinical changes', value: clinicalCount, icon: Activity, tone: 'bg-teal-50 text-teal-700' },
          { label: 'Access & settings', value: accessAndConfigCount, icon: UserCog, tone: 'bg-blue-50 text-blue-700' },
          { label: 'Destructive events', value: destructiveCount, icon: Trash2, tone: 'bg-rose-50 text-rose-700' },
        ].map(item => (
          <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-500">{item.label}</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{item.value}</p>
              </div>
              <div className={`rounded-xl p-2.5 ${item.tone}`}><item.icon className="h-5 w-5" /></div>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-slate-500" /><h2 className="text-sm font-bold text-slate-900">Find audit events</h2></div>
          {hasFilters && <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"><FilterX className="h-3.5 w-3.5" /> Clear filters</button>}
        </div>
        <div className="grid gap-3 lg:grid-cols-12">
          <label className="relative lg:col-span-4">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setCurrentPage(1); }} placeholder="Search actor, record or details" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10" />
          </label>
          <select aria-label="Filter by action" value={actionFilter} onChange={event => { setActionFilter(event.target.value); setCurrentPage(1); }} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none focus:border-teal-500 lg:col-span-2">
            <option value="ALL">All actions</option><option value="CREATE">Create</option><option value="UPDATE">Update</option><option value="DELETE">Delete</option><option value="AUTH">Authentication</option>
          </select>
          <select aria-label="Filter by resource" value={resourceFilter} onChange={event => { setResourceFilter(event.target.value); setCurrentPage(1); }} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none focus:border-teal-500 lg:col-span-2">
            <option value="ALL">All resources</option><option value="Patient">Patients</option><option value="Appointment">Appointments</option><option value="Visit">Visits</option><option value="User">Users</option><option value="Settings">Settings</option><option value="Branch">Branches</option>
          </select>
          <label className="relative lg:col-span-2"><CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Start date" type="date" value={startDate} onChange={event => { setStartDate(event.target.value); setCurrentPage(1); }} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-2 text-sm text-slate-700 outline-none focus:border-teal-500" /></label>
          <label className="relative lg:col-span-2"><CalendarDays className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="End date" type="date" value={endDate} onChange={event => { setEndDate(event.target.value); setCurrentPage(1); }} className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-2 text-sm text-slate-700 outline-none focus:border-teal-500" /></label>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => setIsExportModalOpen(true)} disabled={filteredLogs.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4" /> Export filtered CSV</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-10"><RefreshCw className="h-7 w-7 animate-spin text-teal-600" /><p className="text-sm font-medium text-slate-500">Loading audit events…</p></div>
        ) : loadError ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-10 text-center"><Shield className="h-10 w-10 text-rose-400" /><p className="font-bold text-slate-900">Unable to load audit events</p><p className="max-w-md text-sm text-slate-500">{loadError}</p><button type="button" onClick={() => void loadLogs()} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white">Try again</button></div>
        ) : currentLogs.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-10 text-center"><FileClock className="h-10 w-10 text-slate-300" /><p className="font-bold text-slate-900">No matching audit events</p><p className="text-sm text-slate-500">Adjust the filters or refresh to check for newer entries.</p></div>
        ) : (
          <>
            <div className="divide-y divide-slate-100 lg:hidden">
              {currentLogs.map(log => (
                <article key={log.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-bold text-slate-900">{log.resource || 'System'} {log.resourceName && <span className="font-medium text-slate-500">· {log.resourceName}</span>}</p><p className="mt-1 text-xs text-slate-500">{formatTimezone(asDate(log.timestamp), timezone)}</p></div>{actionBadge(log.action)}</div>
                  <p className="text-sm leading-6 text-slate-600">{log.details || 'No additional details.'}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><span className="font-semibold text-slate-700">{log.userName || log.userEmail || 'Unknown actor'}</span><span>{titleCase(log.userRole)}</span><span className="font-mono">{log.resourceId || '—'}</span></div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3.5">Date & time</th><th className="px-5 py-3.5">Actor</th><th className="px-5 py-3.5">Action</th><th className="px-5 py-3.5">Target</th><th className="px-5 py-3.5">Details</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {currentLogs.map(log => (
                    <tr key={log.id} className="align-top transition hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500">{formatTimezone(asDate(log.timestamp), timezone)}</td>
                      <td className="px-5 py-4"><p className="font-semibold text-slate-900">{log.userName || log.userEmail || 'Unknown actor'}</p><p className="mt-1 text-xs text-slate-500">{titleCase(log.userRole)}{log.userEmail && log.userName ? ` · ${log.userEmail}` : ''}</p></td>
                      <td className="px-5 py-4">{actionBadge(log.action)}</td>
                      <td className="px-5 py-4"><div className="flex items-center gap-2"><span className="rounded-md bg-teal-50 px-2 py-1 text-[11px] font-bold text-teal-700">{log.resource || 'System'}</span><span className="font-semibold text-slate-700">{log.resourceName || '—'}</span></div><p className="mt-1.5 max-w-56 truncate font-mono text-[10px] text-slate-400" title={log.resourceId}>{log.resourceId || '—'}</p></td>
                      <td className="max-w-md px-5 py-4 text-sm leading-6 text-slate-600">{log.details || 'No additional details.'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && !loadError && filteredLogs.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-xs font-medium text-slate-500">Showing {firstIndex + 1}–{Math.min(firstIndex + itemsPerPage, filteredLogs.length)} of {filteredLogs.length} matching events</p>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous page" onClick={() => setCurrentPage(page => Math.max(1, page - 1))} disabled={safeCurrentPage === 1} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-24 text-center text-xs font-bold text-slate-700">Page {safeCurrentPage} of {totalPages}</span>
              <button type="button" aria-label="Next page" onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))} disabled={safeCurrentPage === totalPages} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

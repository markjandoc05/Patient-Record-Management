import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useTimezone } from '../contexts/TimezoneContext';
import { formatTimezone } from '../utils/timezone';
import { 
  Shield, 
  Search, 
  Filter, 
  Download, 
  ChevronLeft, 
  ChevronRight, 
  Activity,
  Calendar,
  Layers,
  FileCheck2,
  Trash2,
  PlusCircle,
  RefreshCw,
  Clock,
  AlertTriangle
} from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';

interface AuditTrailDashboardProps {
  role: string | null;
}

export default function AuditTrailDashboard({ role }: AuditTrailDashboardProps) {
  const timezone = useTimezone();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [resourceFilter, setResourceFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const itemsPerPage = 12;

  useEffect(() => {
    if (!['admin', 'support_developer', 'manager'].includes(role || '')) {
      setLoading(false);
      return;
    }
    // Limit to latest 1000 trails to maintain lightweight and fast memory footprints
    const q = query(
      collection(db, 'audit_logs'), 
      orderBy('timestamp', 'desc'), 
      limit(1000)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsedLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setLogs(parsedLogs);
      setLoading(false);
    }, (error) => {
      console.error('Failed to listen to HIPAA audit trails:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [role]);

  // Filter logs locally for ultimate responsiveness
  const filteredLogs = logs.filter(log => {
    // 1. Search filter (by Actor Email, Name, ID, or Details)
    const matchesSearch = 
      log.userEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.userId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.resourceId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.resourceName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details?.toLowerCase().includes(searchQuery.toLowerCase());

    // 2. Action Type filter
    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;

    // 3. Resource Type filter
    const matchesResource = resourceFilter === 'ALL' || log.resource === resourceFilter;

    // 4. Date range filter
    let matchesDate = true;
    if (startDate) {
      matchesDate = matchesDate && log.timestamp >= `${startDate}T00:00:00Z`;
    }
    if (endDate) {
      matchesDate = matchesDate && log.timestamp <= `${endDate}T23:59:59Z`;
    }

    return matchesSearch && matchesAction && matchesResource && matchesDate;
  });

  // Pagination math
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage) || 1;
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentLogs = filteredLogs.slice(indexOfFirstItem, indexOfLastItem);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // HIPAA Safe Exporter (CSV format)
  const exportToCSV = () => {
    setIsExportModalOpen(true);
  };

  const performExport = () => {
    setIsExportModalOpen(false);
    
    const headers = ['Timestamp', 'Actor ID', 'Actor Email', 'Role', 'Action Type', 'Resource', 'Resource ID', 'Resource Identifier', 'Event Details', 'User Agent'];
    const csvRows = [headers.join(',')];

    filteredLogs.forEach(log => {
      const row = [
        `="${log.timestamp || ''}"`,
        `="${log.userId || ''}"`,
        `"${(log.userEmail || '').replace(/"/g, '""')}"`,
        `"${(log.userRole === 'support_developer' ? 'Support' : (log.userRole || 'staff').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' / '))}"`,
        `"${log.action || ''}"`,
        `"${log.resource || ''}"`,
        `="${log.resourceId || ''}"`,
        `"${(log.resourceName || '').replace(/"/g, '""')}"`,
        `"${(log.details || '').replace(/"/g, '""')}"`,
        `"${(log.userAgent || '').slice(0, 50).replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `lumina_skin_audit_trail_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Small delay before revoking to ensure download initiation
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'CREATE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
            <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
            CREATE
          </span>
        );
      case 'UPDATE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-lg">
            <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
            UPDATE
          </span>
        );
      case 'DELETE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded-lg">
            <Trash2 className="w-3.5 h-3.5 text-red-600" />
            DELETE
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg">
            <Activity className="w-3.5 h-3.5 text-slate-500" />
            {action}
          </span>
        );
    }
  };

  if (!['admin', 'support_developer', 'manager'].includes(role || '')) {
    return (
      <div className="p-8 text-center bg-white border border-slate-200 rounded-2xl shadow-sm max-w-lg mx-auto mt-12">
        <Shield className="w-12 h-12 text-rose-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Access Denied</h2>
        <p className="text-slate-600 text-sm">
          Audit Trail modules contain highly sensitive system transaction histories. Access is strictly restricted to designated Clinic Administrators, Managers, and Support/Developer roles under HIPAA Technical Safeguards.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div id="stat-total" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-teal-50 text-teal-600 rounded-xl">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Actions Traced</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{filteredLogs.length}</h3>
          </div>
        </div>
        <div id="stat-create" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <PlusCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Creates Traced</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">
              {filteredLogs.filter(l => l.action === 'CREATE').length}
            </h3>
          </div>
        </div>
        <div id="stat-update" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Updates Traced</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">
              {filteredLogs.filter(l => l.action === 'UPDATE').length}
            </h3>
          </div>
        </div>
        <div id="stat-hipaa" className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-slate-50 text-slate-600 rounded-xl">
            <Shield className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">HIPAA Status</p>
            <span className="inline-flex items-center gap-1 mt-1 text-xs font-bold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200">
              Active ledger
            </span>
          </div>
        </div>
      </div>

      {/* Control panel & Filter bar */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <ConfirmationModal 
          isOpen={isExportModalOpen}
          title="Confirm HIPAA Export"
          message="Are you sure you want to export the HIPAA audit trails? This file contains sensitive information and is for authorized admin use only."
          onConfirm={performExport}
          onCancel={() => setIsExportModalOpen(false)}
        />
        <div className="flex flex-col xl:flex-row gap-4 justify-between items-stretch xl:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search by Actor Email, ID, details, resource name..." 
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors"
            />
          </div>
          
          <div className="flex flex-wrap gap-2.5 items-center">
            {/* Action Filter */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Activity className="w-4 h-4 text-slate-400" />
              <select 
                value={actionFilter} 
                onChange={e => { setActionFilter(e.target.value); setCurrentPage(1); }}
                className="bg-transparent text-xs font-semibold text-slate-600 focus:outline-none border-none pr-6 cursor-pointer"
              >
                <option value="ALL">All Actions</option>
                <option value="CREATE">CREATE</option>
                <option value="UPDATE">UPDATE</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>

            {/* Resource Filter */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Layers className="w-4 h-4 text-slate-400" />
              <select 
                value={resourceFilter} 
                onChange={e => { setResourceFilter(e.target.value); setCurrentPage(1); }}
                className="bg-transparent text-xs font-semibold text-slate-600 focus:outline-none border-none pr-6 cursor-pointer"
              >
                <option value="ALL">All Resources</option>
                <option value="Patient">Patient Files</option>
                <option value="Appointment">Appointments</option>
                <option value="Visit">Visits</option>
                <option value="User">Users</option>
                <option value="Settings">Settings</option>
                <option value="Branch">Branches</option>
              </select>
            </div>

            {/* Date Filters */}
            <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5">
              <Calendar className="w-4 h-4 text-slate-400" />
              <input 
                type="date" 
                value={startDate} 
                onChange={e => { setStartDate(e.target.value); setCurrentPage(1); }}
                className="bg-transparent cursor-pointer text-slate-600 focus:outline-none border-none"
              />
              <span>to</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => { setEndDate(e.target.value); setCurrentPage(1); }}
                className="bg-transparent cursor-pointer text-slate-600 focus:outline-none border-none"
              />
            </div>

            {/* CSV Exporter */}
            <button 
              onClick={exportToCSV}
              disabled={filteredLogs.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 border border-transparent hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Export HIPAA CSV
            </button>
          </div>
        </div>
      </div>

      {/* Main Ledger Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-teal-600 animate-spin mx-auto" />
            <p className="text-sm font-medium text-slate-500">Retrieving secure transaction logs...</p>
          </div>
        ) : currentLogs.length === 0 ? (
          <div className="p-16 text-center text-slate-500 space-y-3">
            <FileCheck2 className="w-12 h-12 text-slate-300 mx-auto" />
            <p className="text-base font-bold text-slate-700">No logs match selection</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">Try broadening your search or adjusting your query filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Identity / Actor</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Clinical Target</th>
                  <th className="px-6 py-4">Log Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                {currentLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 align-top whitespace-nowrap text-slate-500 font-medium">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {formatTimezone(log.timestamp, timezone)}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="font-semibold text-slate-800">
                        {log.userEmail || 'Unknown'}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 mt-0.5">ID: {log.userId?.slice(0, 8)}...</div>
                      <div className="inline-block mt-1 text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">
                        {log.userRole === 'support_developer' ? 'Support' : (log.userRole || 'staff').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' / ')}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="font-semibold text-slate-800 flex items-center gap-1">
                        <span className="text-[11px] px-1.5 py-0.5 bg-teal-50 border border-teal-100 text-teal-800 rounded font-bold">
                          {log.resource}
                        </span>
                        {log.resourceName && (
                          <span className="text-slate-600 font-medium truncate max-w-[120px]">
                            {log.resourceName}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-1">ID: {log.resourceId}</div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <p className="text-slate-600 leading-relaxed font-sans max-w-sm whitespace-pre-line">
                        {log.details || 'N/A'}
                      </p>
                      {log.userAgent && (
                        <p className="text-[9px] text-slate-400 font-mono mt-1 line-clamp-1" title={log.userAgent}>
                          UA: {log.userAgent}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Dynamic Pagination Footer */}
        {filteredLogs.length > 0 && (
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-semibold">
              Showing <span className="font-bold text-slate-700">{indexOfFirstItem + 1}</span> - <span className="font-bold text-slate-700">{Math.min(indexOfLastItem, filteredLogs.length)}</span> of <span className="font-bold text-slate-700">{filteredLogs.length}</span> security entries
            </span>
            
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-1.5 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button 
                  key={page}
                  onClick={() => handlePageChange(page)}
                  className={`h-8 w-8 text-xs font-bold rounded-lg transition-all ${
                    currentPage === page 
                      ? 'bg-slate-900 text-white shadow' 
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {page}
                </button>
              ))}
              
              <button 
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-1.5 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

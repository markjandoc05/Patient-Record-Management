import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Briefcase, Users, UserPlus, Zap, Calendar, Award } from 'lucide-react';
import { startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { getAccessibleBranches, subscribeToBranchScopedCollection } from '../utils/branchAccess';

export default function InsightsAnalyticsDashboard({ userProfile }: { userProfile: any }) {
  const [patients, setPatients] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [dateRange, setDateRange] = useState('Today');
  const [filterBranch, setFilterBranch] = useState('All');

  useEffect(() => {
    const unsubPatients = subscribeToBranchScopedCollection(db, 'patients', 'homeBranchId', userProfile, setPatients);
    const unsubAppointments = subscribeToBranchScopedCollection(db, 'appointments', 'branchId', userProfile, setAppointments);
    const unsubVisits = subscribeToBranchScopedCollection(db, 'visits', 'branchId', userProfile, setVisits);
    const unsubBranches = onSnapshot(collection(db, 'branches'), (snap) => setBranches(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => setUsers(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    Promise.all([unsubPatients, unsubAppointments, unsubVisits, unsubBranches, unsubUsers]).then(() => setLoading(false));
    return () => { unsubPatients(); unsubAppointments(); unsubVisits(); unsubBranches(); unsubUsers(); };
  }, [userProfile]);

  const accessibleBranches = getAccessibleBranches(branches, userProfile);

  const getFilteredData = () => {
    const now = new Date();
    let startDate = startOfDay(now);
    let endDate = endOfDay(now);

    switch (dateRange) {
        case 'Yesterday': startDate = startOfDay(subDays(now, 1)); endDate = endOfDay(subDays(now, 1)); break;
        case 'This Week': startDate = startOfWeek(now); endDate = endOfWeek(now); break;
        case 'This Month': startDate = startOfMonth(now); endDate = endOfMonth(now); break;
        case 'Last Month': startDate = startOfMonth(subDays(startOfMonth(now), 1)); endDate = endOfMonth(subDays(startOfMonth(now), 1)); break;
    }

    const filteredAppointments = appointments.filter(a => {
        const d = parseISO(a.appointmentDate);
        return isWithinInterval(d, { start: startDate, end: endDate }) && 
               (filterBranch === 'All' || a.branchId === filterBranch);
    });

    const filteredPatients = patients.filter(p => {
        const createdDate = p.createdAt ? parseISO(p.createdAt) : null;
        return !createdDate || isWithinInterval(createdDate, { start: startDate, end: endDate }) || 
               (filterBranch === 'All' || p.homeBranchId === filterBranch);
    });

    const filteredVisits = visits.filter(v => {
        const d = parseISO(v.visitDate || v.date);
        return isWithinInterval(d, { start: startDate, end: endDate }) && 
               (filterBranch === 'All' || v.branchId === filterBranch);
    });

    return { filteredAppointments, filteredPatients, filteredVisits, startDate, endDate };
  };

  const { filteredAppointments, filteredPatients, filteredVisits, startDate, endDate } = getFilteredData();

  // Simple stats calculation
  const totalPatients = filterBranch === 'All' ? patients.length : patients.filter(p => p.homeBranchId === filterBranch).length;
  const newPatients = filteredPatients.length; 
  
  const totalAppointments = filteredAppointments.length;
  const confirmedAppointments = filteredAppointments.filter(a => a.status === 'Confirmed').length;
  const completedAppointments = filteredAppointments.filter(a => a.status === 'Completed').length;
  const upcomingAppointments = filteredAppointments.filter(a => parseISO(a.appointmentDate) > new Date()).length;

  const totalVisits = filteredVisits.length;
  const completedVisits = filteredVisits.filter(v => v.status === 'Completed').length;
  const followUpRequiredVisits = filteredVisits.filter(v => v.followUpRequired === true).length;
  const noShowVisits = filteredVisits.filter(v => v.status === 'No Show').length;

  const COLORS = ['#14b8a6', '#0f766e', '#0d9488', '#5eead4'];

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <select className="border border-slate-300 px-3 py-2 rounded-lg text-sm" value={dateRange} onChange={e => setDateRange(e.target.value)}>
            {['Today', 'Yesterday', 'This Week', 'This Month', 'Last Month'].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select className="border border-slate-300 px-3 py-2 rounded-lg text-sm" value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
            <option value="All">All Branches</option>
            {accessibleBranches.map(b => <option key={b.id} value={b.id}>{b.branchName}</option>)}
        </select>
      </div>

      <h2 className="text-lg font-bold text-slate-800">Patient Analytics</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
            { label: 'Total Patients', value: totalPatients, icon: Users },
            { label: 'New Patients', value: newPatients, icon: UserPlus },
            { label: 'Existing Patients', value: totalPatients - newPatients, icon: Zap },
            { label: 'Active Patients', value: filteredAppointments.length > 0 ? filteredPatients.length : 0, icon: Award }
        ].map(kpi => (
          <div key={kpi.label} className="bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase">
                <kpi.icon size={16} />{kpi.label}
            </div>
            <div className="text-2xl font-bold mt-2">{kpi.value}</div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold text-slate-800 mt-6">Appointment Analytics</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
            { label: 'Total Appointments', value: totalAppointments, icon: Calendar },
            { label: 'Confirmed', value: confirmedAppointments, icon: Calendar },
            { label: 'Completed', value: completedAppointments, icon: Calendar },
            { label: 'Upcoming', value: upcomingAppointments, icon: Calendar }
        ].map(kpi => (
          <div key={kpi.label} className="bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase">
                <kpi.icon size={16} />{kpi.label}
            </div>
            <div className="text-2xl font-bold mt-2">{kpi.value}</div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold text-slate-800 mt-6">Visit History Analytics</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
            { label: 'Total Visits', value: totalVisits, icon: Calendar },
            { label: 'Completed Visits', value: completedVisits, icon: Calendar },
            { label: 'Follow-up Required', value: followUpRequiredVisits, icon: Calendar },
            { label: 'Today\'s Visits', value: filteredVisits.filter(v => (v.visitDate || v.date || '').startsWith(new Date().toISOString().split('T')[0])).length, icon: Calendar }
        ].map(kpi => (
          <div key={kpi.label} className="bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold uppercase">
                <kpi.icon size={16} />{kpi.label}
            </div>
            <div className="text-2xl font-bold mt-2">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200" style={{height: '300px'}}>
            <h3 className="text-sm font-semibold mb-4">Patient Acquisition</h3>
            <ResponsiveContainer width="100%" height="80%">
                <BarChart data={[{name: 'New', value: newPatients}, {name: 'Existing', value: totalPatients - newPatients}]}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0d9488" />
                </BarChart>
            </ResponsiveContainer>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200" style={{height: '300px'}}>
            <h3 className="text-sm font-semibold mb-4">Appt Status Distribution</h3>
            <ResponsiveContainer width="100%" height="80%">
                <PieChart>
                    <Pie data={[{name: 'Confirmed', value: confirmedAppointments}, {name: 'Completed', value: completedAppointments}]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#14b8a6">
                        {[{name: 'Confirmed', value: confirmedAppointments}, {name: 'Completed', value: completedAppointments}].map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                </PieChart>
            </ResponsiveContainer>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200" style={{height: '300px'}}>
            <h3 className="text-sm font-semibold mb-4">Visit Status Distribution</h3>
            <ResponsiveContainer width="100%" height="80%">
                <PieChart>
                    <Pie data={[{name: 'Completed', value: completedVisits}, {name: 'Follow-up Required', value: followUpRequiredVisits}, {name: 'No Show', value: noShowVisits}]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#14b8a6">
                        {[{name: 'Completed', value: completedVisits}, {name: 'Follow-up Required', value: followUpRequiredVisits}, {name: 'No Show', value: noShowVisits}].map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                </PieChart>
            </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

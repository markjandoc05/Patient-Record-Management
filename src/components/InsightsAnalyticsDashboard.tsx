import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  CalendarCheck2,
  ChartNoAxesCombined,
  CircleAlert,
  MapPin,
  RefreshCw,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import {
  getAccessibleBranches,
  subscribeToBranchScopedCollection,
  subscribeToSharedCollection,
} from '../utils/branchAccess';
import { getActiveTimezoneSettings } from '../utils/timezone';

type DateRange = 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Last Month';

const DATE_RANGES: DateRange[] = ['Today', 'Yesterday', 'This Week', 'This Month', 'Last Month'];
const CHART_COLORS = ['#0d9488', '#2563eb', '#7c3aed', '#f59e0b', '#e11d48', '#64748b'];

function normalizeStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function parseRecordDate(value: any, timezone: string) {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== 'string') return null;

  try {
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const date = hasExplicitZone ? new Date(value) : fromZonedTime(parseISO(value), timezone);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function isInRange(date: Date | null, start: Date, end: Date) {
  if (!date) return false;
  const timestamp = date.getTime();
  return timestamp >= start.getTime() && timestamp <= end.getTime();
}

function getRangeBoundaries(dateRange: DateRange, timezone: string) {
  const zonedNow = toZonedTime(new Date(), timezone);
  let zonedStart = startOfDay(zonedNow);
  let zonedEnd = endOfDay(zonedNow);

  if (dateRange === 'Yesterday') {
    const yesterday = subDays(zonedNow, 1);
    zonedStart = startOfDay(yesterday);
    zonedEnd = endOfDay(yesterday);
  } else if (dateRange === 'This Week') {
    zonedStart = startOfWeek(zonedNow, { weekStartsOn: 1 });
    zonedEnd = endOfWeek(zonedNow, { weekStartsOn: 1 });
  } else if (dateRange === 'This Month') {
    zonedStart = startOfMonth(zonedNow);
    zonedEnd = endOfMonth(zonedNow);
  } else if (dateRange === 'Last Month') {
    const lastMonth = subMonths(zonedNow, 1);
    zonedStart = startOfMonth(lastMonth);
    zonedEnd = endOfMonth(lastMonth);
  }

  return {
    start: fromZonedTime(zonedStart, timezone),
    end: fromZonedTime(zonedEnd, timezone),
  };
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-56 flex-col items-center justify-center rounded-xl bg-slate-50/70 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
        <ChartNoAxesCombined className="h-5 w-5" />
      </span>
      <p className="mt-3 text-sm font-medium text-slate-600">No activity to chart</p>
      <p className="mt-1 max-w-xs text-xs text-slate-400">{message}</p>
    </div>
  );
}

export default function InsightsAnalyticsDashboard({ userProfile, activeBranchId }: { userProfile: any, activeBranchId?: string }) {
  const [patients, setPatients] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loadingState, setLoadingState] = useState({ patients: true, appointments: true, visits: true, branches: true });
  const [loadError, setLoadError] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('This Month');
  const [filterBranch, setFilterBranch] = useState('All');

  useEffect(() => {
    setLoadingState({ patients: true, appointments: true, visits: true, branches: true });
    setLoadError('');
    const fail = (source: string) => (error: Error) => {
      console.error(`Unable to load Insights ${source}:`, error);
      setLoadError('Some analytics data could not be loaded. Refresh the page or check your access.');
      setLoadingState(previous => ({ ...previous, [source]: false }));
    };

    const unsubPatients = subscribeToSharedCollection(
      db,
      'patients',
      documents => {
        setPatients(documents);
        setLoadingState(previous => ({ ...previous, patients: false }));
      },
      fail('patients'),
    );
    const unsubAppointments = subscribeToBranchScopedCollection(
      db,
      'appointments',
      'branchId',
      userProfile,
      documents => {
        setAppointments(documents);
        setLoadingState(previous => ({ ...previous, appointments: false }));
      },
      fail('appointments'),
    );
    const unsubVisits = subscribeToBranchScopedCollection(
      db,
      'visits',
      'branchId',
      userProfile,
      documents => {
        setVisits(documents);
        setLoadingState(previous => ({ ...previous, visits: false }));
      },
      fail('visits'),
    );
    const unsubBranches = onSnapshot(
      collection(db, 'branches'),
      snapshot => {
        setBranches(snapshot.docs.map(document => ({ id: document.id, ...document.data() })));
        setLoadingState(previous => ({ ...previous, branches: false }));
      },
      fail('branches'),
    );

    return () => {
      unsubPatients();
      unsubAppointments();
      unsubVisits();
      unsubBranches();
    };
  }, [userProfile]);

  useEffect(() => {
    setFilterBranch(activeBranchId || 'All');
  }, [activeBranchId]);

  const loading = Object.values(loadingState).some(Boolean);
  const accessibleBranches = useMemo(() => getAccessibleBranches(branches, userProfile), [branches, userProfile]);
  const timezone = getActiveTimezoneSettings().timezone || 'Asia/Manila';
  const { start, end } = useMemo(() => getRangeBoundaries(dateRange, timezone), [dateRange, timezone]);

  const analytics = useMemo(() => {
    const matchesBranch = (record: any, field: 'homeBranchId' | 'branchId') => filterBranch === 'All' || record[field] === filterBranch;
    const scopedPatients = patients.filter(patient => matchesBranch(patient, 'homeBranchId'));
    const scopedAppointments = appointments.filter(appointment => matchesBranch(appointment, 'branchId'));
    const scopedVisits = visits.filter(visit => matchesBranch(visit, 'branchId'));
    const rangeAppointments = scopedAppointments.filter(appointment => isInRange(parseRecordDate(appointment.appointmentDate, timezone), start, end));
    const rangeVisits = scopedVisits.filter(visit => isInRange(parseRecordDate(visit.visitDate || visit.date, timezone), start, end));
    const newPatients = scopedPatients.filter(patient => isInRange(parseRecordDate(patient.createdAt, timezone), start, end));
    const engagedPatientIds = new Set([
      ...rangeAppointments.map(appointment => appointment.patientId),
      ...rangeVisits.map(visit => visit.patientId),
    ].filter(Boolean));

    const appointmentStatuses = ['Scheduled', 'Confirmed', 'Arrived', 'Completed', 'Cancelled', 'No Show'].map(status => ({
      name: status,
      value: rangeAppointments.filter(appointment => normalizeStatus(appointment.status) === status.toLowerCase()).length,
    }));
    const knownAppointmentCount = appointmentStatuses.reduce((sum, item) => sum + item.value, 0);
    if (knownAppointmentCount < rangeAppointments.length) {
      appointmentStatuses.push({ name: 'Other', value: rangeAppointments.length - knownAppointmentCount });
    }

    const visitOutcomes = [
      { name: 'Completed', value: 0 },
      { name: 'Follow-up', value: 0 },
      { name: 'No show', value: 0 },
      { name: 'Cancelled', value: 0 },
      { name: 'Other', value: 0 },
    ];
    rangeVisits.forEach(visit => {
      const status = normalizeStatus(visit.status);
      const outcome = normalizeStatus(visit.visitOutcome);
      if (status === 'no show') visitOutcomes[2].value += 1;
      else if (status === 'cancelled') visitOutcomes[3].value += 1;
      else if (visit.followUpRequired === true || status === 'for follow-up' || outcome === 'follow-up required') visitOutcomes[1].value += 1;
      else if (status === 'completed') visitOutcomes[0].value += 1;
      else visitOutcomes[4].value += 1;
    });

    const completedAppointments = rangeAppointments.filter(appointment => normalizeStatus(appointment.status) === 'completed').length;
    const completedVisits = rangeVisits.filter(visit => normalizeStatus(visit.status) === 'completed').length;
    const followUps = rangeVisits.filter(visit => visit.followUpRequired === true || normalizeStatus(visit.status) === 'for follow-up' || normalizeStatus(visit.visitOutcome) === 'follow-up required').length;

    return {
      totalPatients: scopedPatients.length,
      newPatients: newPatients.length,
      existingPatients: Math.max(scopedPatients.length - newPatients.length, 0),
      engagedPatients: engagedPatientIds.size,
      totalAppointments: rangeAppointments.length,
      completedAppointments,
      appointmentCompletionRate: rangeAppointments.length ? Math.round((completedAppointments / rangeAppointments.length) * 100) : 0,
      totalVisits: rangeVisits.length,
      completedVisits,
      visitCompletionRate: rangeVisits.length ? Math.round((completedVisits / rangeVisits.length) * 100) : 0,
      followUps,
      appointmentStatuses: appointmentStatuses.filter(item => item.value > 0),
      visitOutcomes: visitOutcomes.filter(item => item.value > 0),
    };
  }, [appointments, end, filterBranch, patients, start, timezone, visits]);

  const selectedBranchName = filterBranch === 'All'
    ? 'All authorized clinics'
    : accessibleBranches.find(branch => branch.id === filterBranch)?.branchName || 'Selected clinic';
  const rangeLabel = `${formatInTimeZone(start, timezone, 'MMM d')} – ${formatInTimeZone(end, timezone, 'MMM d, yyyy')}`;
  const patientMix = [
    { name: 'New in period', value: analytics.newPatients },
    { name: 'Existing', value: analytics.existingPatients },
  ].filter(item => item.value > 0);
  const clearFilters = () => {
    setDateRange('This Month');
    setFilterBranch(activeBranchId || 'All');
  };

  if (loading) {
    return (
      <div className="space-y-5" aria-label="Loading insights and analytics">
        <div className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(item => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {loadError && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/30">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.01em] text-slate-950">Performance overview</h2>
            <p className="mt-0.5 text-xs text-slate-500">{selectedBranchName} · {rangeLabel}</p>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
            <Activity className="h-3.5 w-3.5" /> Live clinic data
          </span>
        </div>
        <div className="grid gap-3 bg-slate-50/50 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto] lg:items-end">
          <label>
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Reporting period</span>
            <select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" value={dateRange} onChange={event => setDateRange(event.target.value as DateRange)}>
              {DATE_RANGES.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Clinic branch</span>
            <select className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" value={filterBranch} onChange={event => setFilterBranch(event.target.value)}>
              <option value="All">All authorized clinics</option>
              {accessibleBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.branchName}</option>)}
            </select>
          </label>
          <button type="button" onClick={clearFilters} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-50 sm:col-span-2 lg:col-span-1">
            <RefreshCw className="h-4 w-4" /> Reset
          </button>
        </div>
      </section>

      <section aria-label="Analytics summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Patient directory', value: analytics.totalPatients, detail: `${analytics.newPatients} new in period`, icon: Users, tone: 'bg-teal-50 text-teal-700' },
          { label: 'Engaged patients', value: analytics.engagedPatients, detail: 'Appointment or visit activity', icon: UserPlus, tone: 'bg-violet-50 text-violet-700' },
          { label: 'Appointments', value: analytics.totalAppointments, detail: `${analytics.appointmentCompletionRate}% completed`, icon: CalendarCheck2, tone: 'bg-blue-50 text-blue-700' },
          { label: 'Completed visits', value: analytics.completedVisits, detail: `${analytics.followUps} follow-ups needed`, icon: Activity, tone: 'bg-emerald-50 text-emerald-700' },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500 sm:text-sm">{stat.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-3xl">{stat.value}</p>
              </div>
              <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:flex ${stat.tone}`}><stat.icon className="h-4.5 w-4.5" /></span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400 sm:text-xs">{stat.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-slate-950">Patient directory mix</h3><p className="mt-1 text-xs text-slate-500">New registrations compared with existing patients</p></div>
            <Users className="h-4.5 w-4.5 text-slate-400" />
          </div>
          {patientMix.length === 0 ? <EmptyChart message="Patient registrations will appear here when records are available." /> : (
            <div className="h-64 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={patientMix} dataKey="value" nameKey="name" innerRadius={48} outerRadius={76} paddingAngle={3}>
                    {patientMix.map((item, index) => <Cell key={item.name} fill={CHART_COLORS[index]} />)}
                  </Pie>
                  <Tooltip formatter={(value: number | string) => [Number(value), 'Patients']} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5 xl:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-slate-950">Appointment status</h3><p className="mt-1 text-xs text-slate-500">All appointment outcomes for the selected period</p></div>
            <CalendarCheck2 className="h-4.5 w-4.5 text-slate-400" />
          </div>
          {analytics.appointmentStatuses.length === 0 ? <EmptyChart message="No appointments match the selected clinic and period." /> : (
            <div className="h-64 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.appointmentStatuses} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(value: number | string) => [Number(value), 'Appointments']} />
                  <Bar dataKey="value" fill="#0d9488" radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5 xl:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-slate-950">Visit outcomes</h3><p className="mt-1 text-xs text-slate-500">Each visit is counted once by its current outcome</p></div>
            <Activity className="h-4.5 w-4.5 text-slate-400" />
          </div>
          {analytics.visitOutcomes.length === 0 ? <EmptyChart message="No visits match the selected clinic and period." /> : (
            <div className="h-64 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.visitOutcomes} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={74} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(value: number | string) => [Number(value), 'Visits']} />
                  <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/30 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-slate-950">Operational signals</h3><p className="mt-1 text-xs text-slate-500">Quick indicators for the selected period</p></div>
            <MapPin className="h-4.5 w-4.5 text-slate-400" />
          </div>
          <div className="mt-5 space-y-3">
            {[
              { label: 'Appointment completion', value: `${analytics.appointmentCompletionRate}%`, detail: `${analytics.completedAppointments} of ${analytics.totalAppointments}` },
              { label: 'Visit completion', value: `${analytics.visitCompletionRate}%`, detail: `${analytics.completedVisits} of ${analytics.totalVisits}` },
              { label: 'Follow-ups required', value: analytics.followUps, detail: 'Needs a next action' },
              { label: 'Patients with activity', value: analytics.engagedPatients, detail: 'Unique patients in period' },
            ].map(signal => (
              <div key={signal.label} className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-3">
                <div><p className="text-xs font-medium text-slate-700">{signal.label}</p><p className="mt-0.5 text-[10px] text-slate-400">{signal.detail}</p></div>
                <span className="text-base font-semibold text-slate-950">{signal.value}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

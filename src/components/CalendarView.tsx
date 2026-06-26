import React from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';

const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

export default function CalendarView({ appointments, onSelectEvent }: { appointments: any[], onSelectEvent: (event: any) => void }) {
  const [date, setDate] = React.useState(new Date());
  const [view, setView] = React.useState<any>('month');

  const events = appointments.map(a => ({
    title: `${a.patientName} - ${a.visitType}`,
    start: new Date(a.appointmentDate),
    end: new Date(new Date(a.appointmentDate).getTime() + 60 * 60 * 1000), // 1-hour default
    allDay: false,
    resource: a,
    tooltip: `Patient: ${a.patientName}\nType: ${a.visitType}\nStatus: ${a.status}\nDoctor: ${a.doctorId}`,
  }));

  return (
    <div className="h-[600px] bg-white p-4 rounded-xl border border-slate-200">
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        tooltipAccessor="tooltip"
        views={['month', 'week', 'day', 'agenda']}
        date={date}
        onNavigate={(newDate) => setDate(newDate)}
        view={view}
        onView={(newView) => setView(newView)}
        onSelectEvent={onSelectEvent}
        slotPropGetter={(date: Date) => {
          const hour = date.getHours();
          if (hour < 10 || hour >= 19) {
            return { className: 'rbc-slot-unavailable' };
          }
          return {};
        }}
      />
    </div>
  );
}

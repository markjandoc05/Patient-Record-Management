import React, { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface CustomDatePickerProps {
  value: string; // Expected in YYYY-MM-DD
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  min?: string; // in YYYY-MM-DD
  className?: string;
  placeholder?: string;
}

export const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  value,
  onChange,
  disabled = false,
  required = false,
  min = '',
  className = '',
  placeholder = 'MM/DD/YYYY',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Internal state for the picker modal
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    if (value) {
      const parts = value.split('-');
      if (parts.length === 3) return Number(parts[0]);
    }
    return new Date().getFullYear();
  });

  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    if (value) {
      const parts = value.split('-');
      if (parts.length === 3) return Number(parts[1]) - 1; // 0-indexed
    }
    return new Date().getMonth();
  });

  // This stores the currently clicked date in the calendar BEFORE clicking OK
  const [tempDateStr, setTempDateStr] = useState<string>(value);

  // Synchronize internal state when the value prop changes externally
  useEffect(() => {
    setTempDateStr(value);
    if (value) {
      const parts = value.split('-');
      if (parts.length === 3) {
        setSelectedYear(Number(parts[0]));
        setSelectedMonth(Number(parts[1]) - 1);
      }
    }
  }, [value]);

  // Open helper: reset selected view to match the current value
  const handleOpen = () => {
    if (disabled) return;
    setIsOpen(true);
    if (tempDateStr) {
      const parts = tempDateStr.split('-');
      if (parts.length === 3) {
        setSelectedYear(Number(parts[0]));
        setSelectedMonth(Number(parts[1]) - 1);
      }
    } else {
      const today = new Date();
      setSelectedYear(today.getFullYear());
      setSelectedMonth(today.getMonth());
    }
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleConfirm = () => {
    if (tempDateStr) {
      onChange(tempDateStr);
    }
    setIsOpen(false);
  };

  // Helper formatting for input display (Month DD YYYY)
  const formatInputDisplay = (val: string): string => {
    if (!val) return '';
    const parts = val.split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts.map(Number);
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      const monthName = months[m - 1];
      const paddedDay = String(d).padStart(2, '0');
      if (monthName) {
        return `${monthName} ${paddedDay} ${y}`;
      }
    }
    return val;
  };

  // Format header date (e.g. "Sun, Apr 17")
  const getHeaderDisplay = (): string => {
    if (!tempDateStr) return 'Select Date';
    const parts = tempDateStr.split('-');
    if (parts.length !== 3) return 'Select Date';
    const [y, m, d] = parts.map(Number);
    const dateObj = new Date(y, m - 1, d);
    if (isNaN(dateObj.getTime())) return 'Select Date';

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[dateObj.getDay()]}, ${months[dateObj.getMonth()]} ${dateObj.getDate()}`;
  };

  // Calendar calculations
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(selectedYear, selectedMonth, 1).getDay();

  // Create list of actual days to render
  const daysArray: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    daysArray.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    daysArray.push(i);
  }

  // Handle month decrement/increment
  const handlePrevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear(v => v - 1);
    } else {
      setSelectedMonth(v => v - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear(v => v + 1);
    } else {
      setSelectedMonth(v => v + 1);
    }
  };

  // Date selection click
  const handleDaySelect = (dayNum: number) => {
    const formattedMonth = String(selectedMonth + 1).padStart(2, '0');
    const formattedDay = String(dayNum).padStart(2, '0');
    const dateStr = `${selectedYear}-${formattedMonth}-${formattedDay}`;
    
    // Check if under min bounds
    if (min && dateStr < min) return;
    
    setTempDateStr(dateStr);
  };

  const isSelectedDay = (dayNum: number): boolean => {
    if (!tempDateStr) return false;
    const parts = tempDateStr.split('-');
    if (parts.length !== 3) return false;
    return (
      Number(parts[0]) === selectedYear &&
      Number(parts[1]) - 1 === selectedMonth &&
      Number(parts[2]) === dayNum
    );
  };

  const isToday = (dayNum: number): boolean => {
    const today = new Date();
    return (
      today.getFullYear() === selectedYear &&
      today.getMonth() === selectedMonth &&
      today.getDate() === dayNum
    );
  };

  const isDayDisabled = (dayNum: number): boolean => {
    if (!min) return false;
    const formattedMonth = String(selectedMonth + 1).padStart(2, '0');
    const formattedDay = String(dayNum).padStart(2, '0');
    const dateStr = `${selectedYear}-${formattedMonth}-${formattedDay}`;
    return dateStr < min;
  };

  // Generation for Month and Year lists
  const monthsList = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Year range: let's build 130 years span, centering around the current year (100 back, 30 forward)
  const currentYearNum = new Date().getFullYear();
  const yearsList: number[] = [];
  for (let y = currentYearNum + 30; y >= currentYearNum - 100; y--) {
    yearsList.push(y);
  }

  return (
    <div className="relative w-full">
      {/* Target input wrapper replicating screenshot 2 */}
      <div 
        onClick={handleOpen}
        id="custom-datepicker-trigger"
        className={`w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm transition-all flex items-center justify-between cursor-pointer select-none bg-white text-slate-800 font-medium ${
          disabled 
            ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' 
            : 'hover:border-slate-400 active:ring-4 active:ring-teal-500/10'
        } ${className}`}
      >
        <span className={value ? 'text-slate-800' : 'text-slate-400 font-normal font-sans'}>
          {value ? formatInputDisplay(value) : placeholder}
        </span>
        <Calendar size={17} className={disabled ? 'text-slate-300' : 'text-slate-400'} />
      </div>

      {/* Actual dialog modal matching screenshot 1 */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in p-4">
          {/* Close on outer click */}
          <div className="absolute inset-0" onClick={handleClose} />
          
          {/* Main Card */}
          <div 
            className="relative bg-white rounded-3xl shadow-2xl w-[328px] max-w-full overflow-hidden flex flex-col border border-slate-100 animate-scale-up"
            onClick={e => e.stopPropagation()}
            id="custom-datepicker-modal"
          >
            {/* Header displaying select date + large formatted selected date like sun, apr 17 */}
            <div className="p-6 bg-slate-50 border-b border-slate-100 flex flex-col select-none">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
                SELECT DATE
              </span>
              <span className="text-3xl font-semibold text-slate-800 tracking-tight leading-none">
                {getHeaderDisplay()}
              </span>
            </div>

            {/* Navigation row containing dropdown selects + backward / forward arrows */}
            <div className="flex items-center justify-between px-5 py-3 select-none">
              <div className="flex items-center gap-1">
                {/* Month selectors mimicking dropdowns */}
                <select 
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(Number(e.target.value))}
                  className="bg-transparent hover:bg-slate-50 text-slate-700 font-semibold text-sm pl-1.5 pr-4 py-1.5 rounded-lg outline-none cursor-pointer border-none focus:ring-2 focus:ring-teal-500/20"
                >
                  {monthsList.map((m, idx) => (
                    <option key={m} value={idx}>{m}</option>
                  ))}
                </select>

                <select 
                  value={selectedYear}
                  onChange={e => setSelectedYear(Number(e.target.value))}
                  className="bg-transparent hover:bg-slate-50 text-slate-700 font-semibold text-sm pl-0.5 pr-4 py-1.5 rounded-lg outline-none cursor-pointer border-none focus:ring-2 focus:ring-teal-500/20"
                >
                  {yearsList.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {/* micro arrows */}
              <div className="flex items-center gap-0.5">
                <button 
                  type="button" 
                  onClick={handlePrevMonth}
                  className="p-1.5 rounded-full text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={18} />
                </button>
                <button 
                  type="button" 
                  onClick={handleNextMonth}
                  className="p-1.5 rounded-full text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* S M T W T F S weekdays line */}
            <div className="grid grid-cols-7 gap-1 px-5 text-center text-xs font-bold text-slate-400 mb-2 select-none">
              <span>S</span>
              <span>M</span>
              <span>T</span>
              <span>W</span>
              <span>T</span>
              <span>F</span>
              <span>S</span>
            </div>

            {/* Days grid layout */}
            <div className="grid grid-cols-7 gap-y-1.5 px-5 pb-4 text-center select-none">
              {daysArray.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} />;
                }

                const isActive = isSelectedDay(day);
                const currentToday = isToday(day);
                const disabledDay = isDayDisabled(day);

                return (
                  <div 
                    key={`day-${day}`}
                    className="flex justify-center items-center h-9"
                  >
                    <button
                      type="button"
                      disabled={disabledDay}
                      onClick={() => handleDaySelect(day)}
                      className={`w-9 h-9 flex items-center justify-center text-sm font-semibold rounded-full transition-all cursor-pointer ${
                        isActive
                          ? 'bg-blue-600 text-white font-bold shadow-md hover:bg-blue-700'
                          : disabledDay
                            ? 'text-slate-200 cursor-not-allowed pointer-events-none'
                            : currentToday
                              ? 'border border-blue-600 text-blue-600 hover:bg-slate-50'
                              : 'text-slate-800 hover:bg-slate-100'
                      }`}
                    >
                      {day}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Modal actions Cancel / OK matching screenshot */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-50">
              <button
                type="button"
                onClick={handleClose}
                className="text-xs font-extrabold uppercase tracking-wider text-blue-600 hover:bg-blue-50/50 px-4 py-2.5 rounded-xl transition-all cursor-pointer"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="text-xs font-extrabold uppercase tracking-wider text-blue-600 hover:bg-blue-50/50 px-4 py-2.5 rounded-xl transition-all cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

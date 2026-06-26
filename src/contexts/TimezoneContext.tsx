import React, { createContext, useContext } from 'react';

export const TimezoneContext = createContext<any>(null);

export const TimezoneProvider = ({ timezone, children }: { timezone: any; children: React.ReactNode }) => {
  return (
    <TimezoneContext.Provider value={timezone}>
      {children}
    </TimezoneContext.Provider>
  );
};

export const useTimezone = () => useContext(TimezoneContext);

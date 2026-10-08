import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DevTab } from '../src/components/DeveloperDashboard';

// Render the actual tools without network access or a background session poll.
// API actions and authorization are exercised separately by test:support-access.
const savedFetch = globalThis.fetch;
const savedInterval = globalThis.setInterval;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ user: null }), { status: 200 });
  globalThis.setInterval = (() => 0) as unknown as typeof setInterval;
  const { default: DeveloperDashboard } = await import('../src/components/DeveloperDashboard');
  const panels: Record<DevTab, string> = {
    system_overview: 'System Overview',
    app_version: 'App Version',
    database_status: 'PostgreSQL Connection Diagnostics',
    storage_monitor: 'Vine Browser Storage',
    user_count: 'user count Diagnostics',
    patient_count: 'patient count Diagnostics',
    appointment_count: 'appointment count Diagnostics',
    visit_count: 'visit count Diagnostics',
    audit_logs: 'Latest Audit Entries',
    error_logs: 'Support Session Error Capture',
    refresh_settings: 'Sync App Branding',
    clear_cache: 'Purge Client Cache',
    maintenance_mode: 'Global Maintenance Gate Changer',
  };
  for (const [currentTab, heading] of Object.entries(panels)) {
    const html = renderToStaticMarkup(React.createElement(DeveloperDashboard, {
      currentTab: currentTab as DevTab,
      onTabChange: () => {},
      branding: { appName: 'Vine', maintenanceMode: false },
      onRefreshBranding: async () => {},
    }));
    assert.ok(html.includes('Developer Tools'), `${currentTab}: tools shell missing`);
    assert.ok(html.includes(`>${heading}</h3>`), `${currentTab}: selected panel missing`);
    assert.ok(html.includes('Refresh Telemetry'), `${currentTab}: telemetry action missing`);
  }
  console.log('All 13 Developer tool panels render successfully. API action coverage is in test:support-access.');
} finally {
  globalThis.fetch = savedFetch;
  globalThis.setInterval = savedInterval;
}

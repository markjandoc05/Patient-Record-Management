import assert from 'node:assert/strict';
import { getDeveloperActivityDefinition } from '../src/developerToolsPolicy';

assert.deepEqual(getDeveloperActivityDefinition('developer_cache_cleared'), {
  action: 'DELETE', resource: 'Settings', resourceId: 'developer_browser_cache'
});
assert.deepEqual(getDeveloperActivityDefinition('developer_settings_refreshed'), {
  action: 'VIEW', resource: 'Settings', resourceId: 'developer_branding'
});
assert.equal(getDeveloperActivityDefinition('client_supplied_event'), null);

console.log('Developer Tools policy tests passed.');

import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import UserRoleSelect from '../src/components/UserRoleSelect';
import { assertDevelopmentRole } from '../backend/developmentAccess';

let checks = 0;
const render = (actorRole: string, currentRole: string, development = true, archived = false, ownAccount = false) => renderToStaticMarkup(React.createElement(UserRoleSelect, { actorRole, currentRole, development, archived, ownAccount, onChange: () => {} }));
for (const role of ['admin', 'manager', 'staff', 'doctor', 'SUPPORT_DEVELOPER', 'support_developer']) {
  const html = render('SUPPORT_DEVELOPER', role);
  assert.ok(html.includes(`value="${role}" selected=""`), `Round-trip ${role}`);
  assert.ok(!html.includes('disabled=""')); checks++;
}
for (const actor of ['SUPPORT_DEVELOPER', 'support_developer']) {
  const html = render(actor, 'support_developer');
  assert.ok(html.includes('value="SUPPORT_DEVELOPER"')); assert.ok(!html.includes('disabled=""')); checks++;
}
assert.ok(render('admin', 'SUPPORT_DEVELOPER').includes('disabled=""'));
assert.ok(!render('admin', 'staff').includes('value="SUPPORT_DEVELOPER"')); checks++;
assert.ok(render('admin', 'admin', true, false, true).includes('disabled=""')); checks++;
assert.ok(render('SUPPORT_DEVELOPER', 'staff', true, true).includes('disabled=""')); checks++;
assert.ok(!render('support_developer', 'staff', false).includes('value="SUPPORT_DEVELOPER"')); checks++;
assert.ok(render('admin', 'SUPPORT_DEVELOPER', false).includes('value="SUPPORT_DEVELOPER" selected=""')); checks++;
const previous = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = 'production';
  assert.throws(() => assertDevelopmentRole('SUPPORT_DEVELOPER'), /isolated local development/); checks++;
} finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
console.log(`${checks} role-selector rendering, round-trip and server-guard scenarios passed.`);

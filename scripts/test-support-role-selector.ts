import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import UserRoleSelect from '../src/components/UserRoleSelect';
import { assertDevelopmentRole } from '../backend/developmentAccess';
import { roleLabel, RBAC } from '../src/rbac';

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
for (const actor of ['SUPPORT_DEVELOPER', 'support_developer']) for (const development of [true, false]) {
  for (const currentRole of ['staff', 'doctor', 'admin', 'manager', 'SUPPORT_DEVELOPER']) {
    assert.ok(!render(actor, currentRole, development).includes('value="support_developer"'), 'Older identifier is not offered for a new assignment'); checks++;
  }
  const existing = render(actor, 'support_developer', development);
  assert.ok(existing.includes('value="support_developer" selected=""') && existing.includes('Support / Developer (existing account)'), 'Existing account keeps its exact stored role and readable selection'); checks++;
}
for (const role of ['SUPPORT_DEVELOPER', 'support_developer']) {
  assert.equal(roleLabel(role), 'Support / Developer', 'Everyday labels share a readable Support name'); checks++;
}
assert.deepEqual(RBAC.support_developer, RBAC.SUPPORT_DEVELOPER, 'Presentation cleanup does not change compatibility grants'); checks++;
const previous = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = 'production';
  assert.throws(() => assertDevelopmentRole('SUPPORT_DEVELOPER'), /isolated local development/); checks++;
} finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
console.log(`${checks} role-selector rendering, round-trip and server-guard scenarios passed.`);

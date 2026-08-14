import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../firebase-applet-config.json', import.meta.url), 'utf8'));
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const rulesetName = process.argv[2] || null;
const databasePath = `/databases/${config.firestoreDatabaseId}/documents`;
const userPath = `${databasePath}/users/test-user`;

const profiles = {
  staff: { active: true, role: 'staff', assignedBranches: ['branch-a'] },
  doctor: { active: true, role: 'doctor', assignedBranches: ['branch-a'] },
  manager: { active: true, role: 'manager', assignedBranches: ['branch-a'] },
  admin: { active: true, role: 'admin', assignedBranches: [] },
  support_developer: { active: true, role: 'support_developer', assignedBranches: [] },
};

function profileMocks(role, patientBranch) {
  const mocks = [
    { function: 'exists', args: [{ exactValue: userPath }], result: { value: true } },
    { function: 'get', args: [{ exactValue: userPath }], result: { value: { data: profiles[role] } } },
  ];
  if (patientBranch) {
    mocks.push({
      function: 'get',
      args: [{ exactValue: `${databasePath}/patients/patient-1` }],
      result: { value: { data: { homeBranchId: patientBranch } } },
    });
  }
  return mocks;
}

function test(name, role, method, path, expectation, resourceData, requestData, patientBranch, signInProvider = 'google.com') {
  return {
    name,
    expectation,
    request: {
      auth: {
        uid: 'test-user',
        token: {
          email: 'test@example.com',
          firebase: { sign_in_provider: signInProvider },
        },
      },
      method,
      path: `${databasePath}/${path}`,
      ...(requestData ? { resource: { data: requestData } } : {}),
    },
    ...(resourceData ? { resource: { data: resourceData } } : {}),
    functionMocks: profileMocks(role, patientBranch),
  };
}

const tests = [
  test('admin lists all patients without a branch filter', 'admin', 'list', 'patients/patient-list', 'ALLOW'),
  test('admin lists all appointments without a branch filter', 'admin', 'list', 'appointments/appointment-list', 'ALLOW'),
  test('admin lists all visits without a branch filter', 'admin', 'list', 'visits/visit-list', 'ALLOW'),
  test('staff reads assigned-branch patient', 'staff', 'get', 'patients/patient-1', 'ALLOW', { homeBranchId: 'branch-a' }),
  test('email/password account cannot access clinical records', 'staff', 'get', 'patients/patient-1', 'DENY', { homeBranchId: 'branch-a' }, null, 'branch-a', 'password'),
  test('staff reads shared patient from another branch', 'staff', 'get', 'patients/patient-1', 'ALLOW', { homeBranchId: 'branch-b' }),
  test('staff reads another branch appointment history', 'staff', 'get', 'appointments/appointment-2', 'ALLOW', { branchId: 'branch-b', patientId: 'patient-1' }),
  test('staff reads another branch visit history', 'staff', 'get', 'visits/visit-2', 'ALLOW', { branchId: 'branch-b', patientId: 'patient-1' }),
  test('admin reads any-branch patient', 'admin', 'get', 'patients/patient-1', 'ALLOW', { homeBranchId: 'branch-b' }),
  test('doctor cannot write patient directly', 'doctor', 'create', 'patients/patient-2', 'DENY', null, { homeBranchId: 'branch-a', attachments: [] }),
  test('doctor cannot create patient with client attachment metadata', 'doctor', 'create', 'patients/patient-2', 'DENY', null, { homeBranchId: 'branch-a', attachments: [{ storagePath: 'uploads/fake' }] }),
  test('doctor cannot create other-branch patient', 'doctor', 'create', 'patients/patient-2', 'DENY', null, { homeBranchId: 'branch-b' }),
  test('staff cannot write appointment directly', 'staff', 'create', 'appointments/appointment-1', 'DENY', null, { branchId: 'branch-a', patientId: 'patient-1', attachments: [] }, 'branch-a'),
  test('staff cannot create appointment with client attachment metadata', 'staff', 'create', 'appointments/appointment-1', 'DENY', null, { branchId: 'branch-a', patientId: 'patient-1', attachments: [{ storagePath: 'uploads/fake' }] }, 'branch-a'),
  test('staff cannot create other-branch appointment', 'staff', 'create', 'appointments/appointment-1', 'DENY', null, { branchId: 'branch-b', patientId: 'patient-1' }, 'branch-a'),
  test('staff cannot create appointment for other-branch patient directly', 'staff', 'create', 'appointments/appointment-1', 'DENY', null, { branchId: 'branch-a', patientId: 'patient-1' }, 'branch-b'),
  test('manager cannot write visit directly', 'manager', 'create', 'visits/visit-1', 'DENY', null, { branchId: 'branch-a', patientId: 'patient-1', attachments: [] }, 'branch-a'),
  test('manager cannot create other-branch visit directly', 'manager', 'create', 'visits/visit-1', 'DENY', null, { branchId: 'branch-b', patientId: 'patient-1' }, 'branch-a'),
  test('doctor cannot update visit directly', 'doctor', 'update', 'visits/visit-1', 'DENY', { branchId: 'branch-a', patientId: 'patient-1', attachments: [] }, { branchId: 'branch-a', patientId: 'patient-1', attachments: [], notes: 'updated' }, 'branch-a'),
  test('doctor cannot add attachment metadata directly', 'doctor', 'update', 'visits/visit-1', 'DENY', { branchId: 'branch-a', patientId: 'patient-1', attachments: [] }, { branchId: 'branch-a', patientId: 'patient-1', attachments: [{ storagePath: 'uploads/fake' }] }, 'branch-a'),
  test('doctor cannot move visit directly', 'doctor', 'update', 'visits/visit-1', 'DENY', { branchId: 'branch-a', patientId: 'patient-1' }, { branchId: 'branch-b', patientId: 'patient-1' }, 'branch-a'),
  test('admin cannot delete a patient directly', 'admin', 'delete', 'patients/patient-1', 'DENY', { homeBranchId: 'branch-a' }),
  test('staff cannot read private notes', 'staff', 'get', 'patients/patient-1/privateNotes/note-1', 'DENY', { patientId: 'patient-1', authorId: 'doctor-user' }, null, 'branch-a'),
  test('manager cannot read private clinical notes', 'manager', 'get', 'patients/patient-1/privateNotes/note-1', 'DENY', { patientId: 'patient-1', authorId: 'doctor-user' }, null, 'branch-a'),
  test('doctor reads note for assigned patient', 'doctor', 'get', 'patients/patient-1/privateNotes/note-1', 'ALLOW', { patientId: 'patient-1', authorId: 'doctor-user' }, null, 'branch-a'),
  test('doctor reads shared clinical note for other-branch patient', 'doctor', 'get', 'patients/patient-1/privateNotes/note-1', 'ALLOW', { patientId: 'patient-1', authorId: 'doctor-user' }, null, 'branch-b'),
  test('support developer retains unrestricted private-note access', 'support_developer', 'get', 'patients/patient-1/privateNotes/note-1', 'ALLOW', { patientId: 'patient-1', authorId: 'doctor-user' }, null, 'branch-b'),
  test('support developer manages clinic branches', 'support_developer', 'update', 'branches/branch-a', 'ALLOW', { branchName: 'Vine Makati', status: 'Active' }, { branchName: 'Vine Makati', status: 'Inactive' }),
  test('support developer updates timezone settings', 'support_developer', 'update', 'settings/timezone', 'ALLOW', { timezone: 'Asia/Manila', format: '12h' }, { timezone: 'Asia/Manila', format: '24h' }),
  test('support developer cannot change maintenance mode directly', 'support_developer', 'update', 'settings/branding', 'DENY', { appName: 'Vine', maintenanceMode: false }, { appName: 'Vine', maintenanceMode: true }),
  test('admin cannot change maintenance mode directly', 'admin', 'update', 'settings/branding', 'DENY', { appName: 'Vine', maintenanceMode: false }, { appName: 'Vine', maintenanceMode: true }),
  test('admin can update normal branding settings', 'admin', 'update', 'settings/branding', 'ALLOW', { appName: 'Vine', maintenanceMode: false }, { appName: 'Vine Management', maintenanceMode: false }),
  test('admin updates footer settings', 'admin', 'update', 'settings/footer', 'ALLOW', { footerText: 'Old' }, { footerText: 'Updated' }),
  test('staff cannot update attachment settings', 'staff', 'update', 'settings/media', 'DENY', { maxFileSizeMB: 1 }, { maxFileSizeMB: 10 }),
  test('manager cannot read global audit log', 'manager', 'get', 'audit_logs/log-1', 'DENY', { action: 'VIEW' }),
  test('admin reads global audit log', 'admin', 'get', 'audit_logs/log-1', 'ALLOW', { action: 'VIEW' }),
  test('support developer can review audit log without client write access', 'support_developer', 'get', 'audit_logs/log-1', 'ALLOW', { action: 'UPDATE' }),
  test('active client cannot forge an audit log', 'staff', 'create', 'audit_logs/log-2', 'DENY', null, { action: 'UPDATE', resource: 'Patient', resourceId: 'patient-1', userId: 'test-user' }),
  test('support developer cannot forge an audit log', 'support_developer', 'create', 'audit_logs/log-3', 'DENY', null, { action: 'UPDATE', resource: 'Settings', resourceId: 'branding', userId: 'test-user' }),
];

const payload = {
  ...(rulesetName ? {} : { source: { files: [{ name: 'firestore.rules', content: rules }] } }),
  testSuite: { testCases: tests.map(({ name, ...testCase }) => testCase) },
};

const token = execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim();
const response = await fetch(`https://firebaserules.googleapis.com/v1/${rulesetName || `projects/${config.projectId}`}:test`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
const result = await response.json();
if (!response.ok) throw new Error(`Rules API ${response.status}: ${JSON.stringify(result)}`);

console.log(`issues=${JSON.stringify(result.issues || [])}`);
const failures = [];
(result.testResults || []).forEach((testResult, index) => {
  const status = testResult.state === 'SUCCESS' ? 'PASS' : 'FAIL';
  console.log(`${status} ${tests[index].name}`);
  if (status === 'FAIL') failures.push({ name: tests[index].name, testResult });
});
if (failures.length > 0 || (result.issues || []).some(issue => issue.severity === 'ERROR')) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}

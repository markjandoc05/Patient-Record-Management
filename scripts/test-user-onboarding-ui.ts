import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Login from '../src/components/Login';
import ConfirmationModal from '../src/components/ConfirmationModal';
import UserActivationReadiness from '../src/components/UserActivationReadiness';
import { accountAccessMessage, activationIssues, assignmentIssues, matchesUserAccessView, PENDING_APPROVAL_MESSAGE, type UserAccessView } from '../src/utils/userActivation';

let checks = 0;
const check = (value: unknown, label: string) => { assert.ok(value, label); checks++; };
const branches = [{ id:'A',status:'Active' }, { id:'B',status:'Inactive' }];
// A disabled employee must remain discoverable for the existing Activate action.
const lifecycle = [
  { active:false,accountStatus:'pending_activation' },
  { active:true,accountStatus:'active' },
  { active:false,accountStatus:'inactive' },
  { active:false,accountStatus:'archived',isArchived:true },
];
const lifecycleViews: UserAccessView[] = ['pending','active','inactive','archived'];
for (const [index,view] of lifecycleViews.entries()) {
  check(lifecycle.filter(profile=>matchesUserAccessView(profile,view)).length===1 && matchesUserAccessView(lifecycle[index],view), `${view} account remains discoverable in the correct tab`);
}
check(matchesUserAccessView({active:false},'inactive'), 'Legacy disabled profiles without accountStatus remain discoverable');
check(!matchesUserAccessView(lifecycle[0],'inactive'), 'Pending approval remains distinct from deactivation');
check(!matchesUserAccessView(lifecycle[3],'inactive'), 'Archive does not leak into the inactive recovery view');
check(matchesUserAccessView({active:true,accountStatus:'active'},'active'), 'Reactivation returns the existing account to the active view');
for (const role of ['staff','doctor','manager']) {
  check(activationIssues({role,assignedBranches:[]},branches).some(issue=>issue.includes('at least one')), `${role} requires a clinic`);
  check(activationIssues({role,assignedBranches:['A'],defaultBranchId:'A'},branches).length===0, `${role} valid assignments ready`);
  check(activationIssues({role,assignedBranches:['B']},branches).some(issue=>issue.includes('must be active')), `${role} inactive clinic blocked`);
}
for (const role of ['admin','support_developer','SUPPORT_DEVELOPER']) {
  check(activationIssues({role,assignedBranches:[]},branches).length===0, `${role} global access retains empty-assignment exception`);
  check(activationIssues({role,assignedBranches:['B']},branches).length===0, `${role} does not require active assignments for global access`);
  check(activationIssues({role,assignedBranches:[],defaultBranchId:'A'},branches).length>0, `${role} default must still be assigned`);
}
for (const assignedBranches of ['A',[7],[''],{},null]) check(activationIssues({role:'staff',assignedBranches},branches).length>0, 'Malformed assignments cannot be ready');
check(activationIssues({role:'invented',assignedBranches:['A']},branches).some(issue=>issue.includes('valid role')), 'Unknown role blocked');
check(activationIssues({role:'staff',assignedBranches:['unknown']},branches).some(issue=>issue.includes('no longer exists')), 'Missing clinic explained');
check(activationIssues({role:'staff',assignedBranches:['A'],defaultBranchId:'B'},branches).some(issue=>issue.includes('default clinic')), 'Unassigned default explained');
check(assignmentIssues({assignedBranches:[]},branches).length===0, 'Incomplete pending assignments can be saved');
check(assignmentIssues({assignedBranches:['B']},branches).length===0, 'Draft inactive assignment retains existing write behavior');
check(activationIssues({role:'staff',assignedBranches:['A']},branches).length===0, 'Default remains optional');
check(accountAccessMessage({accountStatus:'pending_activation'})===PENDING_APPROVAL_MESSAGE, 'Both profile paths use the same pending guidance');
check(!accountAccessMessage({accountStatus:'pending_activation'}).includes('inactive'), 'Pending guidance never says inactive');
check(accountAccessMessage({accountStatus:'pending_activation',isArchived:true}).includes('archived'), 'Archived state takes precedence');
check(accountAccessMessage({accountStatus:'inactive'}).includes('reactivating'), 'Disabled account has appropriate guidance');
const pendingLogin = renderToStaticMarkup(React.createElement(Login, { branding:{appName:'Vine'},footer:{},onGoogleSignIn:async()=>{},isAuthenticating:false,authError:PENDING_APPROVAL_MESSAGE,successMessage:null,accountMissingProfile:false,pendingActivation:true }));
check(pendingLogin.includes('Awaiting administrator approval') && pendingLogin.includes('role="status"'), 'Pending login renders a status notice');
check(pendingLogin.includes('same Google account') && !pendingLogin.includes('Registration Successful'), 'Pending login describes the next action without false approval');
const incomplete = renderToStaticMarkup(React.createElement(UserActivationReadiness,{profile:{role:'staff',assignedBranches:[]},branches,loading:false}));
check(incomplete.includes('Before approval') && incomplete.includes('at least one active clinic'), 'Admin sees actionable readiness requirements');
const ready = renderToStaticMarkup(React.createElement(UserActivationReadiness,{profile:{role:'staff',assignedBranches:['A']},branches,loading:false}));
check(ready.includes('Role and clinic requirements met') && ready.includes('server will recheck'), 'Readiness does not promise completed server approval');
const delayed = renderToStaticMarkup(React.createElement(UserActivationReadiness,{profile:{role:'staff',assignedBranches:[]},branches:[],loading:true}));
check(delayed.includes('Checking activation requirements') && !delayed.includes('Before approval'), 'Delayed clinic data is distinct from a validation failure');
const retry = renderToStaticMarkup(React.createElement(ConfirmationModal,{isOpen:true,title:'Approve Pending User',message:'Approve synthetic user?',onConfirm:()=>{},onCancel:()=>{},error:'Assign at least one active clinic.'}));
check(retry.includes('role="alert"') && retry.includes('Retry action'), 'Failed approval offers visible error and retry');
const busy = renderToStaticMarkup(React.createElement(ConfirmationModal,{isOpen:true,title:'Approve Pending User',message:'Approve synthetic user?',onConfirm:()=>{},onCancel:()=>{},isSubmitting:true}));
check((busy.match(/disabled=""/g)||[]).length===2 && busy.includes('Saving'), 'Saving prevents repeated confirmation and cancellation');
console.log(`${checks} user onboarding guidance/component checks passed (static rendering, no browser or Google sign-in evidence).`);

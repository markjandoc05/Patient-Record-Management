import React from 'react';
import { activationIssues, type ActivationProfile, type ActivationBranch } from '../utils/userActivation';

export default function UserActivationReadiness({ profile, branches, loading }: {
  profile: ActivationProfile; branches: ActivationBranch[]; loading: boolean;
}) {
  const issues = activationIssues(profile, branches);
  return <div role="status" className="mt-3 text-xs leading-relaxed text-slate-700">
    <p className="font-semibold">{loading ? 'Checking activation requirements…' : issues.length ? 'Before approval' : 'Role and clinic requirements met'}</p>
    {!loading && (issues.length
      ? <ul className="mt-1 list-disc space-y-1 pl-4">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
      : <p>The server will recheck this account when you approve it. The user can then sign in again with the same Google account.</p>)}
  </div>;
}

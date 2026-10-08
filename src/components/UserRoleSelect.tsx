import React from 'react';
import { isSupportDeveloper } from '../rbac';

type Props = React.SelectHTMLAttributes<HTMLSelectElement> & {
  actorRole: string;
  currentRole: string;
  archived: boolean;
  ownAccount: boolean;
  development: boolean;
};

// This controls presentation only. The server authorizes every role write.
export default function UserRoleSelect({ actorRole, currentRole, archived, ownAccount, development, ...props }: Props) {
  const supportActor = isSupportDeveloper(actorRole);
  return <select {...props} value={currentRole || 'staff'} disabled={archived || (!supportActor && (isSupportDeveloper(currentRole) || ownAccount))}>
    <option value="admin">Admin</option>
    <option value="manager">Manager</option>
    <option value="staff">Staff</option>
    <option value="doctor">Doctor</option>
    {((supportActor && development) || currentRole === 'SUPPORT_DEVELOPER') && <option value="SUPPORT_DEVELOPER">Support / Developer</option>}
    {(supportActor || currentRole === 'support_developer') && <option value="support_developer">Support / Developer (legacy)</option>}
  </select>;
}

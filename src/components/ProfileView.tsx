import { useState, useEffect } from 'react';
import { doc, getDoc } from '../dataClient';
import { auth } from '../platform';
import { formatDateTime } from '../utils';

export default function ProfileView({ db }: { db: any }) {
  const [profile, setProfile] = useState<any>(null);
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile(docSnap.data());
      }
    };
    fetchProfile();
  }, [db, user]);

  const calculateAge = (birthdate: string) => {
    if (!birthdate) return '';
    const birthDate = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  if (!profile) return <div>Loading...</div>;

  return (
    <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm max-w-lg space-y-4">
      <h2 className="text-xl font-bold mb-6">User Profile</h2>
      <div><span className="text-sm font-semibold text-slate-500">Full Name:</span> <p className="font-medium text-slate-900">{profile.fullName || 'N/A'}</p></div>
      <div><span className="text-sm font-semibold text-slate-500">Email:</span> <p className="font-medium text-slate-900">{user?.email || 'N/A'}</p></div>
      <div><span className="text-sm font-semibold text-slate-500">Birthdate:</span> <p className="font-medium text-slate-900">{profile.birthdate ? formatDateTime(profile.birthdate) : 'N/A'}</p></div>
      <div><span className="text-sm font-semibold text-slate-500">Age:</span> <p className="font-medium text-slate-900">{calculateAge(profile.birthdate) || 'N/A'}</p></div>
      <div><span className="text-sm font-semibold text-slate-500">Contact Number:</span> <p className="font-medium text-slate-900">{profile.contactNumber || 'N/A'}</p></div>
      <div>
        <span className="text-sm font-semibold text-slate-500">Assigned Branches:</span>
        <div className="flex flex-wrap gap-2 mt-1">
          {(profile.assignedBranchNames || []).map((name: string, idx: number) => (
              <span key={idx} className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-xs font-medium border border-slate-200">
                  {name} {name === profile.defaultBranchName && '(Default)'}
              </span>
          ))}
          {(!profile.assignedBranchNames || profile.assignedBranchNames.length === 0) && (
              <span className="text-slate-400 text-sm">No branches assigned</span>
          )}
        </div>
      </div>
    </div>
  );
}

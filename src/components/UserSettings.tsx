import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth } from '../firebase';
import { CustomDatePicker } from './CustomDatePicker';
import { RBAC, Role } from '../rbac';
import { getChangedFields } from '../utils/diffUtils';
import { logActivity } from '../utils/auditLogger';
import { 
  User, 
  Mail, 
  Phone, 
  Calendar, 
  Shield, 
  MapPin, 
  Save, 
  CheckCircle, 
  Lock, 
  AlertCircle,
  Clock 
} from 'lucide-react';

export default function UserSettings({ db }: { db: any }) {
  const [profile, setProfile] = useState<any>({
    fullName: '', birthdate: '', contactNumber: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMsg, setNotificationMsg] = useState('');
  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setProfile(docSnap.data());
      }
      setLoading(false);
    };
    fetchProfile();
  }, [db, user]);

  const calculateAge = (birthdate: string) => {
    if (!birthdate) return 'N/A';
    const birthDate = new Date(birthdate);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return isNaN(age) || age < 0 ? 'N/A' : age;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const now = new Date().toISOString();
    
    // Only update allowed fields to maintain integrity
    const updatedProfile = {
        fullName: profile.fullName || '',
        birthdate: profile.birthdate || '',
        contactNumber: profile.contactNumber || '',
        lastUpdatedBy: user.uid,
        lastUpdatedDate: now
    };
    
    try {
      await updateDoc(doc(db, 'users', user.uid), updatedProfile);
      
      const changedFields = getChangedFields(profile, updatedProfile);
      await logActivity({
        action: 'UPDATE',
        resource: 'User',
        resourceId: user.uid,
        resourceName: updatedProfile.fullName,
        details: `Updated user personal profile settings. Fields modified: ${changedFields.join(', ')}`
      });

      setNotificationMsg('Account Profile updated successfully!');
      setShowNotification(true);
      setTimeout(() => setShowNotification(false), 4000);
    } catch (err: any) {
      console.error(err);
      setNotificationMsg('Failed to update settings: ' + err.message);
      setShowNotification(true);
      setTimeout(() => setShowNotification(false), 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-slate-200/80 shadow-md max-w-2xl">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-4 border-slate-100 border-t-teal-600 animate-spin"></div>
        </div>
        <p className="mt-4 text-xs font-semibold text-slate-400 uppercase tracking-widest animate-pulse">
          Loading User Account Profile...
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full" id="user-settings-container">
      {/* Success/Error Notification Indicator */}
      {showNotification && (
        <div 
          className={`mb-6 p-4 rounded-xl flex items-center justify-between border shadow-lg transition-all transform animate-fade-in ${
            notificationMsg.includes('Failed') 
              ? 'bg-red-50 border-red-200 text-red-800' 
              : 'bg-teal-50 border-teal-200 text-teal-800'
          }`}
          id="settings-notification"
        >
          <div className="flex items-center gap-3">
            {notificationMsg.includes('Failed') ? (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            ) : (
              <CheckCircle className="w-5 h-5 text-teal-600 shrink-0" />
            )}
            <span className="text-sm font-semibold tracking-tight">{notificationMsg}</span>
          </div>
          <button 
            type="button"
            onClick={() => setShowNotification(false)}
            className="text-xs uppercase font-extrabold tracking-wider hover:opacity-80 cursor-pointer ml-4"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Main Settings Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Card Header banner styled similar to Visit and Appointment Forms */}
        <div className="p-6 md:p-8 bg-slate-50 border-b border-slate-200/60 select-none">
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Account Settings</h2>
          <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mt-1.5 flex items-center gap-2">
            <User size={13} className="text-teal-600" />
            Manage your personal profile, credentials, system roles, and assigned branch accesses
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-8">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Left Column: Personal Information */}
            <div className="space-y-6">
              <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1 flex items-center gap-2">
                <User size={16} />
                Personal Details
              </h3>

              {/* Full Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Full Name
                </label>
                <div className="relative">
                  <input 
                    type="text" 
                    required
                    className="w-full h-[42px] border border-slate-300 px-3 pl-10 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                    value={profile.fullName || ''} 
                    onChange={e => setProfile({...profile, fullName: e.target.value})} 
                    placeholder="Enter full name"
                  />
                  <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              {/* Mobile Contact Number */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Contact Number
                </label>
                <div className="relative">
                  <input 
                    type="text" 
                    className="w-full h-[42px] border border-slate-300 px-3 pl-10 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                    value={profile.contactNumber || ''} 
                    onChange={e => setProfile({...profile, contactNumber: e.target.value})} 
                    placeholder="Enter mobile number"
                  />
                  <Phone size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              {/* Row: Birthdate & calculated Age */}
              <div className="grid grid-cols-5 gap-3">
                {/* Birthdate Form Field */}
                <div className="space-y-1.5 col-span-3">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                    Birthdate
                  </label>
                  <CustomDatePicker 
                    value={profile.birthdate || ''} 
                    onChange={val => setProfile({...profile, birthdate: val})} 
                  />
                </div>

                {/* Age (Read Only) */}
                <div className="space-y-1.5 col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Calculated Age
                  </label>
                  <div className="w-full h-[42px] border border-slate-200 px-3 rounded-xl text-sm bg-slate-50 text-slate-600 font-semibold flex items-center gap-2 cursor-not-allowed select-none">
                    <Clock size={15} className="text-slate-400 shrink-0" />
                    <span>{calculateAge(profile.birthdate)} yrs</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Account Access & Roles */}
            <div className="space-y-6">
              <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1 flex items-center gap-2">
                <Shield size={16} />
                Access & Security
              </h3>

              {/* Email Address (system locked) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Email Address
                  </label>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1 font-bold uppercase tracking-wider bg-slate-100 px-1.5 py-0.5 rounded">
                    <Lock size={10} /> Locked
                  </span>
                </div>
                <div className="relative">
                  <input 
                    type="email" 
                    value={user?.email || ''} 
                    disabled 
                    className="w-full h-[42px] border border-slate-200 px-3 pl-10 rounded-xl text-sm bg-slate-50 text-slate-500 cursor-not-allowed outline-none select-none" 
                  />
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </div>

              {/* Account Role Badge Status */}
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Assigned Account Role
                </label>
                <div className="bg-slate-50/50 border border-slate-200/60 p-4 rounded-xl space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-teal-50 border border-teal-100 rounded-lg text-teal-700 shrink-0">
                      <Shield size={18} />
                    </div>
                    <div>
                      <span className="text-xs uppercase font-extrabold tracking-widest text-teal-900 bg-teal-100 px-2.5 py-1 rounded">
                        {profile.role === 'support_developer' ? 'Support / Developer' : (profile.role || 'Staff')}
                      </span>
                      <p className="text-slate-500 text-[11px] font-medium mt-1">
                        Roles define system modules access scope and action permissions. Let admins manage this.
                      </p>
                    </div>
                  </div>

                  {/* Permissions matrix check */}
                  <div className="border-t border-slate-200/60 pt-4 space-y-3 select-none">
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
                      Active Access Privileges
                    </span>
                    
                    {(() => {
                      const userRoleKey = (profile.role || 'staff').toLowerCase() as Role;
                      const config = RBAC[userRoleKey] || RBAC.staff;
                      const modules = [
                        { key: 'patientRecord', name: 'Patient Records' },
                        { key: 'appointment', name: 'Appointments' },
                        { key: 'visitHistory', name: 'Visit Records' }
                      ] as const;

                      return (
                        <div className="space-y-2.5">
                          {modules.map(({ key, name }) => {
                            const perms = config[key];
                            return (
                              <div key={key} className="bg-white border border-slate-200/50 p-3 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shadow-2xs">
                                <span className="text-xs font-bold text-slate-700 shrink-0">
                                  {name}
                                </span>
                                <div className="grid grid-cols-4 gap-1">
                                  {(['create', 'read', 'update', 'delete'] as const).map(op => {
                                    const isAllowed = !!perms[op];
                                    return (
                                      <div 
                                        key={op}
                                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-center border transition-all ${
                                          isAllowed 
                                            ? 'bg-teal-50 border-teal-100 text-teal-700' 
                                            : 'bg-slate-50/40 border-slate-100 text-slate-300 line-through'
                                        }`}
                                        title={`${op.toUpperCase()} permission logic`}
                                      >
                                        {op}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Full Width Section: Branch Permissions list */}
          <div className="bg-slate-50/50 border border-slate-200/60 rounded-xl p-5 md:p-6 space-y-4">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <MapPin size={15} className="text-teal-600" />
              Your Clinic & Branch Licenses
            </h3>

            <div className="flex flex-wrap gap-2.5">
              {(profile.assignedBranchNames || []).map((name: string, idx: number) => {
                const isDefault = name === profile.defaultBranchName;
                return (
                  <span 
                    key={idx} 
                    className={`px-4 py-2 rounded-xl text-xs font-bold font-sans flex items-center gap-1.5 border transition-all ${
                      isDefault 
                        ? 'bg-teal-600 text-white border-teal-600 shadow-sm' 
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <MapPin size={13} className={isDefault ? 'text-teal-200' : 'text-slate-400'} />
                    {name}
                    {isDefault && (
                      <span className="bg-teal-800 text-[9px] px-1.5 py-0.5 uppercase tracking-widest rounded text-teal-100 ml-1">
                        Default
                      </span>
                    )}
                  </span>
                );
              })}
              {(!profile.assignedBranchNames || profile.assignedBranchNames.length === 0) && (
                <div className="text-slate-400 text-xs font-semibold uppercase tracking-widest py-1">
                  No branch licenses linked to this account
                </div>
              )}
            </div>
          </div>

          {/* Submit Save Button */}
          <div className="border-t border-slate-100 pt-6 flex justify-end">
            <button 
              type="submit" 
              disabled={saving}
              className={`min-w-[170px] h-[46px] rounded-xl text-xs font-extrabold uppercase tracking-widest text-white shadow-md transition-all flex items-center justify-center gap-2 select-none cursor-pointer ${
                saving 
                  ? 'bg-slate-400 cursor-not-allowed' 
                  : 'bg-teal-600 hover:bg-teal-700 active:bg-teal-800 focus:ring-4 focus:ring-teal-500/20'
              }`}
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Saving Profile...</span>
                </>
              ) : (
                <>
                  <Save size={14} className="text-teal-100" />
                  <span>Save Profile Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

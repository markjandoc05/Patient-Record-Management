import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, setDoc, getDoc, getDocs, addDoc, writeBatch, limit, query, where } from '../dataClient';
import { auth } from '../platform';
import imageCompression from 'browser-image-compression';
import { getChangedFields } from '../utils/diffUtils';
import { handleDataError, OperationType } from '../utils';
import { RBAC } from '../rbac';
import { logActivity } from '../utils/auditLogger';
import { activateUserAccount, archiveUserAccount, deactivateUserAccount, deleteUserAccount, restoreUserAccount } from '../utils/userAccountApi';
import { fetchLoginActivity, type LoginActivityRecord } from '../utils/loginActivityApi';
import { DEFAULT_MEDIA_SETTINGS, IMAGE_OPTIMIZATION, normalizeMediaSettings } from '../mediaSettings';
import ConfirmationModal from './ConfirmationModal';
import {
  Building2,
  ChevronDown,
  Clock3,
  Database,
  FileText,
  Palette,
  Settings2,
  ShieldCheck,
  Archive,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  Users,
  MonitorSmartphone,
} from 'lucide-react';

type SettingsTab = 'general' | 'branches' | 'access' | 'data';
type GeneralSection = 'general' | 'time' | 'theme' | 'footer';
type UserAccessView = 'active' | 'pending' | 'archived';

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; description: string; icon: React.ElementType }> = [
  { id: 'general', label: 'General', description: 'Brand, uploads, time and footer', icon: Settings2 },
  { id: 'branches', label: 'Clinics', description: 'Locations and branch status', icon: Building2 },
  { id: 'access', label: 'Access', description: 'Users, roles and assignments', icon: Users },
  { id: 'data', label: 'Data safety', description: 'Retention and cleanup guidance', icon: Database },
];

const GENERAL_SECTIONS: Array<{ id: GeneralSection; label: string; description: string; icon: React.ElementType }> = [
  { id: 'general', label: 'General settings', description: 'Clinic, app identity and files', icon: Settings2 },
  { id: 'time', label: 'Time & date', description: 'Timezone and clock format', icon: Clock3 },
  { id: 'theme', label: 'Themes & appearance', description: 'Workspace colors and styling', icon: Palette },
  { id: 'footer', label: 'Footer & legal links', description: 'Footer text and policies', icon: FileText },
];

const isValidOptionalUrl = (value: string) => {
  if (!value.trim()) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};
 
export default function AdminSettings({ db, userRole, branding, timezone, footer, userProfile }: { db: any, userRole: string|null, branding: any, timezone: any, footer: any, userProfile: any }) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('general');
  const [openGeneralSection, setOpenGeneralSection] = useState<GeneralSection | null>('general');
  const [users, setUsers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [timezoneForm, setTimezoneForm] = useState<any>({
    timezone: 'Asia/Manila',
    displayName: '(UTC+08:00) Philippine Standard Time',
    format: '12h'
  });
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [timezoneSuccess, setTimezoneSuccess] = useState('');
  
  const [footerForm, setFooterForm] = useState<any>({
    footerText: '',
    copyrightNotice: '',
    privacyPolicyUrl: '',
    termsConditionsUrl: '',
    showDeveloperCredit: true,
    developerCreditText: 'Developed by AIPH.TECH',
    developerCreditUrl: 'https://aiph.tech'
  });
  const [savingFooter, setSavingFooter] = useState(false);
  const [footerSuccess, setFooterSuccess] = useState('');
  const [newBranch, setNewBranch] = useState({ branchName: '', address: '', contactNumber: '', email: '' });
  const [isBranchOpen, setIsBranchOpen] = useState(true);
  const [isUserAccessOpen, setIsUserAccessOpen] = useState(true);
  const [userAccessView, setUserAccessView] = useState<UserAccessView>('active');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [openUserActionMenuId, setOpenUserActionMenuId] = useState<string | null>(null);
  const [isRoleAccessOpen, setIsRoleAccessOpen] = useState(false);
  const [isLoginActivityOpen, setIsLoginActivityOpen] = useState(false);
  const [loginActivity, setLoginActivity] = useState<LoginActivityRecord[]>([]);
  const [loadingLoginActivity, setLoadingLoginActivity] = useState(false);
  const [loginActivityError, setLoginActivityError] = useState('');
  const [isDataManagementOpen, setIsDataManagementOpen] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editBranchData, setEditBranchData] = useState({ branchName: '', address: '', contactNumber: '', email: '' });
  const [actionToConfirm, setActionToConfirm] = useState<null | {
    onConfirm: () => Promise<void>;
    title: string;
    message: string;
    confirmLabel?: string;
  }>(null);

  // Dynamic white-label branding configurations
  const [brandingForm, setBrandingForm] = useState<any>({
    appName: '',
    appShortName: '',
    appLogoUrl: '',
    faviconUrl: '',
    loginPageLogoUrl: '',
    browserTitle: '',
    companyName: '',
    companyAddress: '',
    contactNumber: '',
    supportEmail: '',
    websiteUrl: '',
    primaryColor: '#0d9488',
    secondaryColor: '#0f766e',
    accentColor: '#14b8a6',
    darkMode: false,
    footerText: '',
    copyrightNotice: '',
    privacyPolicyUrl: '',
    termsConditionsUrl: '',
    showDeveloperCredit: true,
    developerCreditText: 'Developed by AIPH.TECH',
    developerCreditUrl: 'https://aiph.tech'
  });

  const [savingBranding, setSavingBranding] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [brandingSuccess, setBrandingSuccess] = useState('');
  const [mediaSuccess, setMediaSuccess] = useState('');
  const [mediaSettings, setMediaSettings] = useState({ ...DEFAULT_MEDIA_SETTINGS });

  const normalizedUserRole = userRole?.toLowerCase();
  const canManageSettings = normalizedUserRole === 'admin' || normalizedUserRole === 'support_developer';
  const canManageFooter = normalizedUserRole === 'support_developer';
  const getAccountStatus = (account: any) => {
    if (account.isArchived === true || account.accountStatus === 'archived') return { label: 'Archived', className: 'bg-slate-100 text-slate-600' };
    if (account.active === true) return { label: 'Active', className: 'bg-emerald-50 text-emerald-700' };
    if (account.accountStatus === 'pending_activation') return { label: 'Pending Activation', className: 'bg-amber-50 text-amber-700' };
    return { label: 'Inactive', className: 'bg-slate-100 text-slate-600' };
  };

  const loadLoginActivity = async () => {
    if (!canManageSettings) return;
    setLoadingLoginActivity(true);
    setLoginActivityError('');
    try {
      const result = await fetchLoginActivity();
      setLoginActivity(result.records);
    } catch (loadError) {
      console.error('Failed to load login activity', loadError);
      setLoginActivityError(loadError instanceof Error ? loadError.message : 'Unable to load login activity.');
    } finally {
      setLoadingLoginActivity(false);
    }
  };

  useEffect(() => {
    if (activeSettingsTab === 'access' && isLoginActivityOpen && loginActivity.length === 0 && !loadingLoginActivity) {
      void loadLoginActivity();
    }
  }, [activeSettingsTab, isLoginActivityOpen]);

  const renderGeneralSectionToggle = (id: GeneralSection) => {
    const section = GENERAL_SECTIONS.find(item => item.id === id)!;
    const Icon = section.icon;
    const isOpen = openGeneralSection === id;
    return (
      <button
        type="button"
        onClick={() => setOpenGeneralSection(isOpen ? null : id)}
        aria-expanded={isOpen}
        aria-controls={`general-settings-${id}`}
        className={`flex w-full min-w-0 items-center gap-3 border border-slate-200 bg-white px-5 py-4 text-left text-slate-700 shadow-sm transition hover:bg-slate-50 sm:px-6 ${isOpen ? 'rounded-t-2xl' : 'rounded-2xl'}`}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{section.label}</span>
          <span className="block truncate text-xs text-slate-400">{section.description}</span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
    );
  };

  const showActionSuccess = (message: string) => {
    setError('');
    setActionSuccess(message);
    window.setTimeout(() => setActionSuccess(''), 4000);
  };

  const showActionError = (message: string) => {
    setActionSuccess('');
    setError(message);
  };

  useEffect(() => {
    if (branding) {
      setBrandingForm({
        appName: branding.appName || '',
        appShortName: branding.appShortName || '',
        appLogoUrl: branding.appLogoUrl || '',
        faviconUrl: branding.faviconUrl || '',
        loginPageLogoUrl: branding.loginPageLogoUrl || '',
        browserTitle: branding.browserTitle || '',
        companyName: branding.companyName || '',
        companyAddress: branding.companyAddress || '',
        contactNumber: branding.contactNumber || '',
        supportEmail: branding.supportEmail || '',
        websiteUrl: branding.websiteUrl || '',
        primaryColor: branding.primaryColor || '#0d9488',
        secondaryColor: branding.secondaryColor || '#0f766e',
        accentColor: branding.accentColor || '#14b8a6',
        darkMode: !!branding.darkMode,
        footerText: branding.footerText || '',
        copyrightNotice: branding.copyrightNotice || '',
        privacyPolicyUrl: branding.privacyPolicyUrl || '',
        termsConditionsUrl: branding.termsConditionsUrl || '',
        showDeveloperCredit: branding.showDeveloperCredit !== false,
        developerCreditText: branding.developerCreditText || 'Developed by AIPH.TECH',
        developerCreditUrl: branding.developerCreditUrl || 'https://aiph.tech'
      });
    }
    if (timezone) {
        setTimezoneForm(timezone);
    }
    if (footer) {
        setFooterForm(footer);
    }
  }, [branding, timezone, footer]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Verify role directly from DB
    const userDoc = await getDoc(doc(db, 'users', auth.currentUser!.uid));
    const dbRole = userDoc.exists() ? userDoc.data()?.role : null;
    console.log("AdminSettings: DB role verification:", dbRole);

    if (dbRole !== 'admin' && dbRole !== 'support_developer') {
        console.error("Branding upload failed: unauthorized access by role:", dbRole);
        setError("Permission Denied: Only Admin and Support / Developer can update branding.");
        return;
    }

    setUploadingField(fieldName);
    setBrandingSuccess('');
    setError('');
    
    // Determine path based on fieldName
    const pathMap: Record<string, string> = {
        appLogoUrl: 'app-logo',
        faviconUrl: 'favicon',
        loginPageLogoUrl: 'login-logo'
    };
    const folder = pathMap[fieldName] || 'misc';
    try {
        let fileToUpload: File | Blob = file;
        
        // Compress image if it's an image
        if (file.name.match(/\.(jpg|jpeg|png|webp|ico)$/i)) {
            console.log(`Compressing branding asset ${file.name}...`);
            const options = {
                maxSizeMB: 0.2, // Branding logos should be even smaller, 200KB max
                maxWidthOrHeight: 800,
                useWebWorker: true,
            };
            try {
                fileToUpload = await imageCompression(file, options);
            } catch (compressionError) {
                console.error("Compression failed for branding asset:", compressionError);
            }
        }

        const token = await auth.currentUser!.getRequestToken();
        const formData = new FormData();
        formData.append('file', fileToUpload, file.name);
        formData.append('folder', folder);
        const uploadResponse = await fetch('/api/branding/upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData
        });
        const uploadResult = await uploadResponse.json();
        if (!uploadResponse.ok) throw new Error(uploadResult?.error || 'Branding upload failed');
        const { downloadUrl, storagePath } = uploadResult;
        const newTimestamp = Date.now();
        const assetMetadata = {
            fileName: file.name,
            fileUrl: downloadUrl,
            storagePath: storagePath,
            uploadedByUid: auth.currentUser?.uid,
            uploadedByName: userProfile?.fullName || 'Admin',
            uploadedAt: new Date().toISOString()
        };
        
        // Update branding document
        console.log("AdminSettings: About to update branding document in PostgreSQL");
        await setDoc(doc(db, 'settings', 'branding'), {
            [fieldName]: downloadUrl,
            [`${fieldName}_metadata`]: assetMetadata,
            updatedAt: newTimestamp
        }, { merge: true });
        console.log("AdminSettings: PostgreSQL update successful");
        
        // Update local state
        setBrandingForm((prev: any) => ({
            ...prev,
            [fieldName]: downloadUrl,
            updatedAt: newTimestamp
        }));
        
        await logActivity({
            action: 'UPDATE',
            resource: 'Settings',
            resourceId: 'branding',
            details: `Uploaded and persistent-saved branding image: ${fieldName}`,
            userProfile: { role: userRole }
        });
        
        setBrandingSuccess(`Branding asset (${fieldName}) uploaded and saved successfully!`);
        setTimeout(() => setBrandingSuccess(''), 4000);
    } catch (err: any) {
        console.error("AdminSettings: Branding image upload/save error:", err);
        setError("Failed to upload image: " + err.message);
    } finally {
        setUploadingField(null);
    }
  };

  const handleRemoveBrandingAsset = async (fieldName: string) => {
    if (!canManageSettings) {
      showActionError('You do not have permission to update branding assets.');
      return;
    }
    try {
      const updatedAt = Date.now();
      await setDoc(doc(db, 'settings', 'branding'), {
        [fieldName]: '',
        [`${fieldName}_metadata`]: null,
        updatedAt,
      }, { merge: true });
      setBrandingForm((previous: any) => ({ ...previous, [fieldName]: '', updatedAt }));
      await logActivity({
        action: 'UPDATE', resource: 'Settings', resourceId: 'branding',
        details: `Removed branding asset: ${fieldName}`,
        userProfile: { role: userRole, fullName: userProfile?.fullName }
      });
      showActionSuccess('Branding asset removed. The app has switched to its fallback immediately.');
    } catch (removeError: any) {
      showActionError(`Unable to remove the branding asset: ${removeError?.message || 'Unknown error'}`);
      handleDataError(removeError, OperationType.UPDATE, 'settings/branding', auth);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("AdminSettings: Attempting to save all branding settings", brandingForm);
    
    // Verify role directly from DB
    const userDoc = await getDoc(doc(db, 'users', auth.currentUser!.uid));
    const dbRole = userDoc.exists() ? userDoc.data()?.role : null;
    console.log("AdminSettings: DB role verification (save):", dbRole);
    
    const isAdminOrSupport = dbRole === 'admin' || dbRole === 'support_developer';
    if (!isAdminOrSupport) {
        console.error("AdminSettings: Branding save failed: unauthorized access by role:", dbRole);
        setError("Permission Denied: Only Admin and Support / Developer can update branding.");
        return;
    }
    if (![brandingForm.primaryColor, brandingForm.secondaryColor, brandingForm.accentColor].every((color: string) => /^#[0-9a-f]{6}$/i.test(color))) {
        showActionError('Theme colors must use a valid six-digit hex value, such as #0D9488.');
        return;
    }
    if (![brandingForm.websiteUrl].every((url: string) => isValidOptionalUrl(url || ''))) {
        showActionError('Enter a valid clinic website URL beginning with http:// or https://.');
        return;
    }
    
    setSavingBranding(true);
    setBrandingSuccess('');
    setError('');
    
    try {
      const newTimestamp = Date.now();
      const updatedBranding = {
        ...brandingForm,
        updatedAt: newTimestamp
      };
      
      console.log("AdminSettings: Writing branding to PostgreSQL path settings/branding");
      await setDoc(doc(db, 'settings', 'branding'), updatedBranding, { merge: true });
      
      await logActivity({
          action: 'UPDATE',
          resource: 'Settings',
          resourceId: 'branding',
          details: 'Updated global white-label branding configurations',
          userProfile: { role: userRole }
      });
      
      setBrandingSuccess('Branding and general settings saved successfully!');
      setTimeout(() => setBrandingSuccess(''), 4000);
    } catch (err: any) {
      console.error("AdminSettings: Branding save error:", err);
      setError('Failed to save settings: ' + (err.message || String(err)));
      handleDataError(err, OperationType.UPDATE, 'settings/branding', auth);
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSaveTimezone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSettings) {
      showActionError('You do not have permission to update timezone settings.');
      return;
    }
    const normalizedTimezone = String(timezoneForm.timezone || '').trim();
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalizedTimezone }).format();
    } catch {
      showActionError('Enter a valid IANA timezone, such as Asia/Manila.');
      return;
    }
    setSavingTimezone(true);
    setTimezoneSuccess('');
    setError('');
    
    try {
      const normalizedTimezoneForm = { ...timezoneForm, timezone: normalizedTimezone };
      await setDoc(doc(db, 'settings', 'timezone'), normalizedTimezoneForm, { merge: true });
      setTimezoneForm(normalizedTimezoneForm);
      
      await logActivity({
          action: 'UPDATE',
          resource: 'Settings',
          resourceId: 'timezone',
          details: 'Updated global timezone configurations',
          userProfile: { role: userRole }
      });
      
      setTimezoneSuccess('Timezone settings saved successfully!');
      setTimeout(() => setTimezoneSuccess(''), 4000);
    } catch (err: any) {
      setError('Failed to save timezone settings: ' + (err.message || String(err)));
      handleDataError(err, OperationType.UPDATE, 'settings/timezone', auth);
    } finally {
      setSavingTimezone(false);
    }
  };
  
  const handleSaveFooter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageFooter) {
      showActionError('You do not have permission to update footer settings.');
      return;
    }
    const footerUrls = [footerForm.privacyPolicyUrl, footerForm.termsConditionsUrl, footerForm.developerCreditUrl];
    if (!footerUrls.every(value => isValidOptionalUrl(String(value || '')))) {
      showActionError('Footer links must be valid URLs beginning with http:// or https://.');
      return;
    }
    setSavingFooter(true);
    setFooterSuccess('');
    setError('');
    
    try {
      const changes = getChangedFields(footer || {}, footerForm);
      await setDoc(doc(db, 'settings', 'footer'), footerForm, { merge: true });
      
      await logActivity({
          action: 'UPDATE',
          resource: 'Settings',
          resourceId: 'footer',
          details: 'Updated global footer configurations',
          changes: changes,
          userProfile: { role: userRole as string, fullName: userProfile?.fullName }
      });
      
      setFooterSuccess('Footer settings saved successfully!');
      setTimeout(() => setFooterSuccess(''), 4000);
    } catch (err: any) {
      setError('Failed to save footer settings: ' + (err.message || String(err)));
      handleDataError(err, OperationType.UPDATE, 'settings/footer', auth);
    } finally {
      setSavingFooter(false);
    }
  };
  
  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleDataError(error, OperationType.LIST, 'users', auth));
    
    const unsubBranches = onSnapshot(collection(db, 'branches'), (snapshot) => {
      setBranches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleDataError(error, OperationType.LIST, 'branches', auth));
    
    // Fetch media settings
    const unsubMedia = onSnapshot(doc(db, 'settings', 'media'), (doc) => {
      if (doc.exists()) {
          setMediaSettings(normalizeMediaSettings(doc.data()));
      }
    }, (snapshotError) => handleDataError(snapshotError, OperationType.GET, 'settings/media', auth));
    
    return () => { unsubUsers(); unsubBranches(); unsubMedia(); };
  }, [db]);

  const handleSaveMediaSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canManageSettings) {
          showActionError('You do not have permission to update attachment settings.');
          return;
      }
      const allowedExtensions = mediaSettings.allowedExtensions
          .map(extension => extension.trim().toLowerCase())
          .filter(Boolean)
          .map(extension => extension.startsWith('.') ? extension : `.${extension}`);
      const normalizedExtensions = [...new Set(allowedExtensions)];
      if (normalizedExtensions.length === 0) {
          showActionError('Add at least one allowed file extension.');
          return;
      }
      if (!Number.isFinite(mediaSettings.maxFileSizeMB) || mediaSettings.maxFileSizeMB < 1 || mediaSettings.maxFileSizeMB > 10) {
          showActionError('Maximum file size must be between 1 MB and 10 MB.');
          return;
      }
      if (!Number.isInteger(mediaSettings.maxFilesPerRecord) || mediaSettings.maxFilesPerRecord < 1 || mediaSettings.maxFilesPerRecord > 20) {
          showActionError('Files per patient record must be a whole number between 1 and 20.');
          return;
      }
      setSavingMedia(true);
      setMediaSuccess('');
      setError('');
      try {
          const normalizedMediaSettings = normalizeMediaSettings({ ...mediaSettings, allowedExtensions: normalizedExtensions });
          await setDoc(doc(db, 'settings', 'media'), {
            ...normalizedMediaSettings,
            // Retained temporarily so an older deployed server observes the same limit during rollout.
            maxFilesPerAppointment: normalizedMediaSettings.maxFilesPerRecord,
          }, { merge: true });
          setMediaSettings(normalizedMediaSettings);
          await logActivity({
              action: 'UPDATE',
              resource: 'Settings',
              resourceId: 'media',
              details: 'Updated attachment upload restrictions',
              userProfile: { role: userRole, fullName: userProfile?.fullName }
          });
          setMediaSuccess('Patient-record file settings saved successfully!');
          setTimeout(() => setMediaSuccess(''), 4000);
      } catch (err: any) {
          setError('Failed to save media settings: ' + (err.message || String(err)));
          handleDataError(err, OperationType.UPDATE, 'settings/media', auth);
      } finally {
          setSavingMedia(false);
      }
  };

  const updateRole = async (userId: string, newRole: string) => {
    if (!canManageSettings) return;
    try {
        await updateDoc(doc(db, 'users', userId), { role: newRole });
        await logActivity({
            action: 'UPDATE',
            resource: 'User',
            resourceId: userId,
            details: `Updated user role to: ${newRole}`,
            userProfile: { role: userRole }
        });
        showActionSuccess('User role updated.');
    } catch (error) {
        showActionError('Unable to update the user role.');
        handleDataError(error, OperationType.UPDATE, `users/${userId}`, auth);
    }
  };

  const updateUserBranches = async (user: any, branch: any, isAssigning: boolean) => {
    if (!canManageSettings) return;
    const assignments = (user.assignedBranches || []).map((branchId: string, index: number) => ({
      id: branchId,
      name: user.assignedBranchNames?.[index] || branches.find(item => item.id === branchId)?.branchName || '',
    }));
    const nextAssignments = isAssigning
      ? [...assignments.filter((item: any) => item.id !== branch.id), { id: branch.id, name: branch.branchName }]
      : assignments.filter((item: any) => item.id !== branch.id);
    const nextDefault = nextAssignments.some((item: any) => item.id === user.defaultBranchId)
      ? nextAssignments.find((item: any) => item.id === user.defaultBranchId)
      : nextAssignments[0];

    try {
      await updateDoc(doc(db, 'users', user.id), {
        assignedBranches: nextAssignments.map((item: any) => item.id),
        assignedBranchNames: nextAssignments.map((item: any) => item.name),
        defaultBranchId: nextDefault?.id || null,
        defaultBranchName: nextDefault?.name || null,
      });
      await logActivity({
        action: 'UPDATE', resource: 'User', resourceId: user.id,
        details: `${isAssigning ? 'Assigned' : 'Unassigned'} clinic branch: ${branch.branchName}`,
        userProfile: { role: userRole, fullName: userProfile?.fullName }
      });
      showActionSuccess(`Branch access ${isAssigning ? 'assigned' : 'removed'} for ${user.fullName || user.email}.`);
    } catch (updateError) {
      showActionError('Unable to update this user’s clinic access.');
      handleDataError(updateError, OperationType.UPDATE, `users/${user.id}`, auth);
    }
  };

  const setUserDefaultBranch = async (user: any, branch: any) => {
    if (!canManageSettings) return;
    try {
      await updateDoc(doc(db, 'users', user.id), { defaultBranchId: branch.id, defaultBranchName: branch.branchName });
      await logActivity({
        action: 'UPDATE', resource: 'User', resourceId: user.id,
        details: `Set default clinic branch to: ${branch.branchName}`,
        userProfile: { role: userRole, fullName: userProfile?.fullName }
      });
      showActionSuccess(`Default clinic updated for ${user.fullName || user.email}.`);
    } catch (updateError) {
      showActionError('Unable to set the default clinic.');
      handleDataError(updateError, OperationType.UPDATE, `users/${user.id}`, auth);
    }
  };

  const toggleUserStatus = async (user: any) => {
    if (!canManageSettings || user.id === auth.currentUser?.uid) return;
    try {
      if (!user.active) {
        await activateUserAccount(user.id);
        showActionSuccess('User account activated. Their assigned role and clinic access now apply.');
        return;
      } else {
        await deactivateUserAccount(user.id);
        showActionSuccess('User account disabled. They can no longer sign in until activated.');
        return;
      }
    } catch (updateError) {
      showActionError('Unable to update the user account status.');
      handleDataError(updateError, OperationType.UPDATE, `users/${user.id}`, auth);
    }
  };

  const archiveUser = async (user: any) => {
    if (!canManageSettings || user.id === auth.currentUser?.uid) return;
    try {
      await archiveUserAccount(user.id);
      showActionSuccess(`${user.fullName || user.email} was archived and can be restored later.`);
    } catch (archiveError: any) {
      showActionError(archiveError.message || 'Unable to archive this user account.');
    }
  };

  const restoreArchivedUser = async (user: any) => {
    if (!canManageSettings || user.id === auth.currentUser?.uid) return;
    try {
      await restoreUserAccount(user.id);
      showActionSuccess(`${user.fullName || user.email} was restored and can sign in again.`);
    } catch (restoreError: any) {
      showActionError(restoreError.message || 'Unable to restore this user account.');
    }
  };

  const deleteUser = async (user: any) => {
    if (!canManageSettings || user.id === auth.currentUser?.uid) return;
    try {
      await deleteUserAccount(user.id);
      showActionSuccess(`${user.fullName || user.email} was deleted. Clinical and audit history were retained.`);
    } catch (deleteError: any) {
      showActionError(deleteError.message || 'Unable to delete this user account.');
    }
  };

  const handleAddBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSettings) {
      showActionError('You do not have permission to add clinic branches.');
      return;
    }
    const normalizedBranch = {
      branchName: newBranch.branchName.trim(),
      address: newBranch.address.trim(),
      contactNumber: newBranch.contactNumber.trim(),
      email: newBranch.email.trim().toLowerCase(),
    };
    if (!normalizedBranch.branchName) {
      showActionError('Clinic branch name is required.');
      return;
    }
    try {
        const docRef = await addDoc(collection(db, 'branches'), {
            ...normalizedBranch,
            status: 'Active',
            createdAt: new Date().toISOString()
        });
        await logActivity({
            action: 'CREATE',
            resource: 'Branch',
            resourceId: docRef.id,
            resourceName: normalizedBranch.branchName,
            details: 'Created new branch',
            userProfile: { role: userRole }
        });
        setNewBranch({ branchName: '', address: '', contactNumber: '', email: '' });
        showActionSuccess('Clinic branch added.');
    } catch (error) {
        showActionError('Unable to add the clinic branch.');
        handleDataError(error, OperationType.CREATE, 'branches', auth);
    }
  };

  const toggleBranchStatus = async (branchId: string, currentStatus: string) => {
      if (!canManageSettings) {
          showActionError('You do not have permission to change branch status.');
          return;
      }
      try {
          const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
          await updateDoc(doc(db, 'branches', branchId), { status: newStatus });
          await logActivity({
              action: 'UPDATE',
              resource: 'Branch',
              resourceId: branchId,
              details: `Changed branch status to: ${newStatus}`,
              userProfile: { role: userRole }
          });
          showActionSuccess(`Clinic branch ${newStatus === 'Active' ? 'activated' : 'deactivated'}.`);
      } catch (error) {
          showActionError('Unable to change the clinic branch status.');
          handleDataError(error, OperationType.UPDATE, `branches/${branchId}`, auth);
      }
  };

  const executeDeleteBranch = async (id: string, name: string) => {
    if (!canManageSettings) {
        showActionError('You do not have permission to delete clinic branches.');
        return;
    }
    try {
        const [patientRefs, appointmentRefs, visitRefs] = await Promise.all([
          getDocs(query(collection(db, 'patients'), where('homeBranchId', '==', id), limit(1))),
          getDocs(query(collection(db, 'appointments'), where('branchId', '==', id), limit(1))),
          getDocs(query(collection(db, 'visits'), where('branchId', '==', id), limit(1))),
        ]);
        if (![patientRefs, appointmentRefs, visitRefs].every(snapshot => snapshot.empty)) {
          showActionError(`“${name}” has linked clinical records and cannot be deleted. Deactivate it instead to preserve record history.`);
          return;
        }
        const batch = writeBatch(db);
        batch.delete(doc(db, 'branches', id));
        users.filter(user => userRole === 'support_developer' || user.role !== 'support_developer').forEach(user => {
          const assignedBranches = user.assignedBranches || [];
          if (!assignedBranches.includes(id)) return;
          const nextIds = assignedBranches.filter((branchId: string) => branchId !== id);
          const nextNames = nextIds.map((branchId: string) => branches.find(branch => branch.id === branchId)?.branchName || '');
          const nextDefaultId = user.defaultBranchId === id ? (nextIds[0] || null) : user.defaultBranchId;
          batch.update(doc(db, 'users', user.id), {
            assignedBranches: nextIds,
            assignedBranchNames: nextNames,
            defaultBranchId: nextDefaultId,
            defaultBranchName: nextDefaultId ? branches.find(branch => branch.id === nextDefaultId)?.branchName || null : null,
          });
        });
        await batch.commit();
        await logActivity({
            action: 'DELETE',
            resource: 'Branch',
            resourceId: id,
            resourceName: name,
            details: 'Deleted branch',
            userProfile: { role: userRole }
        });
        showActionSuccess('Clinic branch deleted.');
    } catch (error) {
        showActionError('Unable to delete the clinic branch.');
        handleDataError(error, OperationType.DELETE, `branches/${id}`, auth);
    }
  };
   
  const confirmDeleteBranch = (id: string, name: string) => {
      setActionToConfirm({
          onConfirm: () => executeDeleteBranch(id, name),
          title: "Delete Branch",
          message: `Delete "${name}"? This is only allowed when the branch has no linked clinical records. Otherwise, deactivate it to preserve history.`
      });
  };

  const handleUpdateBranch = async () => {
    if (!canManageSettings) {
        showActionError('You do not have permission to update clinic branches.');
        return;
    }
    if (!editingBranchId) return;
    const normalizedEditBranch = {
      branchName: editBranchData.branchName.trim(),
      address: editBranchData.address.trim(),
      contactNumber: editBranchData.contactNumber.trim(),
      email: editBranchData.email.trim().toLowerCase(),
    };
    if (!normalizedEditBranch.branchName) {
      showActionError('Clinic branch name is required.');
      return;
    }
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'branches', editingBranchId), normalizedEditBranch);
        users.filter(user => userRole === 'support_developer' || user.role !== 'support_developer').forEach(user => {
          if (!(user.assignedBranches || []).includes(editingBranchId)) return;
          const assignedBranchNames = (user.assignedBranches || []).map((branchId: string, index: number) =>
            branchId === editingBranchId ? normalizedEditBranch.branchName : (user.assignedBranchNames?.[index] || branches.find(branch => branch.id === branchId)?.branchName || '')
          );
          batch.update(doc(db, 'users', user.id), {
            assignedBranchNames,
            ...(user.defaultBranchId === editingBranchId ? { defaultBranchName: normalizedEditBranch.branchName } : {}),
          });
        });
        await batch.commit();
        await logActivity({
            action: 'UPDATE',
            resource: 'Branch',
            resourceId: editingBranchId,
            resourceName: normalizedEditBranch.branchName,
            details: 'Updated branch details',
            userProfile: { role: userRole }
        });
        setEditingBranchId(null);
        showActionSuccess('Clinic branch updated.');
    } catch (error) {
        showActionError('Unable to update the clinic branch.');
        handleDataError(error, OperationType.UPDATE, `branches/${editingBranchId}`, auth);
    }
  }

  const startEditBranch = (branch: any) => {
      setEditingBranchId(branch.id);
      setEditBranchData({
          branchName: branch.branchName,
          address: branch.address,
          contactNumber: branch.contactNumber,
          email: branch.email || ''
      });
  }

  const confirmUpdateBranch = () => {
      setActionToConfirm({
          onConfirm: handleUpdateBranch,
          title: "Update Branch",
          message: `Are you sure you want to save changes to "${editBranchData.branchName}"?`
      });
  };

  const cleanupBranchAssignments = async () => {
    if (!canManageSettings) {
        showActionError('You do not have permission to repair branch assignments.');
        return;
    }
    try {
        const batch = writeBatch(db);
        let updatedCount = 0;
        const validBranchIds = branches.map(b => b.id);

        for (const user of users.filter(user => userRole === 'support_developer' || user.role !== 'support_developer')) {
             let needsUpdate = false;
             let assignedBranches = [...(user.assignedBranches || [])];
             let assignedBranchNames = [...(user.assignedBranchNames || [])];
             let defaultBranchId = user.defaultBranchId;
             let defaultBranchName = user.defaultBranchName;

             // Remove invalid assigned branches
             const newAssignedBranches = [];
             const newAssignedBranchNames = [];
             for (let i = 0; i < assignedBranches.length; i++) {
                 if (validBranchIds.includes(assignedBranches[i])) {
                     newAssignedBranches.push(assignedBranches[i]);
                     newAssignedBranchNames.push(assignedBranchNames[i]);
                 } else {
                     needsUpdate = true;
                 }
             }

             // Check default branch
             if (defaultBranchId && !newAssignedBranches.includes(defaultBranchId)) {
                needsUpdate = true;
                if (newAssignedBranches.length > 0) {
                    defaultBranchId = newAssignedBranches[0];
                    defaultBranchName = newAssignedBranchNames[0];
                } else {
                    defaultBranchId = null;
                    defaultBranchName = null;
                }
             }

             if (needsUpdate) {
                 batch.update(doc(db, 'users', user.id), {
                     assignedBranches: newAssignedBranches,
                     assignedBranchNames: newAssignedBranchNames,
                     defaultBranchId: defaultBranchId,
                     defaultBranchName: defaultBranchName
                 });
                 updatedCount++;
             }
        }

        if (updatedCount > 0) {
            await batch.commit();
            showActionSuccess(`Cleaned invalid branch assignments for ${updatedCount} users.`);
        } else {
            showActionSuccess('All branch assignments are already valid.');
        }

    } catch (error) {
        showActionError('Unable to clean invalid branch assignments.');
        handleDataError(error, OperationType.UPDATE, 'users', auth);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6">
        <ConfirmationModal 
          isOpen={!!actionToConfirm}
          title={actionToConfirm?.title || ""}
          message={actionToConfirm?.message || ""}
          onConfirm={async () => {
            if (actionToConfirm) await actionToConfirm.onConfirm();
            setActionToConfirm(null);
          }}
          onCancel={() => setActionToConfirm(null)}
          confirmLabel={actionToConfirm?.confirmLabel || 'Confirm Action'}
        />
    {userRole === 'admin' || userRole === 'support_developer' ? (
      <>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-teal-700">
                <ShieldCheck className="h-4 w-4" /> Administration
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">Clinic settings</h2>
              <p className="mt-1 text-sm text-slate-500">Manage app identity, clinic locations, staff access, and operational safeguards.</p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-teal-700 shadow-sm"><ShieldCheck className="h-4.5 w-4.5" /></div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Your access</p>
                <p className="text-sm font-semibold text-slate-800">{userRole === 'support_developer' ? 'Support / Developer' : 'Administrator'}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
            {SETTINGS_TABS.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSettingsTab(id)}
                aria-pressed={activeSettingsTab === id}
                className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left transition ${activeSettingsTab === id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <Icon className={`h-4.5 w-4.5 shrink-0 ${activeSettingsTab === id ? 'text-teal-300' : 'text-slate-400'}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className={`hidden truncate text-[11px] lg:block ${activeSettingsTab === id ? 'text-slate-300' : 'text-slate-400'}`}>{description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {(actionSuccess || error) && (
          <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || actionSuccess}
          </div>
        )}

        {/* General settings */}
        {activeSettingsTab === 'general' && (
                <form onSubmit={handleSaveBranding} className="space-y-3" aria-label="General settings sections">
                    {renderGeneralSectionToggle('general')}

                    {/* SECTION 1: Application Branding */}
                    {openGeneralSection === 'general' && (
                    <div id="general-settings-general" className="-mt-3 space-y-5 rounded-b-2xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm sm:p-6 animate-fade-in">
                    <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
                        <h3 className="mb-1 text-sm font-semibold text-slate-900">Application identity</h3>
                        <p className="mb-5 text-xs text-slate-500">Names and visual assets used across the sidebar, browser, and sign-in screen.</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">App Name</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.appName} 
                                    onChange={e => setBrandingForm({...brandingForm, appName: e.target.value})} 
                                    placeholder="Skin Clinic Patient Records"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">App Short Name</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.appShortName} 
                                    onChange={e => setBrandingForm({...brandingForm, appShortName: e.target.value})} 
                                    placeholder="Lumina Skin"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Browser Title</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.browserTitle} 
                                    onChange={e => setBrandingForm({...brandingForm, browserTitle: e.target.value})} 
                                    placeholder="Skin Clinic Patient Records"
                                />
                            </div>
                        </div>

                        {/* File Uploads for App Branding */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                            {/* App Logo */}
                            <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col gap-2">
                                <span className="text-[10px] font-bold text-slate-600 uppercase">App Logo (Sidebar)</span>
                                {brandingForm.appLogoUrl && (
                                    <div className="h-16 w-full flex items-center justify-center bg-slate-100 rounded-lg overflow-hidden border">
                                        <img src={brandingForm.appLogoUrl} alt="App Logo" className="h-12 max-w-full object-contain" referrerPolicy="no-referrer" />
                                    </div>
                                )}
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300" 
                                    onChange={e => handleLogoUpload(e, 'appLogoUrl')}
                                />
                                {uploadingField === 'appLogoUrl' && <span className="text-[10px] text-teal-600 font-medium">Uploading...</span>}
                                {brandingForm.appLogoUrl && <button type="button" onClick={() => setActionToConfirm({ onConfirm: () => handleRemoveBrandingAsset('appLogoUrl'), title: 'Remove App Logo', message: 'Remove the sidebar and header logo? The app will immediately use its initials fallback.' })} className="self-start text-[10px] font-semibold text-red-600 hover:underline">Remove logo</button>}
                            </div>

                            {/* Favicon */}
                            <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col gap-2">
                                <span className="text-[10px] font-bold text-slate-600 uppercase">Favicon (Browser Icon)</span>
                                {brandingForm.faviconUrl && (
                                    <div className="h-16 w-full flex items-center justify-center bg-slate-100 rounded-lg overflow-hidden border">
                                        <img src={brandingForm.faviconUrl} alt="Favicon" className="h-8 w-8 object-contain" referrerPolicy="no-referrer" />
                                    </div>
                                )}
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300" 
                                    onChange={e => handleLogoUpload(e, 'faviconUrl')}
                                />
                                {uploadingField === 'faviconUrl' && <span className="text-[10px] text-teal-600 font-medium">Uploading...</span>}
                                {brandingForm.faviconUrl && <button type="button" onClick={() => setActionToConfirm({ onConfirm: () => handleRemoveBrandingAsset('faviconUrl'), title: 'Remove Favicon', message: 'Remove the custom browser icon?' })} className="self-start text-[10px] font-semibold text-red-600 hover:underline">Remove favicon</button>}
                            </div>

                            {/* Login Page Logo */}
                            <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 flex flex-col gap-2">
                                <span className="text-[10px] font-bold text-slate-600 uppercase">Login Page Logo</span>
                                {brandingForm.loginPageLogoUrl && (
                                    <div className="h-16 w-full flex items-center justify-center bg-slate-100 rounded-lg overflow-hidden border">
                                        <img src={brandingForm.loginPageLogoUrl} alt="Login Logo" className="h-12 max-w-full object-contain" referrerPolicy="no-referrer" />
                                    </div>
                                )}
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300" 
                                    onChange={e => handleLogoUpload(e, 'loginPageLogoUrl')}
                                />
                                {uploadingField === 'loginPageLogoUrl' && <span className="text-[10px] text-teal-600 font-medium">Uploading...</span>}
                                {brandingForm.loginPageLogoUrl && <button type="button" onClick={() => setActionToConfirm({ onConfirm: () => handleRemoveBrandingAsset('loginPageLogoUrl'), title: 'Remove Login Logo', message: 'Remove the dedicated login logo? The login page will fall back to the main app logo.' })} className="self-start text-[10px] font-semibold text-red-600 hover:underline">Use app logo instead</button>}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: Company Information */}
                    <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
                        <h3 className="mb-1 text-sm font-semibold text-slate-900">Clinic information</h3>
                        <p className="mb-5 text-xs text-slate-500">Primary clinic details used throughout the workspace and support experience.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Company / Clinic Name</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.companyName} 
                                    onChange={e => setBrandingForm({...brandingForm, companyName: e.target.value})} 
                                    placeholder="Skin Clinic"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Address</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.companyAddress} 
                                    onChange={e => setBrandingForm({...brandingForm, companyAddress: e.target.value})} 
                                    placeholder="Enter physical clinical location"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Contact Number</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.contactNumber} 
                                    onChange={e => setBrandingForm({...brandingForm, contactNumber: e.target.value})} 
                                    placeholder="+1-555-0199"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Support Email</label>
                                <input 
                                    type="email" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.supportEmail} 
                                    onChange={e => setBrandingForm({...brandingForm, supportEmail: e.target.value})} 
                                    placeholder="support@skinclinic.com"
                                />
                            </div>
                            <div className="flex flex-col gap-1 md:col-span-2">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Website URL</label>
                                <input 
                                    type="url" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.websiteUrl} 
                                    onChange={e => setBrandingForm({...brandingForm, websiteUrl: e.target.value})} 
                                    placeholder="https://www.skinclinic.com"
                                />
                            </div>
                        </div>
                    </div>

                     {/* SECTION 5: Files and attachments */}
                     <div className="rounded-xl border border-slate-200 p-4 sm:p-5">
                        <h3 className="mb-1 text-sm font-semibold text-slate-900">Files and attachment format</h3>
                        <p className="mb-5 text-xs text-slate-500">Controls uploads saved to patient, visit, and appointment records. Defaults are 1 MB per file and 5 files per record.</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Allowed Extensions (comma separated)</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={mediaSettings.allowedExtensions.join(',')} 
                                    onChange={e => setMediaSettings({...mediaSettings, allowedExtensions: e.target.value.split(',')})} 
                                    placeholder=".png,.jpg,.jpeg,.webp,.pdf"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Max File Size (MB)</label>
                                <input 
                                    type="number" 
                                    min="1"
                                    max="10"
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={mediaSettings.maxFileSizeMB} 
                                    onChange={e => setMediaSettings({...mediaSettings, maxFileSizeMB: Number(e.target.value)})}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Max Files per Record</label>
                                <input 
                                    type="number" 
                                    min="1"
                                    max="20"
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={mediaSettings.maxFilesPerRecord}
                                    onChange={e => setMediaSettings({...mediaSettings, maxFilesPerRecord: Number(e.target.value)})}
                                />
                            </div>
                            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 md:col-span-3">
                                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                                <div>
                                    <p className="text-xs font-semibold text-emerald-900">Automatic image optimization is always on</p>
                                    <p className="mt-0.5 text-[11px] leading-5 text-emerald-700">Patient-record images are resized to {IMAGE_OPTIMIZATION.maxWidthOrHeight}px and compressed below 500 KB before Cloud Run receives them. Originals are not uploaded when optimization fails.</p>
                                </div>
                            </div>
                            <div className="flex flex-col items-start gap-2 md:col-span-3 sm:flex-row sm:items-center">
                                <button 
                                    type="button"
                                    onClick={handleSaveMediaSettings}
                                    disabled={savingMedia}
                                    className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 transition"
                                >
                                {savingMedia ? 'Saving...' : 'Save file settings'}
                                </button>
                                {mediaSuccess && <span className="ml-3 text-xs text-green-600 font-semibold">{mediaSuccess}</span>}
                            </div>
                        </div>
                     </div>

                    <div className="flex flex-col items-center justify-between gap-4 pt-1 sm:flex-row">
                        <div>
                            {brandingSuccess && <p className="text-xs font-semibold text-green-600">{brandingSuccess}</p>}
                        </div>
                        <button
                            type="submit"
                            disabled={savingBranding || uploadingField !== null}
                            className="rounded-lg px-6 py-2.5 text-sm font-bold text-white shadow-md transition disabled:opacity-50"
                            style={{ backgroundColor: brandingForm.primaryColor || '#0d9488' }}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = brandingForm.secondaryColor || '#0f766e')}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = brandingForm.primaryColor || '#0d9488')}
                        >
                            {savingBranding ? 'Saving settings...' : 'Save general settings'}
                        </button>
                    </div>
                    </div>
                    )}

                    {renderGeneralSectionToggle('time')}

                    {/* SECTION 6: Time and date */}
                    {openGeneralSection === 'time' && (
                    <div id="general-settings-time" className="-mt-3 rounded-b-2xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm sm:p-5 animate-fade-in">
                        <p className="mb-5 text-xs text-slate-500">Set the clinic-wide timezone and time format.</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Default Timezone</label>
                                <input
                                    type="text"
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm"
                                    value={timezoneForm.timezone}
                                    onChange={e => setTimezoneForm({...timezoneForm, timezone: e.target.value})}
                                    placeholder="Asia/Manila"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Display Name</label>
                                <input
                                    type="text"
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm"
                                    value={timezoneForm.displayName}
                                    onChange={e => setTimezoneForm({...timezoneForm, displayName: e.target.value})}
                                    placeholder="(UTC+08:00) Philippine Standard Time"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Time Format</label>
                                <select
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm"
                                    value={timezoneForm.format}
                                    onChange={e => setTimezoneForm({...timezoneForm, format: e.target.value})}
                                >
                                    <option value="12h">12-hour</option>
                                    <option value="24h">24-hour</option>
                                </select>
                            </div>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                type="button"
                                onClick={handleSaveTimezone}
                                disabled={savingTimezone}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                                style={{ backgroundColor: brandingForm.primaryColor || '#0d9488' }}
                            >
                                {savingTimezone ? 'Saving...' : 'Save time & date'}
                            </button>
                        </div>
                        {timezoneSuccess && <p className="text-teal-600 text-xs mt-2">{timezoneSuccess}</p>}
                    </div>
                    )}

                    {renderGeneralSectionToggle('theme')}

                    {/* SECTION 7: Theme & Appearance */}
                    {openGeneralSection === 'theme' && (
                    <div id="general-settings-theme" className="-mt-3 rounded-b-2xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm sm:p-5 animate-fade-in">
                        <p className="mb-5 text-xs text-slate-500">Choose the brand colors used for highlights and primary actions.</p>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Primary Color</label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        className="w-10 h-10 border rounded-lg cursor-pointer bg-white"
                                        value={brandingForm.primaryColor}
                                        onChange={e => setBrandingForm({...brandingForm, primaryColor: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm flex-1 uppercase"
                                        value={brandingForm.primaryColor}
                                        onChange={e => setBrandingForm({...brandingForm, primaryColor: e.target.value})}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Secondary Color</label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        className="w-10 h-10 border rounded-lg cursor-pointer bg-white"
                                        value={brandingForm.secondaryColor}
                                        onChange={e => setBrandingForm({...brandingForm, secondaryColor: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm flex-1 uppercase"
                                        value={brandingForm.secondaryColor}
                                        onChange={e => setBrandingForm({...brandingForm, secondaryColor: e.target.value})}
                                    />
                                </div>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Accent Color</label>
                                <div className="flex gap-2">
                                    <input
                                        type="color"
                                        className="w-10 h-10 border rounded-lg cursor-pointer bg-white"
                                        value={brandingForm.accentColor}
                                        onChange={e => setBrandingForm({...brandingForm, accentColor: e.target.value})}
                                    />
                                    <input
                                        type="text"
                                        className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm flex-1 uppercase"
                                        value={brandingForm.accentColor}
                                        onChange={e => setBrandingForm({...brandingForm, accentColor: e.target.value})}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="mt-5 flex flex-col items-center justify-between gap-4 sm:flex-row">
                            <div>
                                {brandingSuccess && <p className="text-xs font-semibold text-green-600">{brandingSuccess}</p>}
                            </div>
                            <button
                                type="submit"
                                disabled={savingBranding || uploadingField !== null}
                                className="rounded-lg px-6 py-2.5 text-sm font-bold text-white shadow-md transition disabled:opacity-50"
                                style={{ backgroundColor: brandingForm.primaryColor || '#0d9488' }}
                                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = brandingForm.secondaryColor || '#0f766e')}
                                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = brandingForm.primaryColor || '#0d9488')}
                            >
                                {savingBranding ? 'Saving settings...' : 'Save appearance'}
                            </button>
                        </div>
                    </div>
                    )}

                    {canManageFooter && renderGeneralSectionToggle('footer')}

                    {/* SECTION 8: Footer */}
                    {canManageFooter && openGeneralSection === 'footer' && (
                    <div id="general-settings-footer" className="-mt-3 rounded-b-2xl border border-t-0 border-slate-200 bg-white p-4 shadow-sm sm:p-5 animate-fade-in">
                        <p className="mb-5 text-xs text-slate-500">Manage footer copy, policy links, and developer attribution.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Footer Text</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={footerForm.footerText || ''} 
                                    onChange={e => setFooterForm({...footerForm, footerText: e.target.value})} 
                                    placeholder="HIPAA Compliant Skin Clinic Patient Records System."
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Copyright Notice</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={footerForm.copyrightNotice || ''} 
                                    onChange={e => setFooterForm({...footerForm, copyrightNotice: e.target.value})} 
                                    placeholder="© 2026 Skin Clinic Patient Records. All rights reserved."
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Privacy Policy URL</label>
                                <input 
                                    type="url" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={footerForm.privacyPolicyUrl || ''} 
                                    onChange={e => setFooterForm({...footerForm, privacyPolicyUrl: e.target.value})} 
                                    placeholder="https://yourclinic.com/privacy"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Terms & Conditions URL</label>
                                <input 
                                    type="url" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={footerForm.termsConditionsUrl || ''} 
                                    onChange={e => setFooterForm({...footerForm, termsConditionsUrl: e.target.value})} 
                                    placeholder="https://yourclinic.com/terms"
                                />
                            </div>
                            <div className="flex flex-col gap-1 md:col-span-2 border-t pt-4 mt-2">
                                <span className="text-xs font-bold text-slate-700">Developer Credit Settings</span>
                            </div>
                            <div className="flex items-center gap-2 pt-1 col-span-1 md:col-span-2">
                                <input 
                                    type="checkbox" 
                                    id="showDeveloperCreditToggle"
                                    className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500"
                                    checked={footerForm.showDeveloperCredit ?? true} 
                                    onChange={e => setFooterForm({...footerForm, showDeveloperCredit: e.target.checked})} 
                                />
                                <label htmlFor="showDeveloperCreditToggle" className="text-xs font-semibold text-slate-700">Display Developer Credit in Footer</label>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Developer Credit Text</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm disabled:opacity-50" 
                                    value={footerForm.developerCreditText || ''} 
                                    onChange={e => setFooterForm({...footerForm, developerCreditText: e.target.value})} 
                                    placeholder="Developed by AIPH.TECH"
                                    disabled={!footerForm.showDeveloperCredit}
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Developer Credit Link URL (Optional)</label>
                                <input 
                                    type="url" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm disabled:opacity-50" 
                                    value={footerForm.developerCreditUrl || ''} 
                                    onChange={e => setFooterForm({...footerForm, developerCreditUrl: e.target.value})} 
                                    placeholder="https://aiph.tech"
                                    disabled={!footerForm.showDeveloperCredit}
                                />
                            </div>
                        <div className="flex justify-end pt-4 md:col-span-2">
                            <button 
                                type="button" 
                                onClick={handleSaveFooter}
                                disabled={savingFooter}
                                className="font-bold text-sm px-6 py-2.5 bg-teal-600 text-white rounded-lg shadow-md transition disabled:opacity-50 hover:bg-teal-700"
                            >
                                {savingFooter ? 'Saving...' : 'Save footer & legal links'}
                            </button>
                        </div>
                        {footerSuccess && <p className="text-teal-600 text-xs mt-2">{footerSuccess}</p>}
                    </div>
                </div>
            )}
            
                </form>
        )}

        {/* Development / Data Management Settings Accordion */}
        {activeSettingsTab === 'data' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6" onClick={() => setIsDataManagementOpen(!isDataManagementOpen)} aria-expanded={isDataManagementOpen}>
                <span className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Database className="h-5 w-5" /></span><span><span className="block text-base font-semibold text-slate-900">Data safety</span><span className="block text-xs font-normal text-slate-500">Retention, backups, and safe maintenance guidance</span></span></span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isDataManagementOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {isDataManagementOpen && (
                <div className="grid gap-4 border-t border-slate-100 px-5 py-6 animate-fade-in sm:px-6 lg:grid-cols-3">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-900">Protected clinical records</p><p className="mt-1 text-xs leading-5 text-emerald-800">Patient, appointment, visit, and audit data cannot be purged from the browser.</p></div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-900">Controlled retention</p><p className="mt-1 text-xs leading-5 text-slate-600">Permanent cleanup must use a reviewed retention policy, verified backup, and server-side audit trail.</p></div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-900">Recoverable operations</p><p className="mt-1 text-xs leading-5 text-slate-600">Use archive and restore actions for day-to-day record management whenever available.</p></div>
                </div>
            )}
        </div>
        )}

        {/* Existing Branch accordion */}
        {activeSettingsTab === 'branches' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6" onClick={() => setIsBranchOpen(!isBranchOpen)} aria-expanded={isBranchOpen}>
                <span className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Building2 className="h-5 w-5" /></span><span><span className="block text-base font-semibold text-slate-900">Clinic locations</span><span className="block text-xs font-normal text-slate-500">{branches.length} {branches.length === 1 ? 'branch' : 'branches'} · {branches.filter(branch => branch.status === 'Active').length} active</span></span></span>
                <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isBranchOpen ? 'rotate-180' : ''}`} />
            </button>
            {isBranchOpen && (
                <div className="space-y-8 border-t border-slate-100 px-5 py-6 sm:px-6">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                        <h3 className="text-sm font-semibold text-slate-900">Add clinic branch</h3>
                        <p className="mb-4 mt-1 text-xs text-slate-500">Create a location before assigning staff or recording branch activity.</p>
                        <form onSubmit={handleAddBranch} className="grid grid-cols-1 items-end gap-3 md:grid-cols-2 lg:grid-cols-5">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Branch Name</label>
                                <input type="text" className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" value={newBranch.branchName} onChange={e => setNewBranch({...newBranch, branchName: e.target.value})} required />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Address</label>
                                <input type="text" className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" value={newBranch.address} onChange={e => setNewBranch({...newBranch, address: e.target.value})} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Contact</label>
                                <input type="text" className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" value={newBranch.contactNumber} onChange={e => setNewBranch({...newBranch, contactNumber: e.target.value})} />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Email</label>
                                <input type="email" className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" value={newBranch.email} onChange={e => setNewBranch({...newBranch, email: e.target.value})} />
                            </div>
                            <button type="submit" className="px-4 py-2 bg-teal-600 text-white rounded-lg font-semibold hover:bg-teal-700 transition text-sm">Add Branch</button>
                        </form>
                    </div>

                    <div>
                        <h3 className="mb-3 text-sm font-semibold text-slate-900">Existing branches</h3>
                        {branches.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">No clinic branches yet. Add the first branch above.</div>
                        ) : (
                          <div className="grid gap-3 xl:grid-cols-2">
                            {branches.map(branch => (
                              <article key={branch.id} className="rounded-xl border border-slate-200 p-4 sm:p-5">
                                {editingBranchId === branch.id ? (
                                  <div className="space-y-4">
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div><label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Branch name</label><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editBranchData.branchName} onChange={e => setEditBranchData({...editBranchData, branchName: e.target.value})} /></div>
                                      <div><label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Address</label><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editBranchData.address} onChange={e => setEditBranchData({...editBranchData, address: e.target.value})} /></div>
                                      <div><label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Contact</label><input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editBranchData.contactNumber} onChange={e => setEditBranchData({...editBranchData, contactNumber: e.target.value})} /></div>
                                      <div><label className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Email</label><input type="email" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={editBranchData.email} onChange={e => setEditBranchData({...editBranchData, email: e.target.value})} /></div>
                                    </div>
                                    <div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingBranchId(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600">Cancel</button><button type="button" onClick={confirmUpdateBranch} className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white">Save changes</button></div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-slate-900">{branch.branchName}</h4><p className="mt-1 text-xs leading-5 text-slate-500">{branch.address || 'No address provided'}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${branch.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{branch.status}</span></div>
                                    <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500 sm:grid-cols-2"><div><span className="block text-[10px] font-semibold uppercase text-slate-400">Contact</span><span className="mt-1 block text-slate-700">{branch.contactNumber || 'Not provided'}</span></div><div><span className="block text-[10px] font-semibold uppercase text-slate-400">Email</span><span className="mt-1 block break-all text-slate-700">{branch.email || 'Not provided'}</span></div></div>
                                    <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => startEditBranch(branch)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button><button type="button" onClick={() => setActionToConfirm({ onConfirm: () => toggleBranchStatus(branch.id, branch.status), title: branch.status === 'Active' ? 'Deactivate Branch' : 'Activate Branch', message: `${branch.status === 'Active' ? 'Deactivate' : 'Activate'} ${branch.branchName}? ${branch.status === 'Active' ? 'Historical records remain available, but new activity should use another clinic.' : 'The branch will be available for new clinic activity.'}` })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${branch.status === 'Active' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{branch.status === 'Active' ? 'Deactivate' : 'Activate'}</button><button type="button" onClick={() => confirmDeleteBranch(branch.id, branch.branchName)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-red-700">Delete</button></div>
                                  </>
                                )}
                              </article>
                            ))}
                          </div>
                        )}
                    </div>
                </div>
            )}
        </div>
        )}

        {activeSettingsTab === 'access' && (
        <>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6" onClick={() => setIsUserAccessOpen(!isUserAccessOpen)} aria-expanded={isUserAccessOpen}>
              <span className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Users className="h-5 w-5" /></span><span><span className="block text-base font-semibold text-slate-900">User access</span><span className="block text-xs font-normal text-slate-500">{users.filter(user => user.role !== 'support_developer' && user.active).length} active · {users.filter(user => user.role !== 'support_developer' && user.accountStatus === 'pending_activation').length} pending activation</span></span></span>
              <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isUserAccessOpen ? 'rotate-180' : ''}`} />
          </button>
          {isUserAccessOpen && (
              <div className="border-t border-slate-100">
                  {(() => {
                    const manageableUsers = users.filter(user => userRole === 'support_developer' || user.role !== 'support_developer');
                    const visibleUsers = manageableUsers.filter(user => {
                      if (userAccessView === 'archived') return user.isArchived === true;
                      if (userAccessView === 'pending') return user.isArchived !== true && user.accountStatus === 'pending_activation';
                      return user.isArchived !== true && user.active === true;
                    });
                    const countedUsers = manageableUsers.filter(user => user.role !== 'support_developer');
                    const activeCount = countedUsers.filter(user => user.isArchived !== true && user.active === true).length;
                    const pendingCount = countedUsers.filter(user => user.isArchived !== true && user.accountStatus === 'pending_activation').length;
                    const archivedCount = countedUsers.filter(user => user.isArchived === true).length;
                    return <>
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 sm:px-6">
                        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="User account status">
                          <button type="button" role="tab" aria-selected={userAccessView === 'active'} onClick={() => { setUserAccessView('active'); setExpandedUserId(null); setOpenUserActionMenuId(null); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${userAccessView === 'active' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Active users <span className="ml-1 text-slate-400">{activeCount}</span></button>
                          <button type="button" role="tab" aria-selected={userAccessView === 'pending'} onClick={() => { setUserAccessView('pending'); setExpandedUserId(null); setOpenUserActionMenuId(null); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${userAccessView === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Pending activation <span className="ml-1 text-slate-400">{pendingCount}</span></button>
                          <button type="button" role="tab" aria-selected={userAccessView === 'archived'} onClick={() => { setUserAccessView('archived'); setExpandedUserId(null); setOpenUserActionMenuId(null); }} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${userAccessView === 'archived' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Archived users <span className="ml-1 text-slate-400">{archivedCount}</span></button>
                        </div>
                        <button type="button" onClick={() => setActionToConfirm({ onConfirm: cleanupBranchAssignments, title: 'Clean Invalid Assignments', message: 'Clean invalid branch assignments for all users?', confirmLabel: 'Clean assignments' })} className="text-xs font-semibold text-slate-500 transition hover:text-slate-900">Clean assignments</button>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {visibleUsers.map(user => {
                          const isExpanded = expandedUserId === user.id;
                          const isOwnAccount = user.id === auth.currentUser?.uid;
                          const canManageLifecycle = !isOwnAccount;
                          const clinicCount = user.assignedBranches?.length || 0;
                          const accountStatus = getAccountStatus(user);
                          return <article key={user.id} className="relative">
                            <div className="flex min-h-16 items-center gap-3 px-5 py-3 sm:px-6">
                              <button type="button" onClick={() => { setExpandedUserId(isExpanded ? null : user.id); setOpenUserActionMenuId(null); }} aria-expanded={isExpanded} className="grid min-w-0 flex-1 items-center gap-3 text-left sm:grid-cols-[minmax(190px,1.25fr)_minmax(200px,1.45fr)_130px_110px_82px]">
                                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900">{user.fullName || user.name || 'Name not set'}</span><span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:hidden">Name</span></span>
                                <span className="hidden truncate text-sm text-slate-500 sm:block">{user.email || 'No email address'}</span>
                                <span className="hidden text-sm capitalize text-slate-600 sm:block">{user.role === 'support_developer' ? 'Support / Developer' : user.role || 'Staff'}</span>
                                <span className="hidden text-sm text-slate-500 sm:block">{clinicCount} {clinicCount === 1 ? 'clinic' : 'clinics'}</span>
                                <span className={`hidden w-fit rounded-full px-2 py-1 text-[10px] font-semibold sm:inline-flex ${accountStatus.className}`}>{accountStatus.label}</span>
                              </button>
                              <div className="relative flex shrink-0 items-center gap-1">
                                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold sm:hidden ${accountStatus.className}`}>{accountStatus.label}</span>
                                <button type="button" onClick={() => setOpenUserActionMenuId(openUserActionMenuId === user.id ? null : user.id)} aria-label={`More actions for ${user.fullName || user.email}`} aria-expanded={openUserActionMenuId === user.id} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><MoreHorizontal className="h-4 w-4" /></button>
                                {openUserActionMenuId === user.id && <div className="absolute right-0 top-9 z-10 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"><p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">More actions</p>{userAccessView === 'archived' ? <button type="button" disabled={!canManageLifecycle} onClick={() => { setOpenUserActionMenuId(null); setActionToConfirm({ onConfirm: () => restoreArchivedUser(user), title: 'Restore Archived User', message: `Restore ${user.fullName || user.email}? They will become active and regain access based on their assigned role and clinics.`, confirmLabel: 'Restore user' }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-3.5 w-3.5" /> Restore</button> : <><button type="button" disabled={!canManageLifecycle} onClick={() => { setOpenUserActionMenuId(null); setActionToConfirm({ onConfirm: () => toggleUserStatus(user), title: user.active ? 'Disable User' : user.accountStatus === 'pending_activation' ? 'Approve Pending User' : 'Activate User', message: user.active ? `Disable ${user.fullName || user.email}? They will lose access until reactivated.` : `Approve and activate ${user.fullName || user.email}? They can sign in with their assigned role and clinic access.`, confirmLabel: user.active ? 'Disable user' : user.accountStatus === 'pending_activation' ? 'Approve & activate' : 'Activate user' }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{user.active ? 'Disable user' : user.accountStatus === 'pending_activation' ? 'Approve & activate' : 'Activate user'}</button><button type="button" disabled={!canManageLifecycle} onClick={() => { setOpenUserActionMenuId(null); setActionToConfirm({ onConfirm: () => archiveUser(user), title: 'Archive User', message: `Archive ${user.fullName || user.email}? Their account will be deactivated, their records will be retained, and an administrator can restore it later.`, confirmLabel: 'Archive user' }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40"><Archive className="h-3.5 w-3.5" /> Archive user</button></>}<button type="button" disabled={!canManageLifecycle} onClick={() => { setOpenUserActionMenuId(null); setActionToConfirm({ onConfirm: () => deleteUser(user), title: 'Delete User', message: `Permanently delete ${user.fullName || user.email}? They will no longer be able to sign in. Clinical records and audit history will not be removed.`, confirmLabel: 'Delete user' }); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> Delete user</button></div>}
                              </div>
                              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                            </div>
                            {isExpanded && <div className="grid gap-4 bg-slate-50/70 px-5 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:px-6"><div><label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Role</label><select onChange={(e) => { const nextRole = e.target.value; setActionToConfirm({ onConfirm: () => updateRole(user.id, nextRole), title: 'Change User Role', message: `Change ${user.fullName || user.email} to ${nextRole === 'support_developer' ? 'Support / Developer' : nextRole}? Their permissions will update immediately.`, confirmLabel: 'Change role' }); }} value={user.role || 'staff'} className="w-full rounded-lg border border-slate-200 bg-white p-2 text-sm" disabled={userAccessView === 'archived' || (userRole !== 'support_developer' && user.role === 'support_developer') || (userRole !== 'support_developer' && isOwnAccount)}><option value="admin">Admin</option><option value="manager">Manager</option><option value="staff">Staff</option><option value="doctor">Doctor</option>{userRole === 'support_developer' && <option value="support_developer">Support / Developer</option>}</select></div><div><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Clinic access</p><div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{branches.filter(branch => branch.status === 'Active').map(branch => { const isChecked = user.assignedBranches?.includes(branch.id); return <div key={branch.id} className="flex min-w-0 items-center gap-2 text-xs"><input id={`user-${user.id}-branch-${branch.id}`} type="checkbox" checked={!!isChecked} disabled={userAccessView === 'archived'} onChange={(event) => updateUserBranches(user, branch, event.target.checked)} /><label htmlFor={`user-${user.id}-branch-${branch.id}`} className="min-w-0 cursor-pointer truncate text-slate-700">{branch.branchName}</label>{isChecked && user.assignedBranches.length > 1 && <button type="button" disabled={userAccessView === 'archived'} className={`ml-auto text-[10px] font-semibold ${user.defaultBranchId === branch.id ? 'text-teal-700' : 'text-slate-400 hover:text-slate-700'}`} onClick={() => setUserDefaultBranch(user, branch)}>{user.defaultBranchId === branch.id ? 'Default' : 'Set default'}</button>}</div>; })}{branches.filter(branch => branch.status === 'Active').length === 0 && <p className="text-xs text-red-600">Add or activate a branch before assigning access.</p>}</div></div></div>}
                          </article>;
                        })}
                        {visibleUsers.length === 0 && <div className="px-5 py-12 text-center text-sm text-slate-500 sm:px-6">{userAccessView === 'archived' ? 'No archived user accounts.' : userAccessView === 'pending' ? 'No user accounts are pending activation.' : 'No active user accounts.'}</div>}
                      </div>
                    </>;
                  })()}
              </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6" onClick={() => setIsLoginActivityOpen(!isLoginActivityOpen)} aria-expanded={isLoginActivityOpen}>
            <span className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><MonitorSmartphone className="h-5 w-5" /></span><span><span className="block text-base font-semibold text-slate-900">Login activity</span><span className="block text-xs font-normal text-slate-500">Recent approved-account sign-ins, IP, approximate location, and device details</span></span></span>
            <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isLoginActivityOpen ? 'rotate-180' : ''}`} />
          </button>
          {isLoginActivityOpen && (
            <div className="border-t border-slate-100 p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">Support / Developer sign-in activity is intentionally not recorded or displayed.</p>
                <button type="button" onClick={() => void loadLoginActivity()} disabled={loadingLoginActivity} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">{loadingLoginActivity ? 'Refreshing…' : 'Refresh'}</button>
              </div>
              {loginActivityError && <p role="alert" className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{loginActivityError}</p>}
              {loadingLoginActivity && loginActivity.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">Loading login activity…</p>
              ) : loginActivity.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No login activity has been recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-left text-xs">
                    <thead className="border-y border-slate-100 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2.5">User</th><th className="px-3 py-2.5">Date & time</th><th className="px-3 py-2.5">IP address</th><th className="px-3 py-2.5">Approximate location</th><th className="px-3 py-2.5">Browser</th><th className="px-3 py-2.5">Operating system</th><th className="px-3 py-2.5">Device</th></tr></thead>
                    <tbody className="divide-y divide-slate-100 text-slate-600">
                      {loginActivity.map(record => <tr key={record.id} className="hover:bg-slate-50/70"><td className="px-3 py-3"><span className="block font-semibold text-slate-800">{record.userName}</span><span className="block text-[11px] text-slate-400">{record.userEmail}</span></td><td className="px-3 py-3 whitespace-nowrap">{record.timestamp ? new Date(record.timestamp).toLocaleString() : 'Unavailable'}</td><td className="px-3 py-3 font-mono text-[11px]">{record.ipAddress}</td><td className="px-3 py-3">{record.location}</td><td className="px-3 py-3">{record.browser}</td><td className="px-3 py-3">{record.operatingSystem}</td><td className="px-3 py-3">{record.deviceType}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button type="button" className="flex w-full items-center justify-between px-5 py-4 text-left sm:px-6" onClick={() => setIsRoleAccessOpen(!isRoleAccessOpen)} aria-expanded={isRoleAccessOpen}>
                    <span className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><ShieldCheck className="h-5 w-5" /></span><span><span className="block text-base font-semibold text-slate-900">Role permissions</span><span className="block text-xs font-normal text-slate-500">Reference guide for clinical record access</span></span></span>
                    <ChevronDown className={`h-5 w-5 text-slate-400 transition-transform ${isRoleAccessOpen ? 'rotate-180' : ''}`} />
                </button>
                {isRoleAccessOpen && (
                    <div className="overflow-x-auto border-t border-slate-100 p-4 sm:p-6">
                      <table className="w-full min-w-[760px] text-left text-sm">
                          <thead className="bg-slate-100 text-slate-600 text-xs font-semibold uppercase">
                              <tr>
                                  <th className="px-6 py-4">Role</th>
                                  <th className="px-6 py-4">Patient Record</th>
                                  <th className="px-6 py-4">Appointment</th>
                                  <th className="px-6 py-4">Visit History</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                              {Object.entries(RBAC)
                                  .filter(([role]) => userRole === 'support_developer' || role !== 'support_developer')
                                  .map(([role, modules]) => (
                                  <tr key={role} className="capitalize">
                                    <td className="px-6 py-4 font-semibold text-slate-900">{role === 'support_developer' ? 'Support / Developer' : role}</td>
                                    {Object.entries(modules).map(([moduleKey, permissions]) => (
                                      <td key={moduleKey} className="px-6 py-4">
                                          <div className="flex flex-wrap gap-1.5">
                                            {Object.entries(permissions as any).filter(([_, allowed]) => allowed).map(([action]) => (
                                              <span key={action} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold capitalize text-slate-600">{action}</span>
                                            ))}
                                            {Object.values(permissions as any).every(allowed => !allowed) && <span className="text-xs text-slate-400">No access</span>}
                                          </div>
                                      </td>
                                    ))}
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                      <p className="mt-3 text-xs text-slate-500">
                        Staff patient edits are limited to demographic/contact corrections. Manager patient edits are limited to demographic, branch, and status fields. Doctor visit writes are limited to their own assigned visits. Delete actions archive records with a required reason and can be restored by Admin or Support / Developer.
                      </p>
                    </div>
                )}
              </div>
              </>
              )}
            </>
    ) : (
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-slate-600">Access Denied: Administrative controls are restricted to system administrators.</p>
        </div>
    )}
    </div>
  );
}

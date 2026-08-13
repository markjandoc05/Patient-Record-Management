import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, updateDoc, setDoc, getDoc, addDoc, deleteDoc, writeBatch, getDocs, query } from 'firebase/firestore';
import { auth, storage } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { getChangedFields } from '../utils/diffUtils';
import { handleFirestoreError, OperationType } from '../utils';
import { RBAC } from '../rbac';
import { logActivity } from '../utils/auditLogger';
import ConfirmationModal from './ConfirmationModal';
 
export default function AdminSettings({ db, userRole, branding, timezone, footer, userProfile }: { db: any, userRole: string|null, branding: any, timezone: any, footer: any, userProfile: any }) {
  const [users, setUsers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [error, setError] = useState('');
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
    developerCreditText: 'Developed by AIPH Tech',
    developerCreditUrl: 'https://aiph.tech'
  });
  const [savingFooter, setSavingFooter] = useState(false);
  const [footerSuccess, setFooterSuccess] = useState('');
  const [newBranch, setNewBranch] = useState({ branchName: '', address: '', contactNumber: '', email: '' });
  const [isBranchOpen, setIsBranchOpen] = useState(true);
  const [isUserAccessOpen, setIsUserAccessOpen] = useState(false);
  const [isRoleAccessOpen, setIsRoleAccessOpen] = useState(false);
  const [isDataManagementOpen, setIsDataManagementOpen] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [editBranchData, setEditBranchData] = useState({ branchName: '', address: '', contactNumber: '', email: '' });
  const [actionToConfirm, setActionToConfirm] = useState<null | {
    onConfirm: () => Promise<void>;
    title: string;
    message: string;
  }>(null);

  // Dynamic white-label branding configurations
  const [isBrandingOpen, setIsBrandingOpen] = useState(false);
  const [brandingForm, setBrandingForm] = useState<any>({
    appName: '',
    appShortName: '',
    appLogoUrl: '',
    faviconUrl: '',
    loginPageLogoUrl: '',
    browserTitle: '',
    metaTitle: '',
    metaDescription: '',
    metaKeywords: '',
    ogTitle: '',
    ogDescription: '',
    ogImageUrl: '',
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
    developerCreditText: 'Developed by AIPH Tech',
    developerCreditUrl: 'https://aiph.tech'
  });

  const [savingBranding, setSavingBranding] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [brandingSuccess, setBrandingSuccess] = useState('');
  const [mediaSuccess, setMediaSuccess] = useState('');
  const [mediaSettings, setMediaSettings] = useState({
    allowedExtensions: ['.png', '.jpg', '.pdf'],
    maxFileSizeMB: 1,
    maxFilesPerAppointment: 5
  });

  useEffect(() => {
    if (branding) {
      setBrandingForm({
        appName: branding.appName || '',
        appShortName: branding.appShortName || '',
        appLogoUrl: branding.appLogoUrl || '',
        faviconUrl: branding.faviconUrl || '',
        loginPageLogoUrl: branding.loginPageLogoUrl || '',
        browserTitle: branding.browserTitle || '',
        metaTitle: branding.metaTitle || '',
        metaDescription: branding.metaDescription || '',
        metaKeywords: branding.metaKeywords || '',
        ogTitle: branding.ogTitle || '',
        ogDescription: branding.ogDescription || '',
        ogImageUrl: branding.ogImageUrl || '',
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
        developerCreditText: branding.developerCreditText || 'Developed by AIPH Tech',
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
    const isOwner = auth.currentUser?.email === 'markjandoc@gmail.com';
    console.log("AdminSettings: DB role verification:", dbRole, "IsOwner:", isOwner);

    if (dbRole !== 'admin' && dbRole !== 'support_developer' && !isOwner) {
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
        loginPageLogoUrl: 'login-logo',
        ogImageUrl: 'open-graph'
    };
    const folder = pathMap[fieldName] || 'misc';
    const storagePath = `branding/${folder}/${Date.now()}_${file.name}`;
    console.log("AdminSettings: Uploading branding asset to storage path:", storagePath);
    
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

        const storageRef = ref(storage, storagePath);
        console.log("AdminSettings: About to upload bytes to storageRef");
        await uploadBytes(storageRef, fileToUpload);
        console.log("AdminSettings: Upload bytes successful");
        const downloadUrl = await getDownloadURL(storageRef);
        console.log("AdminSettings: Upload success, URL obtained. Updating Firestore path: settings/branding");
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
        console.log("AdminSettings: About to update branding document in Firestore");
        await setDoc(doc(db, 'settings', 'branding'), {
            [fieldName]: downloadUrl,
            [`${fieldName}_metadata`]: assetMetadata,
            updatedAt: newTimestamp
        }, { merge: true });
        console.log("AdminSettings: Firestore update successful");
        
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

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("AdminSettings: Attempting to save all branding settings", brandingForm);
    
    // Verify role directly from DB
    const userDoc = await getDoc(doc(db, 'users', auth.currentUser!.uid));
    const dbRole = userDoc.exists() ? userDoc.data()?.role : null;
    const isOwner = auth.currentUser?.email === 'markjandoc@gmail.com';
    console.log("AdminSettings: DB role verification (save):", dbRole, "IsOwner:", isOwner);
    
    const isAdminOrSupport = dbRole === 'admin' || dbRole === 'support_developer' || isOwner;
    if (!isAdminOrSupport) {
        console.error("AdminSettings: Branding save failed: unauthorized access by role:", dbRole);
        setError("Permission Denied: Only Admin and Support / Developer can update branding.");
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
      
      console.log("AdminSettings: Writing branding to Firestore path settings/branding");
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
      handleFirestoreError(err, OperationType.UPDATE, 'settings/branding', auth);
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSaveTimezone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole === 'support_developer') {
      alert("Permission Denied: Support / Developer role is read-only for timezone configurations.");
      return;
    }
    setSavingTimezone(true);
    setTimezoneSuccess('');
    setError('');
    
    try {
      await setDoc(doc(db, 'settings', 'timezone'), timezoneForm, { merge: true });
      
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
      handleFirestoreError(err, OperationType.UPDATE, 'settings/timezone', auth);
    } finally {
      setSavingTimezone(false);
    }
  };
  
  const handleSaveFooter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== 'support_developer') {
      alert("Permission Denied: Only Support / Developer role can modify Footer Settings.");
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
      handleFirestoreError(err, OperationType.UPDATE, 'settings/footer', auth);
    } finally {
      setSavingFooter(false);
    }
  };
  
  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users', auth));
    
    const unsubBranches = onSnapshot(collection(db, 'branches'), (snapshot) => {
      setBranches(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'branches', auth));
    
    // Fetch media settings
    const unsubMedia = onSnapshot(doc(db, 'settings', 'media'), (doc) => {
      if (doc.exists()) {
          const data = doc.data();
          setMediaSettings({
            allowedExtensions: ['.png', '.jpg', '.pdf'],
            maxFileSizeMB: 1,
            maxFilesPerAppointment: 5,
            ...data
          } as any);
      }
    });
    
    return () => { unsubUsers(); unsubBranches(); unsubMedia(); };
  }, [db]);

  const handleSaveMediaSettings = async (e: React.FormEvent) => {
      e.preventDefault();
      setSavingMedia(true);
      setMediaSuccess('');
      setError('');
      try {
          await setDoc(doc(db, 'settings', 'media'), mediaSettings, { merge: true });
          setMediaSuccess('Media upload settings saved successfully!');
          setTimeout(() => setMediaSuccess(''), 4000);
      } catch (err: any) {
          setError('Failed to save media settings: ' + (err.message || String(err)));
          handleFirestoreError(err, OperationType.UPDATE, 'settings/media', auth);
      } finally {
          setSavingMedia(false);
      }
  };

  const updateRole = async (userId: string, newRole: string) => {
    try {
        await updateDoc(doc(db, 'users', userId), { role: newRole });
        await logActivity({
            action: 'UPDATE',
            resource: 'User',
            resourceId: userId,
            details: `Updated user role to: ${newRole}`,
            userProfile: { role: userRole }
        });
    } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`, auth);
    }
  };

  const handleAddBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole === 'support_developer') {
      alert("Permission Denied: Support / Developer role cannot add branches.");
      return;
    }
    try {
        const docRef = await addDoc(collection(db, 'branches'), {
            ...newBranch,
            status: 'Active',
            createdAt: new Date().toISOString()
        });
        await logActivity({
            action: 'CREATE',
            resource: 'Branch',
            resourceId: docRef.id,
            resourceName: newBranch.branchName,
            details: 'Created new branch',
            userProfile: { role: userRole }
        });
        setNewBranch({ branchName: '', address: '', contactNumber: '', email: '' });
    } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'branches', auth);
    }
  };

  const toggleBranchStatus = async (branchId: string, currentStatus: string) => {
      if (userRole === 'support_developer') {
          alert("Permission Denied: Support / Developer role cannot toggle branch status.");
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
      } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `branches/${branchId}`, auth);
      }
  };

  const executeDeleteBranch = async (id: string, name: string) => {
    if (userRole === 'support_developer') {
        alert("Permission Denied: Support / Developer role cannot delete branches.");
        return;
    }
    try {
        await deleteDoc(doc(db, 'branches', id));
        await logActivity({
            action: 'DELETE',
            resource: 'Branch',
            resourceId: id,
            resourceName: name,
            details: 'Deleted branch',
            userProfile: { role: userRole }
        });
    } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `branches/${id}`, auth);
    }
  };
   
  const confirmDeleteBranch = (id: string, name: string) => {
      setActionToConfirm({
          onConfirm: () => executeDeleteBranch(id, name),
          title: "Delete Branch",
          message: `Are you sure you want to delete branch "${name}"? This action cannot be undone.`
      });
  };

  const handleUpdateBranch = async () => {
    if (userRole === 'support_developer') {
        alert("Permission Denied: Support / Developer role cannot update branch details.");
        return;
    }
    if (!editingBranchId) return;
    try {
        await updateDoc(doc(db, 'branches', editingBranchId), editBranchData);
        await logActivity({
            action: 'UPDATE',
            resource: 'Branch',
            resourceId: editingBranchId,
            resourceName: editBranchData.branchName,
            details: 'Updated branch details',
            userProfile: { role: userRole }
        });
        setEditingBranchId(null);
    } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `branches/${editingBranchId}`, auth);
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
    if (userRole === 'support_developer') {
        alert("Permission Denied: Support / Developer role cannot modify branch assignments.");
        return;
    }
    try {
        const batch = writeBatch(db);
        let updatedCount = 0;
        const validBranchIds = branches.map(b => b.id);

        for (const user of users) {
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
            alert(`Cleaned up branch assignments for ${updatedCount} users.`);
        } else {
            alert('No invalid branch assignments found.');
        }

    } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'users', auth);
    }
  };

  const handlePurgeCollection = async (collectionName: string) => {
    try {
        const querySnapshot = await getDocs(collection(db, collectionName));
        const docs = querySnapshot.docs;
        
        // Firestore writeBatch has a limit of 500 operations.
        // Chunk docs into batches of 500.
        for (let i = 0; i < docs.length; i += 500) {
            const batch = writeBatch(db);
            const chunk = docs.slice(i, i + 500);
            chunk.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }

        alert(`Successfully purged ${collectionName}.`);
        await logActivity({
            action: 'DELETE',
            resource: 'Settings',
            resourceId: 'purge',
            details: `Purged collection: ${collectionName}`,
            userProfile: { role: userRole }
        });
    } catch (e: any) {
        setError(`Failed to purge ${collectionName}: ${e.message}`);
    }
  }

  const confirmPurge = (collectionName: string) => {
      setActionToConfirm({
          onConfirm: () => handlePurgeCollection(collectionName),
          title: `Purge ${collectionName}?`,
          message: `Are you sure you want to permanently delete all records in ${collectionName}? This action cannot be undone.`
      });
  }

  return (
    <div className="space-y-8 p-6 bg-slate-50 min-h-screen">
        <ConfirmationModal 
          isOpen={!!actionToConfirm}
          title={actionToConfirm?.title || ""}
          message={actionToConfirm?.message || ""}
          onConfirm={async () => {
            if (actionToConfirm) await actionToConfirm.onConfirm();
            setActionToConfirm(null);
          }}
          onCancel={() => setActionToConfirm(null)}
          confirmLabel="Confirm Action"
        />
    {userRole === 'admin' || userRole === 'support_developer' ? (
      <>
        {userRole === 'support_developer' && (
          <div className="bg-amber-50 text-amber-800 border border-amber-200 p-4 rounded-xl text-xs font-semibold space-y-1 mb-2">
            <p className="font-bold">🔒 TECHNICAL READ-ONLY ACCESS ACTIVE</p>
            <p className="text-slate-600">You are logged in under the Support / Developer role. You can review all clinical, branding, and branch settings for system lookup, but modifications are restricted to pure Administrator roles.</p>
          </div>
        )}
        {/* Branding & General Settings Accordion */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsBrandingOpen(!isBrandingOpen)}>
                <h2 className="text-xl font-bold text-slate-800">Branding & General Settings</h2>
                <button className="text-slate-500 font-bold text-lg">{isBrandingOpen ? '−' : '+'}</button>
            </div>
            
            {isBrandingOpen && (
                <form onSubmit={handleSaveBranding} className="mt-6 space-y-8 animate-fade-in divide-y divide-slate-100">
                    
                    {/* SECTION 1: Application Branding */}
                    <div className="pt-2">
                        <h3 className="text-md font-bold mb-4 text-slate-800 border-b pb-1">Application Branding</h3>
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
                            </div>
                        </div>
                    </div>

                    {/* SECTION 2: SEO & Metadata */}
                    <div className="pt-6">
                        <h3 className="text-md font-bold mb-4 text-slate-800 border-b pb-1">SEO & Metadata</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Meta Title</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.metaTitle} 
                                    onChange={e => setBrandingForm({...brandingForm, metaTitle: e.target.value})} 
                                    placeholder="Enter search performance title"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Meta Keywords</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={brandingForm.metaKeywords} 
                                    onChange={e => setBrandingForm({...brandingForm, metaKeywords: e.target.value})} 
                                    placeholder="skin, clinic, health, patient database"
                                />
                            </div>
                            <div className="flex flex-col gap-1 md:col-span-2">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Meta Description</label>
                                <textarea 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm h-16 resize-none" 
                                    value={brandingForm.metaDescription} 
                                    onChange={e => setBrandingForm({...brandingForm, metaDescription: e.target.value})} 
                                    placeholder="Brief indexable description"
                                />
                            </div>
                        </div>

                        {/* Open Graph Social Sharing */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 p-4 bg-slate-50 rounded-xl border border-slate-150">
                            <div className="space-y-4">
                                <h4 className="text-xs font-bold text-slate-700">Open Graph Social Sharing</h4>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-semibold text-slate-500 uppercase">OG Title</label>
                                    <input 
                                        type="text" 
                                        className="border border-slate-200 bg-white p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                        value={brandingForm.ogTitle} 
                                        onChange={e => setBrandingForm({...brandingForm, ogTitle: e.target.value})} 
                                        placeholder="Social title when link is shared"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-semibold text-slate-500 uppercase">OG Description</label>
                                    <textarea 
                                        className="border border-slate-200 bg-white p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm h-12 resize-none" 
                                        value={brandingForm.ogDescription} 
                                        onChange={e => setBrandingForm({...brandingForm, ogDescription: e.target.value})} 
                                        placeholder="Social description shared on platforms"
                                    />
                                </div>
                            </div>
                            {/* OG Banner Image */}
                            <div className="flex flex-col justify-center border-l md:pl-6 border-slate-200 gap-2">
                                <span className="text-[10px] font-bold text-slate-600 uppercase">Open Graph Banner Image</span>
                                {brandingForm.ogImageUrl && (
                                    <div className="h-20 w-full flex items-center justify-center bg-slate-100 rounded-lg overflow-hidden border">
                                        <img src={brandingForm.ogImageUrl} alt="OG Banner" className="h-16 max-w-full object-contain" />
                                    </div>
                                )}
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-slate-200 file:text-slate-800 hover:file:bg-slate-300" 
                                    onChange={e => handleLogoUpload(e, 'ogImageUrl')}
                                />
                                {uploadingField === 'ogImageUrl' && <span className="text-[10px] text-teal-600 font-medium">Uploading...</span>}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: Company Information */}
                    <div className="pt-6">
                        <h3 className="text-md font-bold mb-4 text-slate-800 border-b pb-1">Company / Clinic Information</h3>
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

                    {/* SECTION 4: Theme & Appearance */}
                    <div className="pt-6">
                        <h3 className="text-md font-bold mb-4 text-slate-800 border-b pb-1">Theme & Appearance</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                            {/* Primary Color */}
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

                            {/* Secondary Color */}
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

                            {/* Accent Color */}
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

                            {/* Dark Mode Optional Toggle */}
                            <div className="flex items-center gap-2 pt-4 pl-4">
                                <input 
                                    type="checkbox" 
                                    id="darkModeToggle"
                                    className="w-4 h-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500"
                                    checked={brandingForm.darkMode} 
                                    onChange={e => setBrandingForm({...brandingForm, darkMode: e.target.checked})} 
                                />
                                <label htmlFor="darkModeToggle" className="text-xs font-semibold text-slate-700">Enable Dark Mode Accent</label>
                            </div>
                        </div>
                    </div>

                     {/* SECTION 5: Media Upload Settings */}
                     <div className="pt-6">
                        <h3 className="text-md font-bold mb-4 text-slate-800 border-b pb-1">Media Upload Settings</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Allowed Extensions (comma separated)</label>
                                <input 
                                    type="text" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={mediaSettings.allowedExtensions.join(',')} 
                                    onChange={e => setMediaSettings({...mediaSettings, allowedExtensions: e.target.value.split(',')})} 
                                    placeholder=".png,.jpg,.pdf"
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Max File Size (MB)</label>
                                <input 
                                    type="number" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={mediaSettings.maxFileSizeMB} 
                                    onChange={e => setMediaSettings({...mediaSettings, maxFileSizeMB: parseInt(e.target.value)})} 
                                />
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-semibold text-slate-500 uppercase">Max Files per Appointment</label>
                                <input 
                                    type="number" 
                                    className="border border-slate-200 p-2 rounded-lg focus:ring-1 focus:ring-teal-500 text-sm" 
                                    value={mediaSettings.maxFilesPerAppointment} 
                                    onChange={e => setMediaSettings({...mediaSettings, maxFilesPerAppointment: parseInt(e.target.value)})} 
                                />
                            </div>
                            <div className="md:col-span-3">
                                <button 
                                    onClick={handleSaveMediaSettings}
                                    disabled={savingMedia}
                                    className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 transition"
                                >
                                {savingMedia ? 'Saving...' : 'Save Media Upload Settings'}
                                </button>
                                {mediaSuccess && <span className="ml-3 text-xs text-green-600 font-semibold">{mediaSuccess}</span>}
                            </div>
                        </div>
                     </div>

                    {/* SECTION 5: Timezone Settings */}
                    <div className="pt-6">
                        <h3 className="text-md font-bold mb-4 text-slate-800 border-b pb-1">Timezone Settings</h3>
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
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                                style={{ backgroundColor: brandingForm.primaryColor || '#0d9488' }}
                            >
                                {savingTimezone ? 'Saving...' : 'Save Timezone Settings'}
                            </button>
                        </div>
                        {timezoneSuccess && <p className="text-teal-600 text-xs mt-2">{timezoneSuccess}</p>}
                    </div>

                    {/* SECTION 6: Footer */}
                    {userRole === 'support_developer' && (
                    <div className="pt-6">
                        <h3 className="text-md font-bold mb-4 text-slate-800 border-b pb-1">Footer Settings</h3>
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
                                    placeholder="Developed by AIPH Tech"
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
                        <div className="flex justify-end pt-4">
                            <button 
                                type="button" 
                                onClick={handleSaveFooter}
                                disabled={savingFooter}
                                className="font-bold text-sm px-6 py-2.5 bg-teal-600 text-white rounded-lg shadow-md transition disabled:opacity-50 hover:bg-teal-700"
                            >
                                {savingFooter ? 'Saving...' : 'Save Footer Settings'}
                            </button>
                        </div>
                        {footerSuccess && <p className="text-teal-600 text-xs mt-2">{footerSuccess}</p>}
                    </div>
                </div>
            )}
            
            {/* Feedback and dynamic color matching submit button */}
            <div className="pt-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
                        <div>
                            {brandingSuccess && <p className="text-green-600 text-xs font-semibold animate-bounce">{brandingSuccess}</p>}
                            {error && <p className="text-red-500 text-xs font-semibold">{error}</p>}
                        </div>
                        <button 
                            type="submit" 
                            disabled={savingBranding || uploadingField !== null}
                            className="font-bold text-sm px-6 py-2.5 text-white rounded-lg shadow-md transition disabled:opacity-50"
                            style={{ backgroundColor: brandingForm.primaryColor || '#0d9488' }}
                            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = brandingForm.secondaryColor || '#0f766e')}
                            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = brandingForm.primaryColor || '#0d9488')}
                        >
                            {savingBranding ? 'Saving Settings...' : 'Save Branding Configurations'}
                        </button>
                    </div>
                </form>
            )}
        </div>

        {/* Development / Data Management Settings Accordion */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-8">
            <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsDataManagementOpen(!isDataManagementOpen)}>
                <h2 className="text-xl font-bold text-slate-800">Data Management (Dev)</h2>
                <button className="text-slate-500 font-bold text-lg">{isDataManagementOpen ? '−' : '+'}</button>
            </div>
            
            {isDataManagementOpen && (
                <div className="mt-6 space-y-4 animate-fade-in">
                    <p className="text-xs text-red-600 font-bold">WARNING: Destructive Actions. Cannot be undone.</p>
                    <div className="flex gap-4">
                        <button onClick={() => confirmPurge('appointments')} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold">Purge All Appointments</button>
                        <button onClick={() => confirmPurge('visits')} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold">Purge All Visits</button>
                        <button onClick={() => confirmPurge('patients')} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold">Purge All Patients</button>
                        <button onClick={() => confirmPurge('audit_logs')} className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold">Purge All Audit Logs</button>
                    </div>
                </div>
            )}
        </div>

        {/* Existing Branch accordion */}
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-8">
            <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsBranchOpen(!isBranchOpen)}>
                <h2 className="text-xl font-bold text-slate-800">Branch Management Setting</h2>
                <button className="text-slate-500 font-bold">{isBranchOpen ? '-' : '+'}</button>
            </div>
            {isBranchOpen && (
                <div className="mt-6 space-y-8">
                    <div className="p-4 bg-slate-50 rounded-xl">
                        <h3 className="text-sm font-bold mb-3 text-slate-700">Add New Branch</h3>
                        <form onSubmit={handleAddBranch} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
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
                        <h3 className="text-sm font-bold mb-3 text-slate-700">Existing Branches</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-100 text-slate-600 font-semibold uppercase">
                                    <tr>
                                        <th className="px-3 py-2">Branch</th>
                                        <th className="px-3 py-2">Address</th>
                                        <th className="px-3 py-2">Contact</th>
                                        <th className="px-3 py-2">Email</th>
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-3 py-2">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                    {branches.map(branch => (
                                        <tr key={branch.id} className="hover:bg-slate-50 transition">
                                            {editingBranchId === branch.id ? (
                                                <>
                                                    <td className="px-3 py-2"><input className="border p-1 w-full text-xs" value={editBranchData.branchName} onChange={e => setEditBranchData({...editBranchData, branchName: e.target.value})} /></td>
                                                    <td className="px-3 py-2"><input className="border p-1 w-full text-xs" value={editBranchData.address} onChange={e => setEditBranchData({...editBranchData, address: e.target.value})} /></td>
                                                    <td className="px-3 py-2"><input className="border p-1 w-full text-xs" value={editBranchData.contactNumber} onChange={e => setEditBranchData({...editBranchData, contactNumber: e.target.value})} /></td>
                                                    <td className="px-3 py-2"><input className="border p-1 w-full text-xs" value={editBranchData.email} onChange={e => setEditBranchData({...editBranchData, email: e.target.value})} /></td>
                                                    <td className="px-3 py-2">{branch.status}</td>
                                                    <td className="px-3 py-2">
                                                        <button onClick={confirmUpdateBranch} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-green-600 text-white hover:bg-green-700 transition">Save</button>
                                                        <button onClick={() => setEditingBranchId(null)} className="ml-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-800 hover:bg-slate-200 transition">Cancel</button>
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="px-3 py-2">{branch.branchName}</td>
                                                    <td className="px-3 py-2">{branch.address}</td>
                                                    <td className="px-3 py-2">{branch.contactNumber}</td>
                                                    <td className="px-3 py-2">{branch.email}</td>
                                                    <td className="px-3 py-2">{branch.status}</td>
                                                    <td className="px-3 py-2">
                                                        <button onClick={() => startEditBranch(branch)} className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-800 hover:bg-slate-200 transition">Edit</button>
                                                        <button 
                                                            onClick={() => toggleBranchStatus(branch.id, branch.status)}
                                                            className={`ml-1 px-2 py-1 rounded-lg text-[10px] font-bold transition ${branch.status === 'Active' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}
                                                        >
                                                            {branch.status === 'Active' ? 'Deactivate' : 'Activate'}
                                                        </button>
                                                        <button 
                                                            onClick={() => confirmDeleteBranch(branch.id, branch.branchName)}
                                                            className="ml-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-800 hover:bg-slate-200 transition"
                                                        >
                                                            Delete
                                                        </button>
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsUserAccessOpen(!isUserAccessOpen)}>
              <h2 className="text-xl font-bold text-slate-800">User Access Management</h2>
              <button className="text-slate-500 font-bold">{isUserAccessOpen ? '-' : '+'}</button>
          </div>
          {isUserAccessOpen && (
              <div className="mt-4 pt-4 border-t">
                  <div className="flex justify-end mb-4">
                      <button 
                        onClick={() => setActionToConfirm({
                            onConfirm: cleanupBranchAssignments,
                            title: "Clean Invalid Assignments",
                            message: "Are you sure you want to clean up invalid branch assignments for all users?"
                        })}
                        className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-semibold text-xs hover:bg-amber-700 transition"
                      >
                        Clean Invalid Assignments
                      </button>
                  </div>
                  

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-600 font-semibold uppercase">
                            <tr>
                                <th className="px-3 py-2">User</th>
                                <th className="px-3 py-2">Role</th>
                                <th className="px-3 py-2">Branches</th>
                                <th className="px-3 py-2">Actions</th>
                                <th className="px-3 py-2 rounded-tr-xl">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                        {users.filter(user => userRole === 'support_developer' || user.role !== 'support_developer').map(user => (
                            <tr key={user.id} className="hover:bg-slate-50 transition">
                            <td className="px-3 py-2 text-xs">
                                <div className="font-semibold text-slate-900">{user.fullName || user.name || 'Not Set'}</div>
                                <div className="text-xs text-slate-500">{user.email}</div>
                            </td>
                            <td className="px-3 py-2 text-xs">
                                <select 
                                    onChange={(e) => updateRole(user.id, e.target.value)} 
                                    defaultValue={user.role} 
                                    className="border border-slate-200 p-2 rounded-lg text-sm bg-white"
                                    disabled={(userRole !== 'support_developer' && user.role === 'support_developer') || (userRole !== 'support_developer' && user.id === auth.currentUser?.uid)}
                                >
                                    <option value="admin">Admin</option>
                                    <option value="manager">Manager</option>
                                    <option value="staff">Staff</option>
                                    <option value="doctor">Doctor</option>
                                    {userRole === 'support_developer' && <option value="support_developer">Support / Developer</option>}
                                </select>
                            </td>
                            <td className="px-6 py-2">
                               <div className="flex flex-col gap-1">
                                  {user.assignedBranches?.map((branchId: string) => {
                                      const b = branches.find(br => br.id === branchId);
                                      return (
                                        <div key={branchId} className="flex items-center gap-2">
                                            <span className="bg-slate-200 px-2 py-1 rounded text-xs">{b?.branchName || 'Unknown'}</span>
                                            {user.defaultBranchId === branchId && (
                                                <span className="bg-teal-100 text-teal-700 px-1 rounded text-[10px] font-bold">Default</span>
                                            )}
                                        </div>
                                      );
                                  })}
                               </div>
                               <div className="mt-2 text-xs text-slate-500 font-semibold">Assign/Unassign:</div>
                               <div className="grid grid-cols-1 gap-1 mt-1 border p-2 rounded max-h-32 overflow-y-auto bg-white">
                                   {branches.filter(b => b.status === 'Active').map(branch => {
                                       const isChecked = user.assignedBranches?.includes(branch.id);
                                       return (
                                           <label key={branch.id} className="flex items-center gap-2 text-xs">
                                               <input
                                                   type="checkbox"
                                                   checked={!!isChecked}
                                                   onChange={async (e) => {
                                                       const isAssigning = e.target.checked;
                                                       let currentBranches = [...(user.assignedBranches || [])];
                                                       let currentNames = [...(user.assignedBranchNames || [])];
                                                       
                                                       if (isAssigning) {
                                                           if (!currentBranches.includes(branch.id)) {
                                                               currentBranches.push(branch.id);
                                                               currentNames.push(branch.branchName);
                                                           }
                                                       } else {
                                                           const index = currentBranches.indexOf(branch.id);
                                                           if (index > -1) {
                                                               currentBranches.splice(index, 1);
                                                               currentNames.splice(index, 1);
                                                           }
                                                       }
                                                       
                                                       let defaultBranchId = user.defaultBranchId;
                                                       let defaultBranchName = user.defaultBranchName;
                                                       
                                                       if (currentBranches.length === 0) {
                                                           defaultBranchId = null;
                                                           defaultBranchName = null;
                                                       } else if (currentBranches.length === 1 || !currentBranches.includes(defaultBranchId)) {
                                                           defaultBranchId = currentBranches[0];
                                                           defaultBranchName = currentNames[0];
                                                       }

                                                       await updateDoc(doc(db, 'users', user.id), { 
                                                           assignedBranches: currentBranches,
                                                           assignedBranchNames: currentNames,
                                                           defaultBranchId: defaultBranchId || null,
                                                           defaultBranchName: defaultBranchName || null
                                                       });
                                                   }}
                                               />
                                               {branch.branchName}
                                               {isChecked && user.assignedBranches.length > 1 && (
                                                    <button 
                                                        className={`ml-auto ${user.defaultBranchId === branch.id ? 'text-teal-600 font-bold' : 'text-slate-400'}`}
                                                        onClick={async () => {
                                                            await updateDoc(doc(db, 'users', user.id), { 
                                                                defaultBranchId: branch.id,
                                                                defaultBranchName: branch.branchName
                                                            });
                                                        }}
                                                    >
                                                        {user.defaultBranchId === branch.id ? 'Default' : 'Set Default'}
                                                    </button>
                                               )}
                                           </label>
                                       );
                                   })}
                                   {branches.filter(b => b.status === 'Active').length === 0 && (
                                       <div className="text-red-500 text-xs">No active branches available. Please add or activate a branch first.</div>
                                   )}
                                </div>
                            </td>
                            <td className="px-3 py-2">
                                <button 
                                    onClick={async () => {
                                        try {
                                            await updateDoc(doc(db, 'users', user.id), { active: !user.active });
                                        } catch (error) {
                                            handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`, auth);
                                        }
                                    }}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold transition ${user.active ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}
                                >
                                    {user.active ? 'Disable' : 'Approve'}
                                </button>
                            </td>
                            <td className="px-3 py-2">
                                 <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${user.active ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                                    {user.active ? 'Active' : 'Pending'}
                                 </span>
                            </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                  </div>
              </div>
          )}
        </div>

              <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm mt-4">
                <div className="flex justify-between items-center cursor-pointer" onClick={() => setIsRoleAccessOpen(!isRoleAccessOpen)}>
                    <h2 className="text-xl font-bold text-slate-800">Role Access Description</h2>
                    <button className="text-slate-500 font-bold">{isRoleAccessOpen ? '-' : '+'}</button>
                </div>
                {isRoleAccessOpen && (
                    <div className="mt-4 pt-4 border-t overflow-x-auto">
                      <table className="w-full text-left text-sm">
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
                                          {Object.entries(permissions as any)
                                           .filter(([_, allowed]) => allowed)
                                           .map(([action]) => action)
                                           .join(', ') || 'No access'}
                                      </td>
                                    ))}
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                    </div>
                )}
              </div>
            </>
    ) : (
        <div className="bg-white p-8 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-slate-600">Access Denied: Administrative controls are restricted to system administrators.</p>
        </div>
    )}
    </div>
  );
}


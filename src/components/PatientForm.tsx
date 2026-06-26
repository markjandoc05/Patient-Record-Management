import React, { useState, useEffect } from 'react';
import { addDoc, collection, updateDoc, doc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { formatDateTime } from '../utils';
import { hasPermission, Role } from '../rbac';
import { CustomDatePicker } from './CustomDatePicker';
import { getChangedFields } from '../utils/diffUtils';
import { logActivity } from '../utils/auditLogger';

const ErrorMessage = ({ error }: { error?: boolean }) => {
  if (!error) return null;
  return <p className="text-red-500 text-xs font-medium">Please fill out this field.</p>;
}

export default function PatientForm({ db, user, users, patients, branches, userProfile, patient, onClose, onSave }: { db: any, user: any, users: any[], patients: any[], branches: any[], userProfile: any, patient?: any, onClose: () => void, onSave: () => void }) {
  const [formData, setFormData] = useState({
    patientID: '',
    name: '', contactNumber: '', email: '', birthday: '', age: '', gender: 'Male', address: '', emergencyContact: '',
    dateRegistered: '',
    mainConcern: '', skinType: 'Normal', allergies: '', medications: '', medicalConditions: '',
    notes: '', status: 'Active',
    homeBranchId: '', homeBranchName: '',
    ...(patient || {})
  });

  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  useEffect(() => {
    if (formData.birthday) {
        setFormData((prev: any) => ({ ...prev, age: calculateAge(formData.birthday) }));
    }
  }, [formData.birthday]);

  // Auto-select branch
  useEffect(() => {
      if (!patient && userProfile.assignedBranches?.length === 1) {
          const branch = branches.find(b => b.id === userProfile.assignedBranches[0]);
          if (branch) {
              setFormData(prev => ({ ...prev, homeBranchId: branch.id, homeBranchName: branch.branchName }));
          }
      }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    
    const newErrors: Record<string, boolean> = {};
    if (!formData.homeBranchId) newErrors.homeBranchId = true;
    if (!formData.name.trim()) newErrors.name = true;
    if (!formData.contactNumber.trim()) newErrors.contactNumber = true;
    if (!formData.email.trim()) newErrors.email = true;
    if (!formData.birthday) newErrors.birthday = true;
    if (!formData.age) newErrors.age = true;
    if (!formData.gender) newErrors.gender = true;
    if (!formData.address.trim()) newErrors.address = true;
    if (!formData.mainConcern.trim()) newErrors.mainConcern = true;

    if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
    }
    setErrors({});

    if (!patient) {
        const isDuplicate = patients.some(p =>
            p.name.trim().toLowerCase() === formData.name.trim().toLowerCase() &&
            p.contactNumber.trim() === formData.contactNumber.trim() &&
            p.email.trim().toLowerCase() === formData.email.trim().toLowerCase() &&
            p.birthday === formData.birthday
        );
        if (isDuplicate) {
            alert("A patient with these details already exists.");
            return;
        }
    }
    
    setIsSaving(true);
    const role: Role = userProfile.role;
    
    if (patient) {
        if (!hasPermission(role, 'patientRecord', 'update')) {
            alert("You are not authorized to update records.");
            setIsSaving(false);
            return;
        }
    } else {
        if (!hasPermission(role, 'patientRecord', 'create')) {
            alert("You are not authorized to create records.");
            setIsSaving(false);
            return;
        }
    }

    let dataToSave = { ...formData };
    const now = new Date().toISOString(); 
    const currentUser = users.find(u => u.id === user.uid);
    const userName = currentUser ? (currentUser.fullName || "System User") : "System User";
    
    // Set branch info
    const branch = branches.find(b => b.id === dataToSave.homeBranchId);
    if (branch) {
        dataToSave.homeBranchName = branch.branchName;
    }

    // Ensure all audit fields are initialized correctly
    if (!patient) {
        // Generate new ID: ID-YY-####
        const querySnapshot = await getDocs(query(collection(db, 'patients'), orderBy('patientID', 'desc'), limit(1)));
        let lastId = 0;
        const currentYear = new Date().getFullYear() % 100;
        
        if (!querySnapshot.empty) {
            const lastPatient = querySnapshot.docs[0].data();
            const lastPatientID = lastPatient.patientID; // Expected ID-YY-####
            const parts = lastPatientID.split('-');
            if (parts.length === 3 && parseInt(parts[1]) === currentYear) {
                lastId = parseInt(parts[2]);
            }
        }
        
        const newId = `ID-${currentYear.toString().padStart(2, '0')}-${(lastId + 1).toString().padStart(4, '0')}`;
        dataToSave.patientID = newId;
        dataToSave.dateRegistered = now;
        
        // Audit branch creation
        dataToSave.createdBranchId = dataToSave.homeBranchId;
        dataToSave.createdBranchName = dataToSave.homeBranchName;
        dataToSave.createdByUid = user.uid;
        dataToSave.createdByName = userName;
        dataToSave.createdAt = now;
        dataToSave.createdByUserDefaultBranchId = userProfile.defaultBranchId || null;
        dataToSave.createdByUserDefaultBranchName = userProfile.defaultBranchName || null;
    } 
    
    // Audit branch update
    dataToSave.lastUpdatedBranchId = dataToSave.homeBranchId;
    dataToSave.lastUpdatedBranchName = dataToSave.homeBranchName;
    dataToSave.lastUpdatedByUid = user.uid;
    dataToSave.lastUpdatedByName = userName;
    dataToSave.lastUpdatedAt = now;
    
    try {
        if (patient) {
          await updateDoc(doc(db, 'patients', patient.id), dataToSave);
          const changedFields = getChangedFields(patient, dataToSave);
          await logActivity({
            action: 'UPDATE',
            resource: 'Patient',
            resourceId: patient.id,
            resourceName: patient.patientID || dataToSave.patientID || '',
            details: `Updated Patient details. Fields modified: ${changedFields.join(', ')}`,
            userProfile
          });
        } else {
          const docRef = await addDoc(collection(db, 'patients'), dataToSave);
          await logActivity({
            action: 'CREATE',
            resource: 'Patient',
            resourceId: docRef.id,
            resourceName: dataToSave.patientID || '',
            details: 'Registered a new patient record',
            userProfile
          });
        }
        onSave();
        onClose();
    } catch (err: any) {
        console.error("Error saving patient:", err);
        alert("Failed to save patient: " + err.message);
    } finally {
        setIsSaving(false);
    }
  };

  const allowedBranches = branches.filter(b => b.status === 'Active');
  
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex justify-center items-center p-4 z-[100] animate-fade-in">
      <form onSubmit={handleSubmit} className="bg-white p-6 sm:p-8 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto space-y-6 relative z-[101] shadow-2xl border border-slate-100">
        <div className="flex justify-between items-center border-b pb-4">
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
            {patient ? 'Edit Patient' : 'New Patient Registration'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-6">
                <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Patient Information</h3>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5 col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Home Branch <span className="text-red-500">*</span></label>
                            <select 
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                                value={formData.homeBranchId} 
                                onChange={e => {
                                    const b = branches.find(br => br.id === e.target.value);
                                    setFormData({...formData, homeBranchId: e.target.value, homeBranchName: b?.branchName || ''})
                                }} 
                                disabled={false}
                                required
                            >
                                <option value="">Select Branch</option>
                                {allowedBranches.map(b => <option key={b.id} value={b.id}>{b.branchName}</option>)}
                            </select>
                            <ErrorMessage error={errors.homeBranchId} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient ID</label>
                            <input 
                                type="text" 
                                className="w-full h-[42px] border border-slate-200 bg-slate-50 text-slate-500 px-3 rounded-xl text-sm font-medium cursor-not-allowed outline-none" 
                                value={formData.patientID || 'Auto-generated'} 
                                disabled 
                            />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Full Name <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                value={formData.name} 
                                onChange={e => setFormData({ ...formData, name: e.target.value })} 
                                required 
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                            />
                            <ErrorMessage error={errors.name} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Mobile Number <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                value={formData.contactNumber} 
                                onChange={e => setFormData({ ...formData, contactNumber: e.target.value })} 
                                required
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                            />
                            <ErrorMessage error={errors.contactNumber} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Email Address <span className="text-red-500">*</span></label>
                            <input 
                                type="email" 
                                value={formData.email} 
                                onChange={e => setFormData({ ...formData, email: e.target.value })} 
                                required
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                            />
                            <ErrorMessage error={errors.email} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Date of Birth <span className="text-red-500">*</span></label>
                            <CustomDatePicker 
                                value={formData.birthday} 
                                onChange={val => setFormData({ ...formData, birthday: val })} 
                                required
                            />
                            <ErrorMessage error={errors.birthday} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Age <span className="text-red-500">*</span></label>
                            <input 
                                type="number" 
                                value={formData.age} 
                                disabled 
                                className="w-full h-[42px] border border-slate-200 bg-slate-50 text-slate-500 px-3 rounded-xl text-sm font-medium cursor-not-allowed outline-none" 
                            />
                            <ErrorMessage error={errors.age} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2 sm:col-span-1">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Gender <span className="text-red-500">*</span></label>
                            <select 
                                value={formData.gender} 
                                onChange={e => setFormData({ ...formData, gender: e.target.value })}
                                required
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                            >
                                <option value="">Select Gender</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                            </select>
                            <ErrorMessage error={errors.gender} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Address <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                value={formData.address} 
                                onChange={e => setFormData({ ...formData, address: e.target.value })} 
                                required
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                            />
                            <ErrorMessage error={errors.address} />
                        </div>
                        
                        <div className="space-y-1.5 col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Emergency Contact</label>
                            <input 
                                type="text" 
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                value={formData.emergencyContact} 
                                onChange={e => setFormData({ ...formData, emergencyContact: e.target.value })} 
                            />
                        </div>
                    </div>
                </section>
            </div>
    
            <div className="space-y-6">
                <section className="space-y-4">
                    <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800 border-b border-teal-100 pb-1">Medical & Clinical info</h3>
                    
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Main Concern <span className="text-red-500">*</span></label>
                            <textarea 
                                rows={2} 
                                value={formData.mainConcern} 
                                onChange={e => setFormData({ ...formData, mainConcern: e.target.value })} 
                                required
                                className="w-full border border-slate-300 p-2.5 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all"
                            />
                            <ErrorMessage error={errors.mainConcern} />
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Skin Type</label>
                            <select 
                                className="w-full h-[42px] border border-slate-300 px-3 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                value={formData.skinType} 
                                onChange={e => setFormData({ ...formData, skinType: e.target.value })}
                            >
                                {['Oily', 'Dry', 'Combination', 'Sensitive', 'Normal'].map(type => <option key={type} value={type}>{type}</option>)}
                            </select>
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Allergies</label>
                            <input 
                                type="text" 
                                className="w-full border border-slate-300 p-2.5 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                value={formData.allergies} 
                                onChange={e => setFormData({ ...formData, allergies: e.target.value })} 
                            />
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Medications</label>
                            <textarea 
                                className="w-full border border-slate-300 p-2.5 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                rows={2} 
                                value={formData.medications} 
                                onChange={e => setFormData({ ...formData, medications: e.target.value })} 
                            />
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Medical Conditions</label>
                            <textarea 
                                className="w-full border border-slate-300 p-2.5 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                rows={2} 
                                value={formData.medicalConditions} 
                                onChange={e => setFormData({ ...formData, medicalConditions: e.target.value })} 
                            />
                        </div>
                        
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes / General Observations</label>
                            <textarea 
                                className="w-full border border-slate-300 p-2.5 rounded-xl text-sm bg-white text-slate-800 font-medium focus:ring-4 focus:ring-teal-500/10 focus:border-teal-500 outline-none transition-all" 
                                rows={2} 
                                value={formData.notes} 
                                onChange={e => setFormData({ ...formData, notes: e.target.value })} 
                            />
                        </div>
                    </div>
                </section>
            </div>
        </div>
    
        <div className="flex justify-end gap-3 border-t pt-4 mt-6">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-all"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            disabled={isSaving} 
            className={`px-5 py-2.5 font-bold rounded-xl text-sm transition-all shadow-sm ${
              isSaving 
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed' 
                : 'bg-teal-600 hover:bg-teal-700 text-white hover:shadow'
            }`}
          >
            {isSaving ? 'Processing...' : (patient ? 'Save Edit' : 'Register Patient')}
          </button>
        </div>
      </form>
    </div>
  );
}

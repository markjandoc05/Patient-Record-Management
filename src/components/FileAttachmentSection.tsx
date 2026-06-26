import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { LayoutGrid, List, X } from 'lucide-react';
import { db, storage } from '../firebase';
import Lightbox from './Lightbox';
import ConfirmationModal from './ConfirmationModal';
import { logActivity } from '../utils/auditLogger';
 
export default function FileAttachmentSection({ patientId, appointmentId, visitId, isGeneral = false }: { patientId: string, appointmentId: string | null, visitId: string | null, isGeneral?: boolean }) {
  const [files, setFiles] = useState<any[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<{file: File, note: string}[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [settings, setSettings] = useState({ allowedExtensions: ['.png', '.jpg', '.pdf'], maxFileSizeMB: 1, maxFilesPerAppointment: 5 });
  const [uploading, setUploading] = useState(false);
  const [fileToRemoveIndex, setFileToRemoveIndex] = useState<number | null>(null);
  const [fileToDelete, setFileToDelete] = useState<any | null>(null);
  const [failedLoadFiles, setFailedLoadFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'media'), (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            setSettings({
                allowedExtensions: ['.png', '.jpg', '.pdf'],
                maxFileSizeMB: 1,
                maxFilesPerAppointment: 5,
                ...data
            } as any);
        }
    });
    return unsub;
  }, []);

  const resourceId = isGeneral ? patientId : (visitId || appointmentId);
  const collectionName = isGeneral ? 'patients' : (visitId ? 'visits' : 'appointments');
  
  useEffect(() => {
    if (!resourceId) return;
    const unsub = onSnapshot(doc(db, collectionName, resourceId), (doc) => {
      setFiles(doc.data()?.attachments || []);
    });
    return unsub;
  }, [resourceId, collectionName]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    
    const newFiles = Array.from(fileList);

    if (files.length + selectedFiles.length + newFiles.length > settings.maxFilesPerAppointment) {
        alert(`Maximum of ${settings.maxFilesPerAppointment} files reached.`);
        return;
    }

    const filteredFiles = newFiles.filter(file => {
        if (!settings.allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
            alert(`File ${file.name} not allowed.`);
            return false;
        }
        if (file.size > settings.maxFileSizeMB * 1024 * 1024) {
            alert(`File ${file.name} too large.`);
            return false;
        }
        return true;
    });

    setSelectedFiles(prev => [...prev, ...filteredFiles.map(file => ({ file, note: '' }))]);
  };

  const performUpload = async () => {
    if (selectedFiles.length === 0 || !resourceId || !patientId) return;

    setUploading(true);
    try {
        const uploadedAttachments = [];
        for (const { file, note } of selectedFiles) {
            const fileId = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
            const storagePath = `uploads/${patientId}/${isGeneral ? 'general' : collectionName}/${resourceId}/${fileId}`;
            console.log("Uploading to storage path:", storagePath);
            const storageRef = ref(storage, storagePath);
            await uploadBytes(storageRef, file);
            
            // Wait for eventual consistency
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const downloadUrl = await getDownloadURL(storageRef);
            uploadedAttachments.push({ id: fileId, name: file.name, url: downloadUrl, storagePath, note });
            await logActivity({
                action: 'UPDATE',
                resource: visitId ? 'Visit' : appointmentId ? 'Appointment' : 'Patient',
                resourceId: resourceId!,
                details: `Uploaded attachment: ${file.name}`
            });
        }
        
        await updateDoc(doc(db, collectionName, resourceId), {
            attachments: arrayUnion(...uploadedAttachments)
        });
        setSelectedFiles([]);
    } catch (e: any) {
        console.error("Upload error:", e);
        alert(`File upload failed: ${e.message || 'Unknown error'}`);
    } finally {
        setUploading(false);
    }
  };

  const handleDelete = async (file: any) => {
    if (!resourceId) return;
    try {
        await updateDoc(doc(db, collectionName, resourceId), {
            attachments: arrayRemove(file)
        });
        await deleteObject(ref(storage, file.storagePath));
        await logActivity({
            action: 'UPDATE',
            resource: visitId ? 'Visit' : appointmentId ? 'Appointment' : 'Patient',
            resourceId: resourceId!,
            details: `Deleted attachment: ${file.name}`
        });
        setFileToDelete(null);
    } catch (e) {
        console.error(e);
        alert('File deletion failed.');
        setFileToDelete(null);
    }
  };

  const handleFileClick = (file: any) => {
    if (failedLoadFiles.has(file.id)) {
        alert('File not found or missing from storage.');
        return;
    }
    if (file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) {
        setPreviewUrl(file.url);
    } else {
        window.open(file.url, '_blank');
    }
  };

  const removeSelectedFile = (index: number) => {
    const fileToRemove = selectedFiles[index];
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
    logActivity({
            action: 'UPDATE',
            resource: visitId ? 'Visit' : appointmentId ? 'Appointment' : 'Patient',
            resourceId: resourceId!,
            details: `Removed attachment from selection: ${fileToRemove.file.name}`
    });
    setFileToRemoveIndex(null);
  };

  return (
    <section className="space-y-4">
        <div className="flex justify-between items-center border-b border-teal-100 pb-1">
            <h3 className="font-bold text-sm uppercase tracking-wider text-teal-800">Attachments ({files.length}/{settings.maxFilesPerAppointment})</h3>
            <div className="flex gap-1">
                <button type="button" onClick={() => setViewMode('list')} className={`p-1 rounded ${viewMode === 'list' ? 'bg-teal-100 text-teal-800' : 'text-slate-400'}`}><List size={16}/></button>
                <button type="button" onClick={() => setViewMode('grid')} className={`p-1 rounded ${viewMode === 'grid' ? 'bg-teal-100 text-teal-800' : 'text-slate-400'}`}><LayoutGrid size={16}/></button>
            </div>
        </div>
        
        <div className="flex items-center gap-2">
            <input type="file" multiple accept={settings.allowedExtensions.join(',')} onChange={handleFileSelect} disabled={uploading} className="hidden" id="file-upload" />
            <label htmlFor="file-upload" className="px-3 py-1 bg-white border border-teal-600 text-teal-700 rounded text-xs font-medium cursor-pointer hover:bg-teal-50 transition">
                Select Files
            </label>
            {selectedFiles.length > 0 && (
                <button type="button" onClick={performUpload} disabled={uploading} className="px-3 py-1 bg-teal-600 text-white rounded text-xs hover:bg-teal-700 transition">
                    Upload {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''}
                </button>
            )}
        </div>
        
        {selectedFiles.length > 0 && (
            <div className="space-y-2">
                {selectedFiles.map((item, index) => (
                    <div key={index} className="p-2 border border-slate-200 rounded text-xs bg-slate-50 flex items-center gap-2">
                        <span className="flex-grow">Preview: {item.file.name} ({(item.file.size / 1024).toFixed(0)} KB)</span>
                        <input type="text" value={item.note} onChange={e => {
                            const newFiles = [...selectedFiles];
                            newFiles[index].note = e.target.value;
                            setSelectedFiles(newFiles);
                        }} placeholder="Add note..." className="text-xs p-1 border rounded w-32" />
                        <button onClick={() => setFileToRemoveIndex(index)} className="text-slate-500 hover:text-red-700">Remove</button>
                    </div>
                ))}
            </div>
        )}

        {uploading && <p className="text-xs text-teal-600">Uploading...</p>}
        {files.length > 0 && (
            viewMode === 'grid' ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                    {files.map(file => (
                        <div key={file.id} className="border border-slate-200 rounded-lg overflow-hidden group">
                           <div className="aspect-square bg-slate-100 flex items-center justify-center relative cursor-pointer" onClick={() => handleFileClick(file)}>
                                {file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i) ? (
                                    <img src={file.url} alt={file.name} className="w-full h-full object-cover" onError={(e) => setFailedLoadFiles(prev => new Set(prev.add(file.id)))} />
                                ) : (
                                    <div className='text-xs text-slate-500 uppercase'>{file.name.split('.').pop()}</div>
                                )}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setFileToDelete(file); }} className="absolute top-1 right-1 bg-white/80 p-1 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition"><X size={14} /></button>
                           </div>
                           <p className="px-2 pt-2 text-[10px] truncate text-slate-600">{file.name}</p>
                           <a href={file.url} target="_blank" rel="noreferrer" className="px-2 pb-1 text-[10px] text-teal-600 hover:underline">Download/View</a>
                           {file.note && <p className="px-2 pb-2 text-[10px] text-slate-400 italic truncate">{file.note}</p>}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-2 mt-2">
                    {files.map(file => (
                        <div key={file.id} className="flex justify-between items-center bg-slate-50 p-2 rounded text-xs">
                            <div className="flex flex-col truncate">
                                <button type="button" onClick={() => handleFileClick(file)} className="text-teal-700 hover:underline truncate text-left">
                                    {file.name}
                                </button>
                                {file.note && <span className="text-slate-400 italic truncate text-[10px]">{file.note}</span>}
                            </div>
                            <div className='flex items-center gap-2'>
                              <a href={file.url} target="_blank" rel="noreferrer" className="text-teal-600 hover:underline text-[10px]">Download</a>
                              <button type="button" onClick={() => setFileToDelete(file)} className="text-red-500 hover:text-red-700 ml-2">Delete</button>
                            </div>
                        </div>
                    ))}
                </div>
            )
        )}
        <Lightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />
        {fileToRemoveIndex !== null && (
            <ConfirmationModal 
                isOpen={true}
                title="Remove File"
                message="Are you sure you want to remove this file from the selection?"
                onConfirm={() => removeSelectedFile(fileToRemoveIndex)}
                onCancel={() => setFileToRemoveIndex(null)}
            />
        )}
        {fileToDelete && (
            <ConfirmationModal 
                isOpen={true}
                title="Delete File"
                message="Are you sure you want to permanently delete this file?"
                onConfirm={() => handleDelete(fileToDelete)}
                onCancel={() => setFileToDelete(null)}
                confirmLabel="Delete"
            />
        )}
    </section>
  );
}

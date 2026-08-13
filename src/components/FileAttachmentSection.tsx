import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { LayoutGrid, List, X } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { db } from '../firebase';
import Lightbox from './Lightbox';
import ConfirmationModal from './ConfirmationModal';
import { deleteAttachment, downloadAttachment, fetchAttachmentBlob, isImageAttachment, openAttachment, uploadAttachment } from '../utils/attachmentApi';
 
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
  const [secureUrls, setSecureUrls] = useState<Record<string, string>>({});

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
  const resourceType = isGeneral ? 'patient' : (visitId ? 'visit' : 'appointment');
  
  useEffect(() => {
    if (!resourceId) return;
    const unsub = onSnapshot(doc(db, collectionName, resourceId), (doc) => {
      setFiles(doc.data()?.attachments || []);
    });
    return unsub;
  }, [resourceId, collectionName]);

  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];
    const imageFiles = files.filter(file => file?.storagePath && isImageAttachment(file));

    Promise.all(imageFiles.map(async file => {
      try {
        const blob = await fetchAttachmentBlob(file.storagePath);
        const objectUrl = URL.createObjectURL(blob);
        createdUrls.push(objectUrl);
        return [file.storagePath, objectUrl] as const;
      } catch (error) {
        console.error('Failed to load protected attachment preview:', error);
        setFailedLoadFiles(previous => new Set(previous).add(file.id));
        return null;
      }
    })).then(entries => {
      if (active) setSecureUrls(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, string]>));
    });

    return () => {
      active = false;
      createdUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [files]);

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
        // Increase the allowed selection size for images because we will compress them before upload
        const isImage = file.name.match(/\.(jpg|jpeg|png|webp)$/i);
        if (!isImage && file.size > settings.maxFileSizeMB * 1024 * 1024) {
            alert(`File ${file.name} too large.`);
            return false;
        }
        // For images, we allow up to 20MB for selection since we will compress it to < 500KB
        if (isImage && file.size > 20 * 1024 * 1024) {
            alert(`Image ${file.name} is too large (max 20MB for processing).`);
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
        for (const { file, note } of selectedFiles) {
            let fileToUpload: File | Blob = file;
            
            // Compress image if it's an image
            if (file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
                console.log(`Compressing ${file.name}... original size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
                const options = {
                    maxSizeMB: 0.5, // Max 500KB as requested
                    maxWidthOrHeight: 1920,
                    useWebWorker: true,
                };
                try {
                    fileToUpload = await imageCompression(file, options);
                    console.log(`Compression success for ${file.name}. New size: ${(fileToUpload.size / 1024 / 1024).toFixed(2)}MB`);
                } catch (compressionError) {
                    console.error("Compression failed, uploading original:", compressionError);
                }
            }

            await uploadAttachment({
              file: fileToUpload,
              originalName: file.name,
              note,
              patientId,
              resourceType,
              resourceId,
            });
        }
        
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
        await deleteAttachment(file.storagePath);
        setFileToDelete(null);
    } catch (e) {
        console.error(e);
        alert('File deletion failed.');
        setFileToDelete(null);
    }
  };

  const handleFileClick = async (file: any) => {
    if (failedLoadFiles.has(file.id)) {
        alert('File not found or missing from storage.');
        return;
    }
    try {
      if (isImageAttachment(file)) {
        let objectUrl = secureUrls[file.storagePath];
        if (!objectUrl) {
          objectUrl = URL.createObjectURL(await fetchAttachmentBlob(file.storagePath));
          setSecureUrls(previous => ({ ...previous, [file.storagePath]: objectUrl }));
        }
        setPreviewUrl(objectUrl);
      } else {
        await openAttachment(file);
      }
    } catch (error: any) {
      console.error('Protected attachment open failed:', error);
      alert(error?.message || 'File could not be opened.');
    }
  };

  const handleDownload = async (file: any) => {
    try {
      await downloadAttachment(file);
    } catch (error: any) {
      console.error('Protected attachment download failed:', error);
      alert(error?.message || 'File could not be downloaded.');
    }
  };

  const removeSelectedFile = (index: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
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
                                {isImageAttachment(file) ? (
                                    secureUrls[file.storagePath]
                                      ? <img src={secureUrls[file.storagePath]} alt={file.name} className="w-full h-full object-cover" onError={() => setFailedLoadFiles(prev => new Set(prev).add(file.id))} />
                                      : <span className="text-xs text-slate-400">Loading preview...</span>
                                ) : (
                                    <div className='text-xs text-slate-500 uppercase'>{file.name.split('.').pop()}</div>
                                )}
                                <button type="button" onClick={(e) => { e.stopPropagation(); setFileToDelete(file); }} className="absolute top-1 right-1 bg-white/80 p-1 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition"><X size={14} /></button>
                           </div>
                           <p className="px-2 pt-2 text-[10px] truncate text-slate-600">{file.name}</p>
                           <button type="button" onClick={() => handleDownload(file)} className="px-2 pb-1 text-[10px] text-teal-600 hover:underline text-left">Download</button>
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
                              <button type="button" onClick={() => handleDownload(file)} className="text-teal-600 hover:underline text-[10px]">Download</button>
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

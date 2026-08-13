import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon, Calendar } from 'lucide-react';
import Lightbox from './Lightbox';
import { useTimezone } from '../contexts/TimezoneContext';
import { downloadAttachment, fetchAttachmentBlob, isImageAttachment, openAttachment } from '../utils/attachmentApi';
import { formatTimezone } from '../utils/timezone';

export default function PatientMediaTab({ patientId, users, branches, visits }: { patientId: string, users: any[], branches: any[], visits: any[] }) {
    const timezone = useTimezone();
const formatDate = (dateString: string) => {
    return formatTimezone(dateString, timezone);
};
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
    const [failedLoadFiles, setFailedLoadFiles] = useState<Set<string>>(new Set());
    const [secureUrls, setSecureUrls] = useState<Record<string, string>>({});

    const items = useMemo(() => visits
        .filter(visit => visit.patientId === patientId && visit.isArchived !== true && visit.attachments?.length > 0)
        .map(visit => ({ id: visit.id, type: 'visit' as const, data: visit }))
        .sort((a, b) => new Date(b.data.visitDate).getTime() - new Date(a.data.visitDate).getTime()),
    [patientId, visits]);

    const attachments = useMemo(() => items.flatMap(item => item.data.attachments || []), [items]);

    useEffect(() => {
        let active = true;
        const createdUrls: string[] = [];
        Promise.all(attachments.filter(file => file?.storagePath && isImageAttachment(file)).map(async file => {
            try {
                const blob = await fetchAttachmentBlob(file.storagePath);
                const objectUrl = URL.createObjectURL(blob);
                createdUrls.push(objectUrl);
                return [file.storagePath, objectUrl] as const;
            } catch (error) {
                console.error('Failed to load protected media preview:', error);
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
    }, [attachments]);

    const toggleItem = (itemId: string) => {
        const next = new Set(expandedItems);
        if (next.has(itemId)) next.delete(itemId);
        else next.add(itemId);
        setExpandedItems(next);
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
            console.error('Protected media open failed:', error);
            alert(error?.message || 'File could not be opened.');
        }
    };

    const handleDownload = async (file: any) => {
        try {
            await downloadAttachment(file);
        } catch (error: any) {
            console.error('Protected media download failed:', error);
            alert(error?.message || 'File could not be downloaded.');
        }
    };

    return (
        <div className="space-y-6">
            <h3 className="font-bold text-lg text-slate-800">Media Files (Aggregated)</h3>
            {items.length === 0 ? (
                <p className="text-sm text-slate-500">No media attachments found for this patient.</p>
            ) : (
                <div className="space-y-4">
                    {items.map(item => {
                        const isExpanded = expandedItems.has(item.id);
                        const date = item.data.visitDate;
                        const doctor = users.find(u => u.id === item.data.doctorId);
                        const branch = branches.find(b => b.id === item.data.branchId);
                        
                        return (
                            <div key={item.id} className="border border-slate-200 rounded-lg overflow-hidden">
                                <button 
                                    onClick={() => toggleItem(item.id)}
                                    className="w-full text-left p-4 bg-slate-50"
                                >
                                    <div className="flex items-center justify-between font-medium text-slate-700 mb-2">
                                        <div className="flex items-center gap-2">
                                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                            <Calendar size={16} className="text-teal-600" />
                                            {formatDate(date)}
                                        </div>
                                        <span className="text-xs bg-teal-100 text-teal-800 px-2 py-1 rounded-full">{item.data.attachments.length} files</span>
                                    </div>
                                    <div className="text-xs text-slate-500 grid grid-cols-2 gap-2 ml-6">
                                        <div><span className="font-semibold">Type:</span> {item.data.visitType}</div>
                                        <div><span className="font-semibold">Branch:</span> {branch?.branchName || 'N/A'}</div>
                                        <div><span className="font-semibold">Doctor:</span> {doctor?.fullName || 'N/A'}</div>
                                        <div><span className="font-semibold">Service:</span> {item.data.treatmentService || 'N/A'}</div>
                                    </div>
                                </button>
                                {isExpanded && (
                                    <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-4">
                                        {item.data.attachments.map((file: any) => (
                                            <div key={file.id} className="border border-slate-100 rounded-lg p-3 hover:shadow-sm transition">
                                                <div className="aspect-video bg-slate-100 rounded overflow-hidden mb-2 flex items-center justify-center relative cursor-pointer" onClick={() => handleFileClick(file)}>
                                                    {isImageAttachment(file) ? (
                                                        secureUrls[file.storagePath]
                                                            ? <img src={secureUrls[file.storagePath]} alt={file.name} loading="lazy" className="w-full h-full object-cover" onError={() => setFailedLoadFiles(prev => new Set(prev).add(file.id))} />
                                                            : <span className="text-xs text-slate-400">Loading preview...</span>
                                                    ) : (
                                                        <FileText size={32} className="text-slate-400" />
                                                    )}
                                                </div>
                                                <button className="text-xs font-medium text-slate-700 truncate hover:text-teal-700 hover:underline block w-full text-left" onClick={() => handleFileClick(file)}>{file.name}</button>
                                                <button type="button" onClick={() => handleDownload(file)} className="text-[10px] text-teal-600 hover:underline block mt-1">Download</button>
                                                <p className="text-[10px] text-slate-400 italic mt-1 truncate">{file.note || 'No note'}</p>
                                                <p className="text-[10px] text-slate-500 mt-1">Uploaded: {formatDate(new Date(parseInt(file.id.split('_')[0])).toISOString())}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            <Lightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />
        </div>
    );
}

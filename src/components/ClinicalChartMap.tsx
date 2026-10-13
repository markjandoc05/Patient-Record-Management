import React from 'react';
import type { ChartMap, ChartMarker } from '../clinicalChartPolicy';

export const chartMapLabels: Record<ChartMap, string> = { face: 'Face', 'body-front': 'Body — Front', 'body-back': 'Body — Back' };

type Props = {
  map: ChartMap;
  markers: ChartMarker[];
  selectedMarkerId?: string | null;
  editable?: boolean;
  onAdd?: (x: number, y: number) => void;
  onSelect?: (id: string) => void;
};

// Coordinates describe the fixed schematic, not a patient photograph or a
// physical measurement. Every display and exported revision uses this version.
export default function ClinicalChartMap({ map, markers, selectedMarkerId, editable = false, onAdd, onSelect }: Props) {
  const height = map === 'face' ? 120 : 160;
  const visible = markers.filter(marker => marker.map === map);
  return (
    <div className="clinical-chart-map rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] font-semibold text-slate-500">
        <span>{map === 'body-back' ? 'Patient left' : 'Patient right'}</span>
        <span>{map === 'body-back' ? 'Patient right' : 'Patient left'}</span>
      </div>
      <svg
        viewBox={`0 0 100 ${height}`}
        role="img"
        aria-label={`${chartMapLabels[map]} schematic with ${visible.length} marker${visible.length === 1 ? '' : 's'}`}
        className={`mx-auto block w-full ${map === 'face' ? 'max-w-[320px]' : 'max-w-[240px]'} ${editable ? 'cursor-crosshair' : ''}`}
        style={{ aspectRatio: `100 / ${height}` }}
        onClick={event => {
          if (!editable || !onAdd) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          onAdd(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)));
        }}
      >
        <title>{chartMapLabels[map]} reference schematic</title>
        <g fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
          {map === 'face' ? <>
            <path d="M34 93 L33 108 Q50 116 67 108 L66 93 M33 106 Q20 108 8 117 M67 106 Q80 108 92 117" />
            <path d="M23 39 Q16 33 18 49 Q18 61 25 62 M77 39 Q84 33 82 49 Q82 61 75 62" />
            <path d="M50 9 C25 9 20 29 23 54 C25 75 33 94 50 100 C67 94 75 75 77 54 C80 29 75 9 50 9 Z" />
            <path fill="none" d="M28 38 Q36 32 44 37 M56 37 Q64 32 72 38 M29 44 Q36 40 43 44 Q36 49 29 44 M57 44 Q64 40 71 44 Q64 49 57 44 M50 45 L46 64 Q50 67 54 64 M40 78 Q50 72 60 78 Q50 87 40 78 M42 78 L58 78" />
            <path fill="none" strokeDasharray="2 2" opacity="0.5" d="M50 12 V96" />
          </> : <>
            <ellipse cx="50" cy="16" rx="10" ry="12" />
            <path d="M44 27 L44 32 L29 36 Q25 38 23 45 L12 77 L9 91 Q8 96 11 97 Q14 97 16 90 L20 78 L31 53 L33 76 L30 88 L34 112 L36 143 L33 153 Q32 156 42 155 L45 113 L50 91 L55 113 L58 155 Q68 156 67 153 L64 143 L66 112 L70 88 L67 76 L69 53 L80 78 L84 90 Q86 97 89 97 Q92 96 91 91 L88 77 L77 45 Q75 38 71 36 L56 32 L56 27" />
            {map === 'body-front' ? <path fill="none" d="M36 42 Q43 39 48 44 M52 44 Q57 39 64 42 M36 59 Q42 63 48 59 M52 59 Q58 63 64 59 M50 48 V73 M48 78 Q50 80 52 78 M35 87 Q41 91 50 91 Q59 91 65 87 M37 116 L43 116 M57 116 L63 116" /> : <>
              <path fill="none" d="M36 43 Q42 47 43 58 M64 43 Q58 47 57 58 M35 78 Q42 74 48 80 M52 80 Q58 74 65 78 M34 88 Q40 94 49 89 M51 89 Q60 94 66 88" />
              <path fill="none" strokeDasharray="2 2" d="M50 33 V86" />
            </>}
          </>}
        </g>
        {visible.map(marker => {
          const number = markers.findIndex(item => item.id === marker.id) + 1;
          const selected = marker.id === selectedMarkerId;
          return <g key={marker.id} role="button" tabIndex={0} aria-label={`Marker ${number}: ${marker.label || 'Untitled'}`} aria-pressed={selected}
            className="cursor-pointer outline-none focus:stroke-slate-900"
            onClick={event => { event.stopPropagation(); onSelect?.(marker.id); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect?.(marker.id); } }}>
            <circle cx={marker.x * 100} cy={marker.y * height} r={selected ? 4.5 : 3.7} fill={selected ? '#0f172a' : '#0f766e'} stroke="white" strokeWidth="0.9" />
            <text x={marker.x * 100} y={marker.y * height + 1.1} textAnchor="middle" fontSize="3.4" fontWeight="700" fill="white" pointerEvents="none">{number}</text>
          </g>;
        })}
      </svg>
      <p className="mt-2 text-center text-[10px] text-slate-500">Schematic reference · {chartMapLabels[map]}</p>
    </div>
  );
}

import React from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock3, MapPin, Timer, TrendingUp, Utensils } from 'lucide-react';
import { Avatar } from './UI.jsx';
import { formatMinutes, formatTime, shortDate, markLabel } from '../utils.js';

export default function AttendanceItem({ record, showUser = true, onClick, compact = false }) {
  const entry = record.type === 'entry';
  const lunch = record.type.startsWith('lunch_');
  return <button className={`attendance-item ${compact ? 'attendance-compact' : ''}`} onClick={() => onClick?.(record)}>
    {showUser ? <Avatar user={record} /> : <span className={`record-type-icon ${lunch ? 'lunch' : entry ? 'entry' : 'exit'}`}>{lunch ? <Utensils size={20} /> : entry ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}</span>}
    <span className="attendance-copy">
      <span className="attendance-name-line"><strong>{showUser ? record.name : markLabel(record.type)}</strong>{showUser && <span className={`type-badge ${lunch ? 'lunch' : entry ? 'entry' : 'exit'}`}>{markLabel(record.type)}</span>}</span>
      <span className="attendance-meta"><span>{shortDate(record.created_at)} · {formatTime(record.created_at)}</span><span className="meta-location"><MapPin size={12} /> GPS</span></span>
      {showUser && !compact && <span className="attendance-position">{record.position}</span>}
      <span className="time-flags">{lunch && <span className="time-flag lunch"><Utensils size={11} /> Almuerzo · 12:00–13:00</span>}
        {entry && record.lateMinutes > 0 && <span className="time-flag late"><Clock3 size={11} /> {formatMinutes(record.lateMinutes)} de tardanza</span>}
        {entry && !record.lateMinutes && <span className="time-flag ontime"><Clock3 size={11} /> A tiempo</span>}
        {!entry && !lunch && record.overtimeMinutes > 0 && <span className="time-flag extra"><TrendingUp size={11} /> {formatMinutes(record.overtimeMinutes)} extra</span>}
        {!entry && !lunch && !record.overtimeMinutes && record.earlyLeaveMinutes > 0 && <span className="time-flag early"><Timer size={11} /> {formatMinutes(record.earlyLeaveMinutes)} antes</span>}
        {!entry && !lunch && !record.overtimeMinutes && !record.earlyLeaveMinutes && <span className="time-flag ontime"><Clock3 size={11} /> Salida puntual</span>}
      </span>
    </span>
    <span className="record-thumb"><img src={record.photoUrl} alt={`Foto de ${markLabel(record.type).toLowerCase()}`} loading="lazy" /><span className={`record-status-dot ${lunch ? 'lunch' : entry ? 'entry' : 'exit'}`} /></span>
    <ChevronRight className="item-chevron" size={17} />
  </button>;
}

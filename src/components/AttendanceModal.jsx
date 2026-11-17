import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Camera, Check, CheckCircle2, Clock3, Crosshair, ImagePlus, LoaderCircle, MapPin, Navigation, RefreshCw, ShieldCheck, SwitchCamera } from 'lucide-react';
import { api } from '../api.js';
import { formatDate, formatMinutes, formatTime, maxExitTime } from '../utils.js';
import { CloseButton, Modal, Spinner } from './UI.jsx';

export default function AttendanceModal({ user, onClose, onRecorded, onViewHistory }) {
  const [type, setType] = useState('entry');
  const [status, setStatus] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(true);
  const [locationError, setLocationError] = useState('');
  const [cameraState, setCameraState] = useState('idle');
  const [cameraError, setCameraError] = useState('');
  const [videoReady, setVideoReady] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(null);
  const [success, setSuccess] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };
  const locate = () => {
    setLocating(true); setLocationError('');
    if (!navigator.geolocation) { setLocationError('Este dispositivo no admite geolocalización.'); setLocating(false); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }); setLocating(false); },
      err => {
        setLocation(null); setLocating(false);
        setLocationError(err.code === 1 ? 'Permiso de ubicación denegado. Habilítalo en tu navegador.' : 'No pudimos obtener tu GPS. Muévete a un lugar despejado y reintenta.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };
  const loadStatus = async () => {
    try {
      const data = await api('/attendance/status');
      setStatus(data); setType(data.nextType);
      // La salida venció sin marcarse: se informa el plazo y se deja registrar una nueva entrada.
      setBlocked(data.priorExit ? { message: data.priorExit.message, deadline: data.priorExit.deadline, day: data.priorExit.day, lateMark: data.priorExit.lateMark } : null);
    } catch (err) { setError(err.message); }
  };
  useEffect(() => { locate(); loadStatus(); return () => { stopCamera(); if (photoUrl) URL.revokeObjectURL(photoUrl); }; }, []);
  useEffect(() => {
    if (cameraState === 'active' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraState]);

  const startCamera = async (mode = facingMode) => {
    stopCamera(); setCameraError(''); setVideoReady(false); setCameraState('requesting');
    if (!navigator.mediaDevices?.getUserMedia) { setCameraState('error'); setCameraError('La cámara no está disponible. Puedes adjuntar una foto.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      streamRef.current = stream; setFacingMode(mode); setCameraState('active');
    } catch (err) {
      setCameraState('error');
      setCameraError(err.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Habilítalo o adjunta una foto.' : 'No pudimos acceder a la cámara. Puedes adjuntar una foto.');
    }
  };
  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) { setCameraError('La cámara aún se está preparando. Espera un momento y vuelve a intentarlo.'); return; }
    setCameraError('');
    const scale = Math.min(1, 1000 / video.videoWidth);
    const canvas = canvasRef.current;
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setPhoto(new File([blob], `asistencia-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      setPhotoUrl(URL.createObjectURL(blob)); stopCamera(); setCameraState('captured');
    }, 'image/jpeg', 0.84);
  };
  const chooseFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setCameraError('La foto supera 4 MB, el límite de Vercel. Toma una foto con la cámara para optimizarla.'); return; }
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(file); setPhotoUrl(URL.createObjectURL(file)); stopCamera(); setCameraState('captured'); setCameraError('');
  };
  const retake = () => { if (photoUrl) URL.revokeObjectURL(photoUrl); setPhoto(null); setPhotoUrl(''); setCameraState('idle'); };

  const submit = async () => {
    if (!photo || !location) return;
    setSubmitting(true); setError('');
    const body = new FormData();
    body.append('type', type); body.append('photo', photo);
    body.append('latitude', location.latitude); body.append('longitude', location.longitude); body.append('accuracy', location.accuracy || '');
    try {
      const data = await api('/attendance', { method: 'POST', body });
      setSuccess(data.record); stopCamera(); onRecorded(data.message);
    } catch (err) {
      setError(err.message);
      if (err.status === 409) loadStatus();
    } finally { setSubmitting(false); }
  };

  const entry = type === 'entry';
  return <Modal onClose={submitting ? undefined : onClose} full className="attendance-modal" labelledBy="attendance-title">
    {success ? <div className="attendance-success"><div className="success-confetti"><i /><i /><i /><i /><i /><i /></div><div className="success-check"><span><Check size={43} strokeWidth={2.5} /></span><i className="success-ring ring-1" /><i className="success-ring ring-2" /></div><span className="section-kicker">MARCACIÓN COMPLETADA</span><h2>¡{entry ? 'Entrada' : 'Salida'} registrada!</h2><p>{entry ? 'Todo listo. Que tengas una jornada increíble' : 'Tu jornada quedó cerrada correctamente'}, {user.name.split(' ')[0]}.</p><div className="success-ticket"><div className="ticket-top"><span className={`record-type-icon ${entry ? 'entry' : 'exit'}`}>{entry ? <ArrowDownLeft size={22} /> : <ArrowUpRight size={22} />}</span><div><small>{entry ? 'ENTRADA' : 'SALIDA'}</small><strong>{formatTime(success.created_at)}</strong></div><CheckCircle2 size={24} /></div><div className={`schedule-result ${entry ? (success.late_minutes > 0 ? 'late' : 'ontime') : (success.overtime_minutes > 0 ? 'extra' : success.early_leave_minutes > 0 ? 'early' : 'ontime')}`}><Clock3 size={18} /><div><small>{entry ? `HORARIO DE INGRESO · ${success.scheduled_entry || status?.scheduledEntry || '08:00'}` : `HORARIO DE SALIDA · ${success.scheduled_exit || status?.scheduledExit || '17:00'}`}</small><strong>{entry ? (success.late_minutes > 0 ? `${formatMinutes(success.late_minutes)} de tardanza` : 'Llegaste a tiempo') : (success.overtime_minutes > 0 ? `${formatMinutes(success.overtime_minutes)} de tiempo extra` : success.early_leave_minutes > 0 ? `Saliste ${formatMinutes(success.early_leave_minutes)} antes` : 'Salida puntual')}</strong></div></div><div className="ticket-photo"><img src={photoUrl} alt="Foto registrada" /><span><Camera size={14} /> Evidencia guardada</span></div><div className="ticket-location"><MapPin size={18} /><div><strong>Ubicación GPS verificada</strong><span>{success.latitude.toFixed(5)}, {success.longitude.toFixed(5)}</span></div></div></div><button className="primary-button success-done" onClick={onClose}>Volver al inicio <ArrowRight size={18} /></button><button className="text-button" onClick={onViewHistory}>Ver mi historial</button></div> : <>
      <header className="attendance-modal-header"><div><span className="section-kicker">NUEVA MARCACIÓN</span><h2 id="attendance-title">Registra tu momento<span>.</span></h2></div><CloseButton onClick={onClose} /></header>
      <div className="attendance-progress"><span className={photo ? 'done' : 'active'}><i>{photo ? <Check size={12} /> : '1'}</i> Foto</span><b /><span className={location ? 'done' : ''}><i>{location ? <Check size={12} /> : '2'}</i> Ubicación</span><b /><span><i>3</i> Confirmar</span></div>
      <div className="attendance-modal-scroll">
        <div className="attendance-type-switch"><button className={entry ? 'active entry' : ''} disabled={!entry && !!status?.exitPending} title={!entry && status?.exitPending ? `Debes cerrar tu jornada: la salida se marca hasta las ${status.exitDeadline}.` : undefined} onClick={() => setType('entry')}><ArrowDownLeft size={19} /><span><strong>Entrada</strong><small>Comienzo mi jornada</small></span>{entry && <Check size={16} />}</button><button className={!entry ? 'active exit' : ''} disabled={entry && !!status?.priorExit} title={entry && status?.priorExit ? status.priorExit.message : undefined} onClick={() => setType('exit')}><ArrowUpRight size={19} /><span><strong>Salida</strong><small>{status?.priorExit ? 'Plazo vencido' : status?.exitPending ? `Hasta las ${status.exitDeadline}` : 'Finalizo mi jornada'}</small></span>{!entry && <Check size={16} />}</button></div>
        {status?.last && <div className="last-mark-note"><ClockIcon /><span>Última marcación: <strong>{status.last.type === 'entry' ? 'Entrada' : 'Salida'}</strong> · {formatTime(status.last.created_at)}</span></div>}
        {status && <div className="attendance-schedule-note"><Clock3 size={14} /><span>Tu horario: <strong>{status.scheduledEntry || '08:00'} — {status.scheduledExit || '17:00'}</strong> · plazo máximo de salida <strong>{maxExitTime({ entry: status.scheduledEntry, exit: status.scheduledExit })}</strong></span></div>}
        {blocked && <div className="exit-window-note" role="status"><Clock3 size={16} /><div><strong>Salida sin marcar del {formatDate(blocked.day + 'T12:00:00', { day: '2-digit', month: 'long' })}</strong><span>{blocked.message} Puedes registrar tu siguiente entrada normalmente.</span></div></div>}

        <section className="capture-section"><div className="capture-section-heading"><div><span className="step-number">01</span><div><h3>Tu foto de asistencia</h3><p>Una selfie rápida para validar tu identidad.</p></div></div>{photo && <button className="text-button" onClick={retake}><RefreshCw size={14} /> Repetir</button>}</div>
          <div className={`camera-view ${cameraState === 'active' ? 'camera-active' : ''} ${photoUrl ? 'has-photo' : ''}`}>
            {photoUrl ? <img src={photoUrl} alt="Vista previa de tu marcación" /> : cameraState === 'active' || cameraState === 'requesting' ? <video ref={videoRef} playsInline muted autoPlay onLoadedMetadata={() => setVideoReady(true)} onCanPlay={() => setVideoReady(true)} /> : <div className="camera-placeholder"><span className="camera-placeholder-icon"><Camera size={32} /></span><h4>Tu rostro, tu respaldo</h4><p>Centra tu rostro y busca un lugar con buena luz.</p><button className="camera-enable" onClick={() => startCamera()}><Camera size={18} /> Activar cámara</button></div>}
            {cameraState === 'requesting' && <div className="camera-loading"><Spinner light size={28} /><span>Encendiendo cámara...</span></div>}
            {cameraState === 'active' && <><div className="face-frame"><i /><i /><i /><i /></div><div className="camera-top-badge"><span className="live-dot" /> CÁMARA EN VIVO</div><div className="camera-controls"><button onClick={() => startCamera(facingMode === 'user' ? 'environment' : 'user')} aria-label="Cambiar cámara"><SwitchCamera size={21} /></button><button className="shutter" onClick={capture} aria-label="Tomar foto" disabled={!videoReady}><span /></button><button onClick={() => fileRef.current?.click()} aria-label="Elegir de galería"><ImagePlus size={21} /></button></div></>}
            {photoUrl && <div className="photo-ok-badge"><Check size={14} /> Foto lista</div>}
          </div>
          {(cameraState === 'idle' || cameraState === 'error') && <button className="gallery-fallback" onClick={() => fileRef.current?.click()}><ImagePlus size={16} /> O elegir una foto de la galería</button>}
          {cameraError && <p className="capture-error">{cameraError}</p>}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={chooseFile} /><canvas ref={canvasRef} hidden />
        </section>

        <section className="location-section"><div className="capture-section-heading"><div><span className="step-number">02</span><div><h3>Tu ubicación actual</h3><p>Solo se captura en esta marcación.</p></div></div>{location && <span className="verified-label"><Check size={13} /> Verificada</span>}</div>
          <div className={`gps-card ${location ? 'gps-found' : ''}`}><div className="gps-radar"><span /><i /><b>{locating ? <LoaderCircle className="spin" size={24} /> : location ? <Navigation size={25} /> : <MapPin size={25} />}</b></div><div className="gps-copy">{locating ? <><strong>Buscando tu ubicación...</strong><span>Obtén una señal más precisa en un lugar despejado.</span></> : location ? <><strong>GPS obtenido correctamente</strong><span className="coordinates">{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</span><small><Crosshair size={12} /> Precisión aproximada: ±{Math.round(location.accuracy || 0)} m</small></> : <><strong>Necesitamos tu ubicación</strong><span>{locationError}</span></>}</div>{!locating && <button className="gps-retry" onClick={locate} aria-label="Actualizar ubicación"><RefreshCw size={17} /></button>}</div>
        </section>
        <div className="capture-privacy"><ShieldCheck size={17} /><span>Tus datos se usan únicamente para validar esta asistencia.</span></div>
        {error && <div className="form-error">{error}</div>}
      </div>
      <footer className="attendance-submit-bar"><div className="submit-readiness"><span className={photo ? 'ready' : ''}>{photo ? <Check size={13} /> : <Camera size={13} />} Foto</span><span className={location ? 'ready' : ''}>{location ? <Check size={13} /> : <MapPin size={13} />} GPS</span></div><button className="primary-button attendance-submit" disabled={!photo || !location || submitting} onClick={submit}>{submitting ? <><Spinner light /> Guardando...</> : <>Confirmar {entry ? 'entrada' : 'salida'} <ArrowRight size={19} /></>}</button></footer>
    </>}
  </Modal>;
}

function ClockIcon() { return <span className="tiny-clock">↻</span>; }

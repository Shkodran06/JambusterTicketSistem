'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useEffect, useMemo, useState } from 'react';

declare global { interface Window { firebase: any } }

type Shift = 'Frühschicht' | 'Mittelschicht' | 'Spätschicht';
type View = 'overview' | 'new' | 'tickets' | 'handover' | 'analytics' | 'accounts';
type Role = 'admin' | 'technician';
type Profile = { id: string; name: string; email: string; role: Role; active: boolean };
type AuthUser = { uid: string; email: string | null };
type Ticket = {
  id: string;
  createdAt: string;
  dateKey: string;
  shift: Shift;
  area: string;
  category: string;
  address: string;
  reason?: string;
  description: string;
  technician: string;
};

const firebaseConfig = {
  apiKey: 'AIzaSyAzp8W51fEKkaBHKtA7MoLSMk6TDwJay9w',
  authDomain: 'jambusterticketsistem.firebaseapp.com',
  projectId: 'jambusterticketsistem',
  storageBucket: 'jambusterticketsistem.firebasestorage.app',
  messagingSenderId: '937461542098',
  appId: '1:937461542098:web:692b14bf187407cf46510b',
};

function firebase() {
  if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseConfig);
  return window.firebase;
}
function firebaseAuth() { return firebase().auth(); }
function firebaseDb() { return firebase().firestore(); }

type RuntimeConfig = {
  technicians: string[];
  categories: string[];
  areas: string[];
  notaus: string[];
  shiftTimes: Record<Shift, string>;
};

const shifts: { name: Shift; icon: string }[] = [
  { name: 'Frühschicht', icon: '☀' },
  { name: 'Mittelschicht', icon: '◐' },
  { name: 'Spätschicht', icon: '☾' },
];

const reasonOptions = [
  'Verdrehten Behälter aufgrund zu hohen Gewichts geradegerichtet.',
  'Verdrehten Behälter aufgrund einer Anlagenstörung geradegerichtet',
  'Verdrehten Behälter',
  'Schweren Behälter weitergeschoben',
  'Blockierenden Karton vom Kartonband entfernt.',
  'Lichtschranke ausgerichtet',
  'Belegte Lichtschranke quittiert',
  'Störung Waage',
  'Not Aus',
  'Stapler reterenziert',
  'Schweren Tray weitergeschoben',
  'Sonstiges',
];

export default function Home() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [stage, setStage] = useState<'login' | 'shift' | 'app'>('login');
  const [view, setView] = useState<View>('overview');
  const [shift, setShift] = useState<Shift>('Frühschicht');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [now, setNow] = useState(new Date());
  const [config, setConfig] = useState<RuntimeConfig | null>(null);

  useEffect(() => {
    const sdk = firebase();
    const auth = firebaseAuth();
    auth.setPersistence(sdk.auth.Auth.Persistence.LOCAL).catch(() => undefined);
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    const unsubscribe = auth.onAuthStateChanged(async (current: AuthUser | null) => {
      if (!current) {
        setUser(null);
        setProfile(null);
        setStage('login');
        setAuthReady(true);
        return;
      }
      try {
        const snap = await firebaseDb().collection('users').doc(current.uid).get();
        if (!snap.exists) throw new Error('Dieses Konto wurde noch nicht von einem Admin freigeschaltet.');
        const data = snap.data() as Omit<Profile, 'id'>;
        if (!data.active) throw new Error('Dieses Konto ist deaktiviert.');
        setAuthError('');
        setUser(current);
        setProfile({ id: current.uid, ...data });
        const saved = localStorage.getItem('jts_selected_shift') as Shift | null;
        if (saved && shifts.some(item => item.name === saved)) {
          setShift(saved);
          setStage('app');
        } else {
          setStage('shift');
        }
      } catch (error) {
        setAuthError(errorMessage(error));
        await auth.signOut();
      } finally {
        setAuthReady(true);
      }
    });
    return () => { window.clearInterval(timer); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!profile) { setTickets([]); return; }
    return firebaseDb().collection('tickets').orderBy('createdAt', 'desc').onSnapshot((snapshot: any) => {
      setTickets(snapshot.docs.map((item: any) => {
        const data = item.data() as Omit<Ticket, 'id' | 'createdAt'> & { createdAt?: { toDate?: () => Date } };
        return { id: item.id, ...data, createdAt: data.createdAt?.toDate?.().toISOString() ?? new Date().toISOString() };
      }));
    }, (error: Error) => setAuthError(error.message));
  }, [profile]);

  useEffect(() => {
    if (!profile) { setConfig(null); return; }
    return firebaseDb().collection('config').doc('app').onSnapshot((snapshot: any) => {
      if (!snapshot.exists) { setAuthError('Die geschützte JTS-Konfiguration fehlt.'); return; }
      const data = snapshot.data();
      const runtime = typeof data?.payload === 'string' ? JSON.parse(data.payload) : data;
      setConfig(runtime as RuntimeConfig);
    }, (error: Error) => setAuthError(error.message));
  }, [profile]);

  const current = useMemo(() => tickets.filter(ticket => ticket.dateKey === zurichDateKey(now) && ticket.shift === shift), [tickets, now, shift]);

  if (!authReady) return <LoadingScreen />;
  if (!user || !profile || stage === 'login') return <Login error={authError} clearError={() => setAuthError('')} />;
  if (!config) return <LoadingScreen />;
  if (stage === 'shift') return <ShiftSelect profile={profile} shift={shift} setShift={setShift} config={config} start={() => { localStorage.setItem('jts_selected_shift', shift); setStage('app'); }} logout={() => firebaseAuth().signOut()} />;

  return <main className="app blueApp">
    <Sidebar view={view} setView={setView} admin={profile.role === 'admin'} />
    <section className="workspace">
      <Top shift={shift} now={now} profile={profile} changeShift={() => setStage('shift')} logout={async () => { localStorage.removeItem('jts_selected_shift'); await firebaseAuth().signOut(); }} />
      <div className="content">
        {authError && <Notice tone="error">{authError}</Notice>}
        {view === 'overview' && <Overview tickets={current} now={now} shift={shift} config={config} go={setView} />}
        {view === 'new' && <TicketForm shift={shift} config={config} onSaved={() => setView('overview')} />}
        {view === 'tickets' && <Tickets tickets={tickets} now={now} />}
        {view === 'handover' && <Handover tickets={tickets} now={now} />}
        {view === 'analytics' && <Analytics tickets={tickets} now={now} />}
        {view === 'accounts' && profile.role === 'admin' && <Accounts currentUid={profile.id} />}
      </div>
    </section>
  </main>;
}

function Login({ error, clearError }: { error: string; clearError: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); clearError(); setMessage(''); setBusy(true);
    try { await firebaseAuth().signInWithEmailAndPassword(email.trim(), password); }
    catch { setMessage('E-Mail oder Passwort ist nicht korrekt.'); setBusy(false); }
  };
  const reset = async () => {
    clearError(); setMessage('');
    if (!email.trim()) { setMessage('Gib zuerst deine E-Mail-Adresse ein.'); return; }
    try { await firebaseAuth().sendPasswordResetEmail(email.trim()); setMessage('E-Mail zum Zurücksetzen wurde gesendet.'); }
    catch { setMessage('Für diese E-Mail konnte keine Anfrage gesendet werden.'); }
  };
  return <main className="login newLogin">
    <section className="brand witsBrand">
      <div className="loginCompany">DIGITEC <span>GALAXUS</span></div>
      <div><p className="over light">Jambuster Ticket Sistem</p><h1>Ein System.<br />Volle Übersicht.</h1><p className="intro">Störungen gemeinsam pro Schicht erfassen und dauerhaft auswerten.</p></div>
      <div className="brandBars"><span /><span /><span /><span /></div>
      <Powered />
    </section>
    <section className="loginSide"><form onSubmit={submit} className="loginForm">
      <div className="tabletLogo"><Logo dark /></div><p className="over">JTS Portal</p><h2>Anmelden</h2><p className="muted">Mit deinem freigeschalteten JTS-Konto fortfahren.</p>
      <label>E-Mail-Adresse<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></label>
      <label>Passwort<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
      <div className="row"><span className="secureDot">● Sicherer Zugang</span><button type="button" className="link" onClick={reset}>Passwort vergessen?</button></div>
      <button className="primary full" disabled={busy}>{busy ? 'Anmeldung…' : 'Anmelden →'}</button>
      {(message || error) && <p className="formMessage">{message || error}</p>}
      <p className="secure">Nur für freigeschaltete Mitarbeitende</p><div className="tabletLogo"><Powered /></div>
    </form></section>
  </main>;
}

function ShiftSelect({ profile, shift, setShift, config, start, logout }: { profile: Profile; shift: Shift; setShift: (shift: Shift) => void; config: RuntimeConfig; start: () => void; logout: () => void }) {
  return <main className="shiftPage"><header><Logo dark /><User profile={profile} /></header><section className="shiftBox"><p className="over">Schicht auswählen</p><h1>Welche Schicht machst du heute?</h1><p className="muted">Alle Konten derselben Schicht sehen die gleichen Meldungen in Echtzeit.</p><div className="shiftChoices">{shifts.map(item => <button key={item.name} className={shift === item.name ? 'selected' : ''} onClick={() => setShift(item.name)}><i>{item.icon}</i><b>{item.name}</b><small>{config.shiftTimes[item.name]}</small><em>{shift === item.name ? '✓' : ''}</em></button>)}</div><button className="primary start" onClick={start}>Schicht öffnen →</button><button className="textButton" onClick={logout}>Abmelden</button></section><Powered /></main>;
}

function Sidebar({ view, setView, admin }: { view: View; setView: (view: View) => void; admin: boolean }) {
  const items: [View, string, string][] = [['overview', '⌂', 'Übersicht'], ['new', '＋', 'Neue Störung'], ['tickets', '≡', 'Alle Störungen'], ['handover', '⇄', 'Schichtübergabe'], ['analytics', '▥', 'Auswertungen']];
  if (admin) items.push(['accounts', '⚙', 'Konten']);
  return <aside><Logo /><nav>{items.map(([item, icon, name]) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{icon}<span>{name}</span></button>)}</nav><div className="asideBottom"><Powered /></div></aside>;
}

function Top({ shift, now, profile, changeShift, logout }: { shift: Shift; now: Date; profile: Profile; changeShift: () => void; logout: () => void }) {
  return <header className="top"><button className="shiftPill" onClick={changeShift}><i /> {shift} · {clock(now)} <span>wechseln</span></button><div className="topUser"><User profile={profile} /><button className="logout" onClick={logout}>Abmelden</button></div></header>;
}

function Overview({ tickets, now, shift, config, go }: { tickets: Ticket[]; now: Date; shift: Shift; config: RuntimeConfig; go: (view: View) => void }) {
  const categoriesData = countBy(tickets, 'category');
  const addressed = tickets.filter(ticket => ticket.address.trim());
  return <><div className="heading"><div><p className="over">{dateLabel(now)} · {clock(now)}</p><h1>{shift}</h1><p className="muted">Gemeinsame Live-Übersicht für alle Konten dieser Schicht.</p></div><button className="primary" onClick={() => go('new')}>＋ Neue Störung</button></div><div className="metrics three"><Metric icon="!" title="Störungen heute" value={String(tickets.length)} note="Alle Meldungen der Schicht" /><Metric icon="⌖" title="Mit Adresse" value={String(addressed.length)} note="Für Anlagenpunkte nutzbar" /><Metric icon="↻" title="Wiederholungen" value={String(repeatedAddresses(addressed).length)} note="Mehrfach gleicher Punkt" /></div><div className="grid"><Panel title="Störungen nach Kategorie" subtitle="Aktuelle Schicht"><Bars data={categoriesData} empty="Noch keine Störungen in dieser Schicht." /></Panel><Panel title="Schichtübersicht" subtitle="Live synchronisiert"><span className="activeBadge">● AKTIV</span><div className="shiftInfo"><i>{shift === 'Frühschicht' ? '☀' : shift === 'Spätschicht' ? '☾' : '◐'}</i><span><b>{shift}</b><small>{config.shiftTimes[shift]}</small></span></div><Line a="Aktuelle Uhrzeit" b={clock(now)} /><Line a="Meldungen" b={String(tickets.length)} /><Line a="Tageswechsel" b="00:00 Uhr" /></Panel></div><Panel title="Letzte Störungen" subtitle="Von allen Konten dieser Schicht" wide>{tickets.length ? <TicketTable tickets={tickets.slice(0, 6)} /> : <Empty text="Für diese Schicht wurde noch nichts gemeldet." />}</Panel></>;
}

function TicketForm({ shift, config, onSaved }: { shift: Shift; config: RuntimeConfig; onSaved: () => void }) {
  const [category, setCategory] = useState(config.categories[0] ?? '');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState(config.areas[0] ?? '');
  const [reason, setReason] = useState(reasonOptions[0]);
  const [description, setDescription] = useState('');
  const [technician, setTechnician] = useState('Kein Techniker');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await firebaseDb().collection('tickets').add({
        shift, dateKey: zurichDateKey(new Date()), area, category,
        address: address.trim(), reason: reason.trim(), description: description.trim(), technician,
        createdAt: firebase().firestore.FieldValue.serverTimestamp(),
      });
      onSaved();
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  };
  return <><PageTitle title="Neue Störung" subtitle={`${shift} · Datum und Uhrzeit werden automatisch gespeichert.`} /><form className="dataForm panel" onSubmit={submit}><label>Bereich / Halle<select value={area} onChange={e => setArea(e.target.value)}>{config.areas.map(value => <option key={value}>{value}</option>)}</select></label><label>Art der Störung<select value={category} onChange={e => { setCategory(e.target.value); setAddress(''); }}>{config.categories.map(value => <option key={value}>{value}</option>)}</select></label><label className="wide">Anlagenpunkt / Adresse <span>Optional – nur Einträge mit Adresse erscheinen bei „Auffällige Anlagenpunkte“.</span>{category === 'Notaus' ? <select value={address} onChange={e => setAddress(e.target.value)}><option value="">Keine genaue Angabe</option>{config.notaus.map(value => <option key={value}>{value}</option>)}</select> : <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Zum Beispiel Linie 4, AP 12 oder Anlagennummer" />}</label><label className="wide">Grund der Störung <span>Grund aus der Liste auswählen.</span><select value={reason} onChange={e => setReason(e.target.value)} required>{reasonOptions.map(value => <option key={value}>{value}</option>)}</select></label><label>Techniker <span>Wird nur als Auswahl in der Meldung verwendet.</span><select value={technician} onChange={e => setTechnician(e.target.value)}><option>Kein Techniker</option>{config.technicians.map(value => <option key={value}>{value}</option>)}</select></label><label className="wide">Beschreibung<textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Störung kurz und sachlich beschreiben" required /></label>{error && <Notice tone="error">{error}</Notice>}<footer><button type="button" className="secondary" onClick={onSaved}>Abbrechen</button><button className="primary" disabled={busy}>{busy ? 'Speichern…' : 'Störung speichern'}</button></footer></form></>;
}

function Tickets({ tickets, now }: { tickets: Ticket[]; now: Date }) {
  const [date, setDate] = useState(zurichDateKey(now));
  const [shift, setShift] = useState<'all' | Shift>('all');
  const filtered = tickets.filter(ticket => ticket.dateKey === date && (shift === 'all' || ticket.shift === shift));
  return <><div className="heading"><PageTitle title="Alle Störungen" subtitle="Nach Datum und Schicht im Archiv suchen." /><div className="archiveFilters"><input type="date" value={date} onChange={e => setDate(e.target.value)} /><select value={shift} onChange={e => setShift(e.target.value as 'all' | Shift)}><option value="all">Alle Schichten</option>{shifts.map(item => <option key={item.name}>{item.name}</option>)}</select></div></div><Panel title="Störungsliste" subtitle={`${filtered.length} Meldungen am ${formatDateKey(date)}`} wide>{filtered.length ? <TicketTable tickets={filtered} /> : <Empty text="Für diese Auswahl sind keine Störungen gespeichert." />}</Panel></>;
}


function Handover({ tickets, now }: { tickets: Ticket[]; now: Date }) {
  const [date, setDate] = useState(zurichDateKey(now));
  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  const dayTickets = tickets.filter(ticket => ticket.dateKey === date);
  const byShift = (name: Shift) => dayTickets.filter(ticket => ticket.shift === name);
  return <><div className="heading"><PageTitle title="Schichtübergabe" subtitle="Vollständiger Tagesbericht für alle drei Schichten." /><div className="archiveFilters"><input type="date" value={date} onChange={e => setDate(e.target.value)} /><button className="primary" onClick={() => setGeneratedAt(new Date())}>Bericht neu erstellen</button></div></div>
    <div className="metrics">
      <Metric icon="∑" title="Gesamt" value={String(dayTickets.length)} note="Alle Störungen des Tages" />
      {shifts.map(item => <Metric key={item.name} icon={item.icon} title={item.name} value={String(byShift(item.name).length)} note="Meldungen dieser Schicht" />)}
    </div>
    <div className="grid">
      <Panel title="Gesamt nach Störungsart" subtitle={`${dayTickets.length} Meldungen am ${formatDateKey(date)}`}><Bars data={countBy(dayTickets, 'category')} empty="Für diesen Tag sind keine Störungen gespeichert." /></Panel>
      <Panel title="Übergabeübersicht" subtitle="Automatisch aus allen Meldungen erstellt">
        <Line a="Datum" b={formatDateKey(date)} />
        <Line a="Erstellt um" b={`${clock(generatedAt)} Uhr`} />
        <Line a="Gesamtstörungen" b={String(dayTickets.length)} />
        <Line a="Mit Adresse" b={String(dayTickets.filter(ticket => ticket.address.trim()).length)} />
        <Line a="Ohne Adresse" b={String(dayTickets.filter(ticket => !ticket.address.trim()).length)} />
      </Panel>
    </div>
    {shifts.map(item => {
      const shiftTickets = byShift(item.name);
      return <Panel key={item.name} title={item.name} subtitle={`${shiftTickets.length} Störungen · alle Meldungen dieser Schicht`} wide>{shiftTickets.length ? <TicketTable tickets={shiftTickets} /> : <Empty text={`Für die ${item.name} sind keine Störungen gespeichert.`} />}</Panel>;
    })}
  </>;
}

function Analytics({ tickets, now }: { tickets: Ticket[]; now: Date }) {
  const [period, setPeriod] = useState<'day' | 'month' | 'all'>('day');
  const filtered = tickets.filter(ticket => period === 'all' || (period === 'day' ? ticket.dateKey === zurichDateKey(now) : ticket.dateKey.startsWith(zurichDateKey(now).slice(0, 7))));
  const addressed = filtered.filter(ticket => ticket.address.trim());
  const addressCounts = countBy(addressed, 'address');
  const repeated = Object.entries(addressCounts).sort((a, b) => b[1] - a[1]);
  return <><div className="heading"><PageTitle title="Auswertungen" subtitle="Alle Meldungen zählen; Anlagenpunkte nur bei vorhandener Adresse." /><div className="tabs"><button className={period === 'day' ? 'on' : ''} onClick={() => setPeriod('day')}>Heute</button><button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>Monat</button><button className={period === 'all' ? 'on' : ''} onClick={() => setPeriod('all')}>Gesamt</button></div></div><div className="metrics three"><Metric icon="!" title="Störungen" value={String(filtered.length)} note="Mit und ohne Adresse" /><Metric icon="⌖" title="Anlagenpunkte" value={String(Object.keys(addressCounts).length)} note="Nur mit Adresse" /><Metric icon="↻" title="Wiederholungen" value={String(repeated.filter(item => item[1] > 1).length)} note="Mehrfach auffällig" /></div><div className="grid analyticsGrid"><Panel title="Kategorien" subtitle="Alle Störungen im Zeitraum"><Bars data={countBy(filtered, 'category')} empty="Keine Daten im gewählten Zeitraum." /></Panel><Panel title="Auffällige Anlagenpunkte" subtitle="Nur Meldungen mit genauer Adresse">{repeated.length ? <div className="hotspots">{repeated.map(([name, count]) => <div key={name} className={count >= 3 ? 'hot' : ''}><span><i>⌖</i><b>{name}</b></span><strong>{count}×</strong></div>)}</div> : <Empty text="Noch keine Adressen erfasst." />}</Panel></div></>;
}

function Accounts({ currentUid }: { currentUid: string }) {
  const [accounts, setAccounts] = useState<Profile[]>([]);
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('technician');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => firebaseDb().collection('users').orderBy('name').onSnapshot((snapshot: any) => setAccounts(snapshot.docs.map((item: any) => ({ id: item.id, ...item.data() } as Profile)))), []);
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('');
    const secondaryApp = firebase().initializeApp(firebaseConfig, `jts-account-${Date.now()}`);
    const secondaryAuth = secondaryApp.auth();
    try {
      const credential = await secondaryAuth.createUserWithEmailAndPassword(email.trim(), password);
      await firebaseDb().collection('users').doc(credential.user.uid).set({ name: name.trim(), email: email.trim().toLowerCase(), role, active: true, createdAt: firebase().firestore.FieldValue.serverTimestamp() });
      await secondaryAuth.signOut();
      setName(''); setEmail(''); setPassword(''); setRole('technician'); setShow(false);
    } catch (failure) { setMessage(errorMessage(failure)); }
    finally { await secondaryApp.delete(); setBusy(false); }
  };
  const toggle = async (account: Profile) => { if (account.id !== currentUid) await firebaseDb().collection('users').doc(account.id).update({ active: !account.active }); };
  return <><div className="heading"><PageTitle title="Konten" subtitle="Nur Admins können JTS-Konten erstellen und verwalten." /><button className="primary" onClick={() => setShow(true)}>＋ Neues Konto</button></div><article className="panel accountPanel"><div className="panelHead"><span><h2>JTS-Konten</h2><p>Rolle, Zugang und Aktivierung</p></span></div><div className="accountList">{accounts.map(account => <div className={`accountRow ${!account.active ? 'disabled' : ''}`} key={account.id}><span className="accountAvatar">{initials(account.name)}</span><div><b>{account.name}</b><small>{account.email}</small></div><em>{account.role === 'admin' ? 'Admin' : 'Techniker'}</em><button disabled={account.id === currentUid} onClick={() => toggle(account)}>{account.id === currentUid ? 'Aktuelles Konto' : account.active ? 'Deaktivieren' : 'Aktivieren'}</button></div>)}</div></article>{show && <div className="overlay" onMouseDown={() => setShow(false)}><form className="accountModal" onMouseDown={event => event.stopPropagation()} onSubmit={create}><header><div><p className="over">Administration</p><h2>Neues Konto erstellen</h2></div><button type="button" onClick={() => setShow(false)}>×</button></header><div><label>Name<input value={name} onChange={e => setName(e.target.value)} required /></label><label>E-Mail-Adresse<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Rolle<select value={role} onChange={e => setRole(e.target.value as Role)}><option value="technician">Techniker</option><option value="admin">Admin</option></select></label><label>Temporäres Passwort<input type="password" minLength={8} value={password} onChange={e => setPassword(e.target.value)} required /><small>Mindestens 8 Zeichen</small></label>{message && <Notice tone="error">{message}</Notice>}</div><footer><button type="button" className="secondary" onClick={() => setShow(false)}>Abbrechen</button><button className="primary" disabled={busy}>{busy ? 'Erstellen…' : 'Konto erstellen'}</button></footer></form></div>}</>;
}

function LoadingScreen() { return <main className="loadingScreen"><Logo dark /><span /><p>JTS wird geladen…</p><Powered /></main>; }
function Logo({ dark = false }: { dark?: boolean }) { return <div className={`logo ${dark ? 'dark' : ''}`}><b>J</b><span>JTS</span></div>; }
function Powered() { return <p className="powered">Powered by Shkodran</p>; }
function User({ profile }: { profile: Profile }) { return <div className="user"><b>{initials(profile.name)}</b><span><strong>{profile.name}</strong><small>{profile.role === 'admin' ? 'Admin' : 'Techniker'}</small></span></div>; }
function PageTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="pageTitle"><p className="over">JTS Portal</p><h1>{title}</h1><p className="muted">{subtitle}</p></div>; }
function Metric({ icon, title, value, note }: { icon: string; title: string; value: string; note: string }) { return <article><i>{icon}</i><span><small>{title}</small><strong>{value}</strong><p>{note}</p></span></article>; }
function Panel({ title, subtitle, children, wide = false }: { title: string; subtitle: string; children: React.ReactNode; wide?: boolean }) { return <article className={`panel ${wide ? 'wide' : ''}`}><div className="panelHead"><span><h2>{title}</h2><p>{subtitle}</p></span></div>{children}</article>; }
function Line({ a, b }: { a: string; b: string }) { return <div className="line"><span>{a}</span><b>{b}</b></div>; }
function Empty({ text }: { text: string }) { return <div className="empty"><span>◇</span><p>{text}</p></div>; }
function Notice({ children, tone }: { children: React.ReactNode; tone: 'error' | 'success' }) { return <p className={`notice ${tone}`}>{children}</p>; }
function Bars({ data, empty }: { data: Record<string, number>; empty: string }) { const entries = Object.entries(data).sort((a, b) => b[1] - a[1]); const max = Math.max(...entries.map(item => item[1]), 1); return entries.length ? <div className="categories">{entries.map(([name, count], index) => <div key={name}><span><i className={`c${index % 4}`} />{name}</span><b><i className={`c${index % 4}`} style={{ width: `${(count / max) * 100}%` }} /></b><strong>{count}</strong></div>)}</div> : <Empty text={empty} />; }
function TicketTable({ tickets }: { tickets: Ticket[] }) { return <div className="tableWrap"><table><thead><tr><th>Zeit</th><th>Schicht</th><th>Kategorie</th><th>Adresse</th><th>Grund</th><th>Beschreibung</th><th>Techniker</th></tr></thead><tbody>{tickets.map(ticket => <tr key={ticket.id}><td>{clock(new Date(ticket.createdAt))}</td><td>{ticket.shift}</td><td><b>{ticket.category}</b></td><td>{ticket.address ? <strong className="address">⌖ {ticket.address}</strong> : '—'}</td><td>{ticket.reason || '—'}</td><td>{ticket.description}</td><td>{ticket.technician}</td></tr>)}</tbody></table></div>; }
function countBy(list: Ticket[], key: 'category' | 'address') { return list.reduce<Record<string, number>>((result, ticket) => { const value = ticket[key]; if (!value) return result; result[value] = (result[value] || 0) + 1; return result; }, {}); }
function repeatedAddresses(list: Ticket[]) { return Object.entries(countBy(list, 'address')).filter(item => item[1] > 1); }
function zurichDateKey(date: Date) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const value = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${value.year}-${value.month}-${value.day}`; }
function clock(date: Date) { return date.toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }); }
function dateLabel(date: Date) { return date.toLocaleDateString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: '2-digit', month: 'long' }); }
function formatDateKey(value: string) { const [year, month, day] = value.split('-'); return `${day}.${month}.${year}`; }
function initials(name: string) { return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase(); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Etwas ist schiefgelaufen.'; }

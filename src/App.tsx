import { useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useData } from './lib/app';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CyclePage from './pages/Cycle';
import { CourseDetail, CoursesPage } from './pages/Courses';
import ProgressPage from './pages/Progress';
import HistoryPage from './pages/History';
import SettingsPage from './pages/Settings';
import SessionPage from './pages/Session';
import AccountabilityPage from './pages/Accountability';
import ConflictsPage from './pages/Conflicts';
import { BootError, Loading, Login, SetupNeeded } from './pages/Auth';
import { startReminderLoop, type ReminderContext } from './lib/notifications';
import { sessionsOfDay } from './lib/actions';
import { useApp } from './lib/app';
import { zonedDate } from './lib/time';

/** Runs the in-app reminder scheduler with the latest data (reads through a ref so it never restarts). */
function ReminderRunner() {
  const d = useData();
  const { store } = useApp();
  const ref = useRef<ReminderContext | null>(null);
  ref.current = d.profile && d.prefs ? {
    profile: d.profile, prefs: d.prefs, today: zonedDate(),
    sessions: d.currentDay ? sessionsOfDay(store, d.currentDay.id) : [],
    records: d.records, accountability: d.accountability,
  } : null;
  useEffect(() => startReminderLoop(() => ref.current), []);
  return null;
}

export default function App() {
  return (
    <AppProvider
      fallback={(b) => b.phase === 'signed-out' ? <Login /> : b.phase === 'setup-needed' ? <SetupNeeded /> : b.phase === 'error' ? <BootError message={b.message} /> : <Loading />}
    >
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReminderRunner />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="cycle" element={<CyclePage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="courses/:id" element={<CourseDetail />} />
            <Route path="progress" element={<ProgressPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="session/:id" element={<SessionPage />} />
            <Route path="accountability" element={<AccountabilityPage />} />
            <Route path="conflicts" element={<ConflictsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

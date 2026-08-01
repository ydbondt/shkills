import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './Shell';
import { Toasts } from './components';
import { useSession } from './state';
import SignIn from './pages/SignIn';
import Catalog from './pages/Catalog';
import SkillDetail from './pages/SkillDetail';
import SkillEditor from './pages/SkillEditor';
import Review from './pages/Review';
import Collections from './pages/Collections';
import CollectionDetail from './pages/CollectionDetail';
import Setup from './pages/Setup';
import LinkDevice from './pages/LinkDevice';
import People from './pages/People';
import Forgot from './pages/Forgot';
import Reset from './pages/Reset';

export default function App() {
  const { user, loading } = useSession();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <span className="t-meta pulse-soft">Shkills</span>
      </div>
    );
  }

  /**
   * Recovering a password is the one thing that has to work in both states and
   * belongs to neither. Signed out is the situation it exists for; signed in
   * happens whenever somebody follows a link in a browser that still has a
   * session — including a session for a different account.
   */
  if (location.pathname === '/forgot' || location.pathname === '/reset') {
    return (
      <>
        <Routes>
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/reset" element={<Reset />} />
        </Routes>
        <Toasts />
      </>
    );
  }

  if (!user) {
    // Keep the destination so a device-link URL survives the sign-in detour.
    return (
      <>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route
            path="*"
            element={<Navigate to="/signin" replace state={{ from: location.pathname + location.search }} />}
          />
        </Routes>
        <Toasts />
      </>
    );
  }

  return (
    <>
      <Shell>
        <Routes>
          <Route path="/" element={<Catalog />} />
          <Route path="/skills/new" element={<SkillEditor />} />
          <Route path="/skills/:slug" element={<SkillDetail />} />
          <Route path="/skills/:slug/edit" element={<SkillEditor />} />
          <Route path="/review" element={<Review />} />
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/:slug" element={<CollectionDetail />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/link" element={<LinkDevice />} />
          <Route path="/people" element={<People />} />
          <Route path="/signin" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
      <Toasts />
    </>
  );
}

import { Dashboard } from './components/layout/Dashboard';
import { Header } from './components/layout/Header';
import { NoticeBar } from './components/layout/NoticeBar';
import { TimeControls } from './components/layout/TimeControls';
import { useCatalogBootstrap } from './hooks/use-catalog-bootstrap';

export default function App() {
  useCatalogBootstrap();
  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <TimeControls />
      <NoticeBar />
      <Dashboard />
    </div>
  );
}

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <>
      <Sidebar />
      <main className="main-content animate-fade-in">
        <Outlet />
      </main>
    </>
  );
}

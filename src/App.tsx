/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Dashboard from './components/Dashboard';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    // Automatically set basic identity since login is removed
    if (!localStorage.getItem('userLoggedIn')) {
      localStorage.setItem('userLoggedIn', 'true');
      localStorage.setItem('userName', 'Guest User');
      localStorage.setItem('userPhone', '01234567890');
      localStorage.setItem('isAdmin', 'true');
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#07070a] text-white font-sans selection:bg-cyan-900 selection:text-cyan-100">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

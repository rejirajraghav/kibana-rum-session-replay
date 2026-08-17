import React from 'react';
import {Routes, Route, Navigate} from 'react-router-dom';
import {SessionListPage} from './pages/SessionList';
import {SessionPlayerPage} from './pages/SessionPlayer';

export function AppRoutes() {
    return (
        <Routes>
            <Route path="/" element={<SessionListPage />} />
            <Route path="/session/:sessionId" element={<SessionPlayerPage />} />
            {/* Catch-all → session list */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

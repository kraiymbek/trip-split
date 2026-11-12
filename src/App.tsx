import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { supabaseConfigured } from './lib/supabase'
import { Spinner } from './components/ui'
import { Toaster } from '@/components/ui/sonner'
import Auth from './pages/Auth'
import Trips from './pages/Trips'
import Join from './pages/Join'
import TripLayout from './pages/TripLayout'
import TripExpenses from './pages/TripExpenses'
import ExpenseForm from './pages/ExpenseForm'
import Summary from './pages/Summary'
import CashWallet from './pages/CashWallet'
import TripSettings from './pages/TripSettings'

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Spinner full />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  return children
}

export default function App() {
  if (!supabaseConfigured)
    return (
      <div className="mx-auto max-w-md px-5 pt-20 text-muted-foreground">
        <h1 className="mb-2 text-xl font-bold text-foreground">Не настроен Supabase</h1>
        <p>
          Создай файл <code>.env</code> по образцу <code>.env.example</code> (или добавь переменные в Vercel) и
          перезапусти.
        </p>
      </div>
    )

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Auth />} />
          <Route path="/" element={<RequireAuth><Trips /></RequireAuth>} />
          <Route path="/join/:code" element={<RequireAuth><Join /></RequireAuth>} />
          <Route path="/t/:tripId" element={<RequireAuth><TripLayout /></RequireAuth>}>
            <Route index element={<TripExpenses />} />
            <Route path="new" element={<ExpenseForm />} />
            <Route path="e/:expenseId" element={<ExpenseForm key="edit" />} />
            <Route path="cash" element={<CashWallet />} />
            <Route path="summary" element={<Summary />} />
            <Route path="settings" element={<TripSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster position="top-center" offset={{ top: 'max(env(safe-area-inset-top), 12px)' }} closeButton className="pointer-events-auto" />
      </BrowserRouter>
    </AuthProvider>
  )
}

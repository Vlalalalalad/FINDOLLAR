import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { Auth } from './pages/auth/Auth'
import { Dashboard } from './pages/Dashboard'
import { Accounts } from './pages/Accounts'
import { Categories } from './pages/Categories'
import { Transactions } from './pages/Transactions'
import { Debts } from './pages/Debts'
import { Profile } from './pages/Profile'
import { Statistics } from './pages/Statistics'
import { Calculator } from './pages/CalculatorView'
import { ModalBackdropHost } from './components/ui'
import { PlannerProvider } from './context/PlannerContext'
import { OrganizationProvider } from './context/OrganizationContext'
import { Plans } from './pages/Plans'

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route
              element={
                <ProtectedRoute>
                  <PlannerProvider>
                  <OrganizationProvider>
                  <AppLayout />
                  </OrganizationProvider>
                  </PlannerProvider>
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/debts" element={<Debts />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/statistics" element={<Statistics />} />
              <Route path="/calculator" element={<Calculator />} />
              <Route path="/plans" element={<Plans />} />
            </Route>
          </Routes>
          <ModalBackdropHost />
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  )
}

import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import RiskExplorer from './pages/RiskExplorer'
import OrderDetail from './pages/OrderDetail'
import Scorer from './pages/Scorer'
import Products from './pages/Products'
import Simulator from './pages/Simulator'
import Experiment from './pages/Experiment'
import Limitations from './pages/Limitations'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="risk" element={<RiskExplorer />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="scorer" element={<Scorer />} />
          <Route path="products" element={<Products />} />
          <Route path="simulator" element={<Simulator />} />
          <Route path="experiment" element={<Experiment />} />
          <Route path="limitations" element={<Limitations />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

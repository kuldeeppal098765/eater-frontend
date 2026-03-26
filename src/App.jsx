import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import InstallApp from "./InstallApp";
import PwaManifestRouteSync from "./components/PwaManifestRouteSync";
import Customer from "./Customer";
import Partner from "./Partner";
import Rider from "./Rider";
import Admin from "./Admin";
import "./App.css";

export default function App() {
  return (
    <Router>
      <PwaManifestRouteSync />
      <InstallApp />
      <Routes>
        {/* Admin routes first (narrow paths before customer `/*`). */}
        <Route path="/admin/*" element={<Admin />} />     
        
        <Route path="/partner/*" element={<Partner />} />
        <Route path="/restaurant/*" element={<Partner />} />
        <Route path="/rider/*" element={<Rider />} />
        
        <Route path="/*" element={<Customer />} />
      </Routes>
    </Router>
  );
}
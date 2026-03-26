import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import InstallApp from "./InstallApp";
import Customer from "./Customer";
import Partner from "./Partner";
import Rider from "./Rider";
import Admin from "./Admin";
import "./App.css";

function DynamicManifestLink() {
  const { pathname } = useLocation();

  useEffect(() => {
    const el = document.getElementById("dynamic-manifest");
    if (!el) return;

    let href = "/manifest.webmanifest";
    let title = "Vyaharam";

    if (pathname.startsWith("/admin")) {
      href = "/admin.json";
      title = "Vyaharam Admin";
    } else if (pathname.startsWith("/partner") || pathname.startsWith("/restaurant")) {
      href = "/partner.json";
      title = "Vyaharam Partner";
    } else if (pathname.startsWith("/rider")) {
      href = "/rider.json";
      title = "Vyaharam Rider";
    }

    el.setAttribute("href", href);
    document.title = title;
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <Router>
      <DynamicManifestLink />
      <InstallApp />
      <div className="vyaharam-route-outlet min-w-0 overflow-x-hidden">
        <Routes>
          <Route path="/admin/*" element={<Admin />} />
          <Route path="/partner/*" element={<Partner />} />
          <Route path="/restaurant/*" element={<Partner />} />
          <Route path="/rider/*" element={<Rider />} />
          <Route path="/*" element={<Customer />} />
        </Routes>
      </div>
    </Router>
  );
}

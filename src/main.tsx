import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";

// Registrar Service Worker para PWA
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("[PWA] Service Worker activo:", reg.scope))
      .catch((err) => console.warn("[PWA] Error al registrar Service Worker:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);

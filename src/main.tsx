import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";

// Registrar y monitorear actualizaciones del Service Worker para PWA
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("[PWA] Service Worker activo:", reg.scope);

        // 1. Chequeo inmediato de actualización al cargar
        reg.update().catch(() => {});

        // 2. Chequear actualizaciones cada vez que el usuario vuelve a abrir o enfocar la app
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            reg.update().catch(() => {});
          }
        });

        // 3. Chequeo recurrente cada 10 minutos
        setInterval(() => {
          reg.update().catch(() => {});
        }, 10 * 60 * 1000);
      })
      .catch((err) => console.warn("[PWA] Error al registrar Service Worker:", err));

    // 4. Cuando el nuevo Service Worker se activa (skipWaiting + clients.claim), recargar para mostrar el nuevo código
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);

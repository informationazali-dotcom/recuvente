import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import SuiviPublicView from "./SuiviPublicView.jsx";

const suiviId = new URLSearchParams(window.location.search).get("suivi");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {suiviId ? <SuiviPublicView commandeId={suiviId} /> : <App />}
  </React.StrictMode>
);

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./lib/useAuth";
import "./styles.css";
import "./index.css";

createRoot(document.getElementById("root")).render(
  
    <AuthProvider>
      <App />
    </AuthProvider>
  
);

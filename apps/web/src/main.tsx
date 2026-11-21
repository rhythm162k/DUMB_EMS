import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
// Keep the workspace stylesheet order independent of when its JavaScript loads.
import "./features/employees/DayOffBalances.css";
import "./features/employees/DepartmentsPage.css";
import "./features/employees/EmployeeForms.css";
import "./app/Dashboard.css";
import "./styles/refresh.css";
import "./styles/theme.css";
import "./styles/polish.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

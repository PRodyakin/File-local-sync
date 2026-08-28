import { createRoot } from "react-dom/client";
import "../app/globals.css";
import "./pages.css";
import { PagesApp } from "./PagesApp";

createRoot(document.getElementById("root")!).render(<PagesApp />);

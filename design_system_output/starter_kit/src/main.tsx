import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { applyFontSize, readFontSize } from "@/lib/font-size";
import { App } from "./App";
import "./styles/index.css";
import "./demo/demo.css";

// 첫 렌더 전에 글자 크기를 적용한다(테마는 public/theme.js가 이미 적용했다).
applyFontSize(readFontSize(), false);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delayDuration={250}>
      <App />
    </TooltipProvider>
  </StrictMode>,
);

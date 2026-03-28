import { createPortal } from "react-dom";

interface PortalProps {
  children: React.ReactNode;
  container?: Element | null;
}

export const Portal: React.FC<PortalProps> = ({ children, container }) => {
  if (typeof document === "undefined") return null;
  return createPortal(children, container ?? document.body);
};
